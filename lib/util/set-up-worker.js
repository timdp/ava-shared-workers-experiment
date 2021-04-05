const createDebug = require('debug')

const receiveCommands = async (main, commands, debug) => {
  for await (const message of main.subscribe()) {
    if (message.data == null || typeof message.data.type !== 'string') {
      debug('unexpected message', { message })
      continue
    }
    const { type, payload } = message.data
    const data = {}
    debug('invoking command', { type, payload })
    try {
      const result = await commands[type](payload)
      debug('command succeeded', { type, result })
      data.result = result
    } catch (error) {
      debug('command failed', { type, error })
      data.error = error
    } finally {
      debug('acknowledging command', { type, data })
      try {
        await message.reply(data)
        debug('acknowledgment succeeded', { type })
      } catch (error) {
        debug('acknowledgment failed', { type, error })
      }
    }
  }
}

// TODO Make this work with --serial
const setUpDisposal = async (main, dispose, debug) => {
  let count = 0
  for await (const testWorker of main.testWorkers()) {
    ++count
    testWorker.teardown(async () => {
      if (--count > 0) {
        return
      }
      debug('disposing')
      try {
        await dispose()
        debug('disposal succeeded')
      } catch (error) {
        debug('disposal failed', { error })
      }
    })
  }
}

const setUpWorker = (id, init, dispose, commands) => async ({
  negotiateProtocol
}) => {
  const debug = createDebug(`browsertest:${id}:proc`)
  const main = negotiateProtocol(['experimental'])
  await init()
  main.ready()
  await Promise.all([
    setUpDisposal(main, dispose, debug),
    receiveCommands(main, commands, debug)
  ])
}

module.exports = setUpWorker
