const test = require('ava')
const browser = require('../lib/browser')
const httpd = require('../lib/httpd')
const getFixturePath = require('./util/get-fixture-path')

test('browser loads iframe source', async t => {
  const fixturePath = getFixturePath('iframe')
  const dir = await httpd.hostDir(t, {
    path: fixturePath
  })
  const receivingIframeSrc = dir.expectRequest({
    filename: 'iframe.html'
  })
  await browser.openPage(t, {
    url: dir.getFileUrl('index.html')
  })
  await receivingIframeSrc
  t.pass()
})

test('browser loads image with query string', async t => {
  const fixturePath = getFixturePath('image-with-query-string')
  const secret = 'Testing, #123.'
  const dir = await httpd.hostDir(t, {
    path: fixturePath,
    templateVars: {
      secret
    }
  })
  const receivingImage = dir.expectRequest({
    filename: 'image.jpg'
  })
  await browser.openPage(t, {
    url: dir.getFileUrl('index.html')
  })
  const response = await receivingImage
  t.is(response.url.searchParams.get('secret'), secret)
})
