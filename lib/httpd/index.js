const defer = require('p-defer')
const path = require('path')
const registerWorker = require('../util/register-worker')
const sendCommand = require('../util/send-command')

const REQUEST_WATCHER_POLLING_INTERVAL = 500

const worker = registerWorker('httpd', path.resolve(__dirname, 'worker.js'))

const createRequestWatcher = async (t, options) => {
  const { id } = await sendCommand(worker, 'createRequestWatcher', options)
  const dfd = defer()
  const itv = setInterval(() => {
    sendCommand(worker, 'getRequestWatcher', { id }).then(data => {
      if (data == null) {
        clearInterval(itv)
      } else if (data.match != null) {
        clearInterval(itv)
        dfd.resolve({ url: new URL(data.match.url) })
      }
    })
  }, REQUEST_WATCHER_POLLING_INTERVAL).unref()
  t.teardown(async () => {
    clearInterval(itv)
    await sendCommand(worker, 'removeRequestWatcher', { id })
  })
  return {
    promise: dfd.promise
  }
}

const hostDir = async (t, options) => {
  t.teardown(async () => {
    await sendCommand(worker, 'unhostDir', {
      path: options.path
    })
  })
  const { url, pathname } = await sendCommand(worker, 'hostDir', options)
  return {
    url,
    getFileUrl: filename => `${url}/${filename}`,
    expectRequest: async (t, { filename }) => {
      const watcher = await createRequestWatcher(t, {
        pathname: `${pathname}/${filename}`
      })
      return await watcher.promise
    }
  }
}

module.exports = {
  hostDir
}
