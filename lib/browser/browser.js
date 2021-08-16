const { WorkerFacade } = require('../common/worker-facade')

class BrowserFacade extends WorkerFacade {
  constructor () {
    super(require.resolve('./worker'))
  }

  async openPage (hooks, options) {
    const { id } = await this.worker.openPage(options)
    hooks.teardown$.subscribe(() => {
      if (!this.ended) {
        this.worker.closePage({ id })
      }
    })
  }
}

module.exports = { BrowserFacade }
