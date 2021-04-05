const createDebug = require('debug')
const { registerSharedWorker } = require('ava/plugin')

const registerWorker = (id, filename) => {
  const worker = registerSharedWorker({
    filename,
    supportedProtocols: ['experimental']
  })
  worker._debug = createDebug(`browsertest:${id}:remote`)
  return worker
}

module.exports = registerWorker
