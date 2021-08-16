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

wrapTest(
  'IMA SDK loads VAST tag and dispatches VAST impression',
  async hooks => {
    const fixturePath = getFixturePath('ima-player-vast-tracking')
    const tagUrl =
      'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ct%3Dlinear&correlator='
    const dir = await httpd.hostDir(hooks, {
      path: fixturePath,
      templateVars: {
        tagUrl
      }
    })
    const receivingImpression = dir.expectRequest({
      filename: 'impression'
    })
    const receivingError = dir
      .expectRequest({
        filename: 'error'
      })
      .then(({ url }) => url.searchParams.get('code'))

    await browser.openPage(hooks, {
      url: dir.getFileUrl('index.html')
    })
    const errorMessage = await Promise.race([
      receivingImpression.then(() => false),
      receivingError.then(code => `Error tracker fired: ${code}`)
    ])
    expect(errorMessage).toBe(false)
  }
)
