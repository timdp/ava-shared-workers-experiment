const sendCommand = async (worker, type, payload = {}) => {
  const debug = worker._debug
  debug('sending command', { type, payload })
  const { replies } = await worker.publish({ type, payload })
  debug('sent command', { type })
  const iter = await replies().next()
  const {
    data: { result, error }
  } = iter.value
  debug('got command response', { type, result, error })
  if (error != null) {
    throw error
  }
  return result
}

module.exports = sendCommand
