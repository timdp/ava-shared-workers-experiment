const test = require('ava')
const {
  filter,
  take,
  map,
  share,
  skip,
  delay,
  tap,
  ignoreElements
} = require('rxjs/operators')
const browser = require('../lib/browser')
const httpd = require('../lib/httpd')
const getFixturePath = require('./util/get-fixture-path')

const ofType = desiredType => filter(({ type }) => type === desiredType)

const receiveTracking = (t, dir) =>
  dir
    .expectRequests(t, {
      filename: 'track'
    })
    .pipe(
      map(({ date: reqDate, url }) => {
        const dataStr = url.searchParams.get('data')
        const { timestamp, type, payload } = JSON.parse(dataStr)
        let date
        if (timestamp != null) {
          date = new Date()
          date.setTime(timestamp)
        } else {
          date = reqDate
        }
        return { date, type, payload }
      }),
      share()
    )

const proxyLogs = tracking$ =>
  tracking$
    .pipe(
      ofType('log'),
      tap(({ date, payload: { message } }) => {
        console.log(`[${date.toISOString()}] ${message}`)
      }),
      ignoreElements()
    )
    .subscribe()

test('VPAID unit dispatches exactly one VPAID AdImpression', async t => {
  const fixturePath = getFixturePath('ima-player-vpaid-spy')

  const vpaidUrl =
    'https://vasttester.iabtechlab.com/fixtures/vpaid/vpaid-example.js'
  const adParameters =
    '{ "buttonForegroundColor": "white", "buttonBackgroundColor": "black" }'
  const waitTime = 2000 // How long to wait for second impression event
  const debug = false

  const dir = await httpd.hostDir(t, {
    path: fixturePath,
    templates: ['vast.xml'],
    templateVars: {
      vpaidUrl,
      adParameters,
      debug
    }
  })

  const tracking$ = receiveTracking(t, dir)
  if (debug) {
    proxyLogs(tracking$)
  }

  const impressions$ = tracking$.pipe(
    ofType('guest-event'),
    filter(({ payload: { name } }) => name === 'AdImpression'),
    share()
  )
  const receivingDelayedFirstImpression = impressions$
    .pipe(take(1), delay(waitTime))
    .toPromise()
  const receivingSecondImpression = impressions$
    .pipe(skip(1), take(1))
    .toPromise()

  const receivingError = tracking$
    .pipe(
      ofType('vast-error'),
      take(1),
      map(({ payload: { code } }) => code)
    )
    .toPromise()

  await browser.openPage(t, {
    url: dir.getFileUrl('index.html')
  })

  await Promise.race([
    receivingDelayedFirstImpression.then(() => {
      t.pass()
    }),
    receivingSecondImpression.then(() => {
      t.fail('Multiple AdImpressions received')
    }),
    receivingError.then(code => {
      t.fail(`Error tracker fired: ${code}`)
    })
  ])
})
