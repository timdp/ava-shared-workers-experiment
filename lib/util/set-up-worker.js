const createDebug = require('debug')

class Recyclable {
  constructor (init, dispose, debug) {
    this._init = init
    this._dispose = dispose
    this._debug = debug
    this._initializing = null
    this._disposing = null
    this._state = 'disposed'
  }

  async init () {
    if (this._state === 'disposing') {
      this._debug('init: awaiting ongoing disposal')
      await this._disposing
      this._debug('init: ongoing disposal completed')
    }
    if (this._state === 'disposed') {
      this._debug('init: starting initialization')
      this._state = 'initializing'
      this._initializing = this._initAndSetState()
    }
    if (this._state === 'initializing') {
      this._debug('init: awaiting initialization completion')
      await this._initializing
      this._debug('init: initialization completed')
    }
  }

  async dispose () {
    if (this._state === 'initializing') {
      this._debug('dispose: awaiting ongoing initialization')
      await this._initializing
      this._debug('dispose: ongoing initialization completed')
    }
    if (this._state === 'initialized') {
      this._debug('dispose: starting disposal')
      this._state = 'disposing'
      this._disposing = this._disposeAndSetState()
    }
    if (this._state === 'disposing') {
      this._debug('dispose: awaiting disposal completion')
      await this._disposing
      this._debug('dispose: disposal completed')
    }
  }

  async _initAndSetState () {
    await this._init()
    this._state = 'initialized'
    this._initializing = null
  }

  async _disposeAndSetState () {
    await this._dispose()
    this._state = 'disposed'
    this._disposing = null
  }
}

const setUpDisposal = async (main, recyclable, debug) => {
  let count = 0
  const onTeardown = async () => {
    if (--count > 0) {
      return
    }
    try {
      debug('disposing')
      await recyclable.dispose()
      debug('disposal succeeded')
    } catch (error) {
      debug('disposal failed', { error })
    }
  }
  for await (const testWorker of main.testWorkers()) {
    ++count
    testWorker.teardown(onTeardown)
  }
}

const receiveCommands = async (main, recyclable, commands, debug) => {
  for await (const message of main.subscribe()) {
    if (message.data == null || typeof message.data.type !== 'string') {
      debug('unexpected message', { message })
      continue
    }
    const { type, payload } = message.data
    const data = {}
    try {
      await recyclable.init()
      debug('invoking command', { type, payload })
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

const setUpWorker = (id, init, dispose, commands) => async ({
  negotiateProtocol
}) => {
  const debug = createDebug(`browsertest:${id}:proc`)
  const main = negotiateProtocol(['experimental'])
  const recyclable = new Recyclable(init, dispose, debug)
  setUpDisposal(main, recyclable, debug)
  main.ready()
  await receiveCommands(main, recyclable, commands, debug)
}

module.exports = setUpWorker
