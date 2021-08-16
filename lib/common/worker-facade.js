const { Worker } = require('jest-worker')

class WorkerFacade {
  constructor (workerFilePath) {
    this.worker = new Worker(workerFilePath, {
      numWorkers: 1,
      enableWorkerThreads: true
    })
    this.worker.getStdout().pipe(process.stdout)
    this.worker.getStderr().pipe(process.stderr)
    this.ended = false
  }

  async end () {
    this.ended = true
    await this.worker.end()
  }
}

module.exports = { WorkerFacade }
