const { BrowserFacade } = require('../lib/browser/browser')
const { HttpdFacade } = require('../lib/httpd/httpd')
const { wrapTest } = require('../lib/util/test-wrapper')
const getFixturePath = require('./util/get-fixture-path')

let browser = null
let httpd = null

beforeAll(() => {
  browser = new BrowserFacade()
  httpd = new HttpdFacade()
})

afterAll(() => {
  browser.end()
  httpd.end()
})

wrapTest('browser loads iframe source', async hooks => {
  const fixturePath = getFixturePath('iframe')
  const dir = await httpd.hostDir(hooks, {
    path: fixturePath
  })
  const receivingIframeSrc = dir.expectRequest({
    filename: 'iframe.html'
  })
  await browser.openPage(hooks, {
    url: dir.getFileUrl('index.html')
  })
  await receivingIframeSrc
})

wrapTest('browser loads image with query string', async hooks => {
  const fixturePath = getFixturePath('image-with-query-string')
  const secret = 'Testing, #123.'
  const dir = await httpd.hostDir(hooks, {
    path: fixturePath,
    templateVars: {
      secret
    }
  })
  const receivingImage = dir.expectRequest({
    filename: 'image.jpg'
  })
  await browser.openPage(hooks, {
    url: dir.getFileUrl('index.html')
  })
  const response = await receivingImage
  expect(response.url.searchParams.get('secret')).toBe(secret)
})
