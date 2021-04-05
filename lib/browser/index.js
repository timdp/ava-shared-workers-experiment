const path = require('path')
const registerWorker = require('../util/register-worker')
const sendCommand = require('../util/send-command')

const worker = registerWorker('browser', path.resolve(__dirname, 'worker.js'))

const openPage = async (t, options) => {
  const page = await sendCommand(worker, 'openPage', options)
  t.teardown(async () => {
    await sendCommand(worker, 'closePage', { id: page.id })
  })
  return page
}

module.exports = {
  openPage
}
