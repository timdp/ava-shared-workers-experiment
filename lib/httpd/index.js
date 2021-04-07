const { Observable } = require('rxjs')
const { take } = require('rxjs/operators')
const path = require('path')
const registerWorker = require('../util/register-worker')
const sendCommand = require('../util/send-command')

const REQUEST_WATCHER_POLLING_INTERVAL = 500

const worker = registerWorker('httpd', path.resolve(__dirname, 'worker.js'))

const watchRequests = (t, options) =>
  Observable.create(obs => {
    let id = null
    let itv = null
    let lastMatchIndex = 0

    const dispose = () => {
      if (itv != null) {
        clearInterval(itv)
        itv = null
      }
      if (id != null) {
        sendCommand(worker, 'removeRequestWatcher', { id })
        id = null
      }
    }

    const poll = () => {
      sendCommand(worker, 'getRequestWatcher', { id }).then(watcher => {
        if (itv == null || watcher == null) {
          return
        }
        let i = lastMatchIndex
        lastMatchIndex = watcher.matches.length
        while (i < watcher.matches.length) {
          const { timestamp, url } = watcher.matches[i]
          obs.next({
            timestamp,
            url: new URL(url)
          })
          ++i
        }
      })
    }

    sendCommand(worker, 'createRequestWatcher', options).then(watcher => {
      id = watcher.id
      itv = setInterval(poll, REQUEST_WATCHER_POLLING_INTERVAL)
    })

    t.teardown(dispose)

    return dispose
  })

const hostDir = async (t, options) => {
  t.teardown(async () => {
    await sendCommand(worker, 'unhostDir', {
      path: options.path
    })
  })

  const { url, pathname } = await sendCommand(worker, 'hostDir', options)

  const expectRequests = (t, { filename }) =>
    watchRequests(t, {
      pathname: `${pathname}/${filename}`
    })

  return {
    url,
    getFileUrl: filename => `${url}/${filename}`,
    expectRequests,
    expectRequest: (t, filter) =>
      expectRequests(t, filter)
        .pipe(take(1))
        .toPromise()
  }
}

module.exports = {
  hostDir
}
