const { from, timer, of, firstValueFrom } = require('rxjs')
const { mergeMap, takeUntil, share } = require('rxjs/operators')
const { WorkerFacade } = require('../common/worker-facade')

const REQUEST_WATCHER_POLLING_INTERVAL = 500

class HttpdFacade extends WorkerFacade {
  constructor () {
    super(require.resolve('./worker.js'))
  }

  async hostDir (hooks, options) {
    const { url, pathname } = await this.worker.hostDir(options)
    hooks.teardown$.subscribe(() => {
      if (!this.ended) {
        this.worker.unhostDir(options)
      }
    })
    const expectRequests = ({ filename }) =>
      from(
        this.worker.createRequestWatcher({
          pathname: `${pathname}/${filename}`
        })
      ).pipe(
        mergeMap(({ id }) => {
          let lastMatchIndex = 0
          return timer(0, REQUEST_WATCHER_POLLING_INTERVAL).pipe(
            mergeMap(() => this.worker.getRequestWatcher({ id })),
            mergeMap(watcher => {
              const newMatches = watcher.matches.slice(lastMatchIndex)
              lastMatchIndex = watcher.matches.length
              return of(
                ...newMatches.map(({ timestamp, url }) => ({
                  date: new Date(timestamp),
                  url: new URL(url)
                }))
              )
            })
          )
        }),
        takeUntil(hooks.teardown$),
        share()
      )
    return {
      getFileUrl: filename => `${url}/${filename}`,
      expectRequests,
      expectRequest: filter => firstValueFrom(expectRequests(filter))
    }
  }

  async close () {
    await this.worker.end()
  }
}

module.exports = { HttpdFacade }
