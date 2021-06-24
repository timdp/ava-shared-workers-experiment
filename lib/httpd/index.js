const {
  EMPTY: EMPTY$,
  from: $from,
  of: $of,
  timer: $timer,
  firstValueFrom
} = require('rxjs')
const {
  take,
  share,
  mergeMap,
  mergeMapTo,
  tap,
  takeUntil
} = require('rxjs/operators')
const path = require('path')
const registerWorker = require('../util/register-worker')
const sendCommand = require('../util/send-command')
const receiveTeardown = require('../util/receive-teardown')

const REQUEST_WATCHER_POLLING_INTERVAL = 500

const worker = registerWorker('httpd', path.resolve(__dirname, 'worker.js'))

const requestWatchers$ = $timer(0, REQUEST_WATCHER_POLLING_INTERVAL).pipe(
  mergeMap(() => sendCommand(worker, 'getRequestWatchers')),
  share()
)

const watchRequests = (options, teardown$) => {
  let id = null
  let lastMatchIndex = 0

  teardown$.subscribe(() => {
    sendCommand(worker, 'removeRequestWatcher', { id })
    id = null
  })

  return $from(sendCommand(worker, 'createRequestWatcher', options)).pipe(
    tap(res => {
      id = res.id
    }),
    mergeMapTo(requestWatchers$),
    mergeMap(watchers => {
      if (id == null) {
        return EMPTY$
      }
      const watcher = watchers.find(w => w.id === id)
      if (watcher == null) {
        return EMPTY$
      }
      const newMatches = watcher.matches.slice(lastMatchIndex)
      lastMatchIndex = watcher.matches.length
      return $of(
        ...newMatches.map(({ timestamp, url }) => ({
          date: new Date(timestamp),
          url: new URL(url)
        }))
      )
    }),
    takeUntil(teardown$),
    share()
  )
}

const hostDir = async (t, options) => {
  const teardown$ = receiveTeardown(t)

  teardown$.subscribe(() => {
    sendCommand(worker, 'unhostDir', {
      path: options.path
    })
  })

  const { url, pathname } = await sendCommand(worker, 'hostDir', options)

  const expectRequests = ({ filename }) =>
    watchRequests({ pathname: `${pathname}/${filename}` }, teardown$)

  return {
    url,
    getFileUrl: filename => `${url}/${filename}`,
    expectRequests,
    expectRequest: filter =>
      firstValueFrom(expectRequests(filter).pipe(take(1)))
  }
}

module.exports = {
  hostDir
}
