const log = require('debug')('browsertest:browser:impl')
const puppeteer = require('puppeteer-core')

// Accepts 'chrome' or 'firefox'
const BROWSER_TYPE = process.env.BROWSER_TYPE || 'chrome'
const SHOW_BROWSER = process.env.SHOW_BROWSER === '1'

let browser = null
let pageCount = 0
const pages = new Map()

const browserLocation = () => {
  switch (BROWSER_TYPE) {
    case 'firefox':
      return require('firefox-location')
    case 'chrome':
      return require('chrome-location')
  }
  throw new Error(`Unsupported browser: ${BROWSER_TYPE}`)
}

const setup = async () => {
  log(`finding ${BROWSER_TYPE}`)
  const executablePath = browserLocation()
  log('starting browser', { product: BROWSER_TYPE, executablePath })
  browser = await puppeteer.launch({
    product: BROWSER_TYPE,
    executablePath,
    headless: !SHOW_BROWSER,
    devtools: SHOW_BROWSER
  })
  log('browser started')
}

const teardown = async () => {
  if (browser == null) {
    log('nothing to dispose')
    return
  }
  log('disposing browser')
  try {
    await browser.close()
  } catch (error) {
    log('failed to close browser', { error })
  } finally {
    browser = null
  }
  log('browser disposed')
}

const openPage = async ({ url }) => {
  const page = await browser.newPage()
  await page.goto(url)
  pages.set(pageCount, page)
  return { id: pageCount++ }
}

const closePage = async ({ id }) => {
  const page = pages.get(id)
  await page.close()
}

module.exports = {
  setup,
  teardown,
  openPage,
  closePage
}
