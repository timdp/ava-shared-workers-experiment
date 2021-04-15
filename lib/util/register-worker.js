const createDebug = require('debug')
const { registerSharedWorker } = require('ava/plugin')
const { kDebug } = require('./symbols')

const registerWorker = (id, filename) => {
  const worker = registerSharedWorker({
    filename,
    supportedProtocols: ['experimental']
  })
  worker[kDebug] = createDebug(`browsertest:${id}:remote`)
  return worker
}

module.exports = registerWorker
