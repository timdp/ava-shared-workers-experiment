const debug = require('debug')('browsertest:browser:impl')
const puppeteer = require('puppeteer-core')
const setUpWorker = require('../util/set-up-worker')

// Accepts 'chrome' or 'firefox'
const BROWSER_TYPE = process.env.BROWSER_TYPE || 'chrome'
const SHOW_BROWSER = process.env.SHOW_BROWSER === '1'

const pages = new Map()

let browser = null
let pageCount = 0

const browserLocation = () => {
  switch (BROWSER_TYPE) {
    case 'firefox':
      return require('firefox-location')
    case 'chrome':
      return require('chrome-location')
  }
  throw new Error(`Unsupported browser: ${BROWSER_TYPE}`)
}

const startBrowser = async () => {
  debug(`finding ${BROWSER_TYPE}`)
  const executablePath = browserLocation()
  debug('starting browser', { product: BROWSER_TYPE, executablePath })
  browser = await puppeteer.launch({
    product: BROWSER_TYPE,
    executablePath,
    headless: !SHOW_BROWSER,
    devtools: SHOW_BROWSER
  })
  debug('browser started')
}

const disposeBrowser = async () => {
  if (browser == null) {
    debug('nothing to dispose')
    return
  }
  debug('disposing browser')
  try {
    await browser.close()
  } catch (error) {
    debug('failed to close browser', { error })
  } finally {
    browser = null
  }
  debug('browser disposed')
}

exports.default = setUpWorker('browser', startBrowser, disposeBrowser, {
  openPage: async ({ url }) => {
    const id = ++pageCount
    const page = await browser.newPage()
    pages.set(id, page)
    await page.goto(url)
    return {
      id
    }
  },
  closePage: async ({ id }) => {
    const page = pages.get(id)
    if (page == null) {
      return
    }
    pages.delete(id)
    await page.close()
  }
})
