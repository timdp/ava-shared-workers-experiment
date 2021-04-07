const test = require('ava')
const browser = require('../lib/browser')
const httpd = require('../lib/httpd')
const getFixturePath = require('./util/get-fixture-path')

test('IMA SDK loads tag and dispatches impression', async t => {
  const fixturePath = getFixturePath('ima-player')
  const tagUrl =
    'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ct%3Dlinear&correlator='
  const dir = await httpd.hostDir(t, {
    path: fixturePath,
    templates: ['vast.xml'],
    templateVars: {
      tagUrl
    }
  })
  const receivingImpression = dir.expectRequest(t, {
    filename: 'impression'
  })
  const receivingError = dir.expectRequest(t, {
    filename: 'error'
  })
  await browser.openPage(t, {
    url: dir.getFileUrl('index.html')
  })
  await Promise.race([
    receivingImpression.then(() => {
      t.pass()
    }),
    receivingError.then(() => {
      t.fail('Error tracker requested')
    })
  ])
})