const test = require('ava')
const { BehaviorSubject, merge: _merge, timer: _timer } = require('rxjs')
const {
  delay,
  filter,
  ignoreElements,
  map,
  scan,
  skip,
  take,
  tap
} = require('rxjs/operators')
const browser = require('../lib/browser')
const httpd = require('../lib/httpd')
const getFixturePath = require('./util/get-fixture-path')

const QUARTILE_EVENT_NAMES = [
  'AdVideoStart',
  'AdVideoFirstQuartile',
  'AdVideoMidpoint',
  'AdVideoThirdQuartile',
  'AdVideoComplete'
]

const vpaidUrl =
  'https://vasttester.iabtechlab.com/fixtures/vpaid/vpaid-example.js'
const adParameters =
  '{ "buttonForegroundColor": "white", "buttonBackgroundColor": "black" }'
const debug = process.env.DEBUG_VPAID === '1'

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
      })
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

const setUpVpaidTest = async (t, vpaidUrl, adParameters, debug = false) => {
  const fixturePath = getFixturePath('ima-player-vpaid-spy')
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
  const openPage = async () => {
    await browser.openPage(t, {
      url: dir.getFileUrl('index.html')
    })
  }
  return {
    dir,
    tracking$,
    openPage
  }
}

const receiveEvents = (tracking$, type) => tracking$.pipe(ofType(type))

const receiveEvent = (tracking$, type) =>
  receiveEvents(tracking$, type)
    .pipe(take(1))
    .toPromise()

const receiveVpaidEvents = (tracking$, eventName) =>
  receiveEvents(tracking$, 'vpaid-event').pipe(
    filter(({ payload: { name } }) => name === eventName)
  )

const receiveVpaidEvent = (tracking$, eventName) =>
  receiveVpaidEvents(tracking$, eventName)
    .pipe(take(1))
    .toPromise()

const receiveVpaidCalls = (tracking$, methodName) =>
  receiveEvents(tracking$, 'vpaid-call').pipe(
    filter(({ payload: { name } }) => name === methodName)
  )

const receiveVpaidCall = (tracking$, methodName) =>
  receiveVpaidCalls(tracking$, methodName)
    .pipe(take(1))
    .toPromise()

const failOnVastError = async (t, tracking$) => {
  const {
    payload: { code }
  } = await receiveEvent(tracking$, 'vast-error')
  t.fail(`Error tracker fired: ${code}`)
}

const rememberLastValue = (values$, defaultValue = null) => {
  const subject = new BehaviorSubject(defaultValue)
  values$.subscribe(subject)
  return subject
}

test('VPAID unit publishes AdImpression event', async t => {
  const { tracking$, openPage } = await setUpVpaidTest(
    t,
    vpaidUrl,
    adParameters,
    debug
  )

  const receivingAdImpression = receiveVpaidEvent(tracking$, 'AdImpression')
  const failingOnVastError = failOnVastError(t, tracking$)

  await openPage()
  await Promise.race([receivingAdImpression, failingOnVastError])
  t.pass()
})

test('VPAID unit publishes exactly one AdImpression event', async t => {
  const waitTime = 2000 // How long to wait for second impression event

  const { tracking$, openPage } = await setUpVpaidTest(
    t,
    vpaidUrl,
    adParameters,
    debug
  )

  const impressions$ = receiveVpaidEvents(tracking$, 'AdImpression')

  const receivingFirstImpressionWithDelay = impressions$
    .pipe(take(1), delay(waitTime))
    .toPromise()
  const failingOnSecondImpression = impressions$
    .pipe(skip(1), take(1))
    .toPromise()
    .then(() => {
      t.fail('Multiple AdImpressions received')
    })
  const failingOnVastError = failOnVastError(t, tracking$)

  await openPage()
  await Promise.race([
    receivingFirstImpressionWithDelay,
    failingOnSecondImpression,
    failingOnVastError
  ])
  t.pass()
})

test('VPAID unit correctly publishes quartile events', async t => {
  const maxEventTimeDrift = 1000 // Maximum difference to expected event time
  const maxEventWaitingTime = 3000 // Maximum time to wait before timeout

  const { tracking$, openPage } = await setUpVpaidTest(
    t,
    vpaidUrl,
    adParameters,
    debug
  )

  const quartileEvents$ = _merge(
    ...QUARTILE_EVENT_NAMES.map(name => receiveVpaidEvents(tracking$, name))
  ).pipe(
    take(QUARTILE_EVENT_NAMES.length),
    scan(
      (history, { date, payload: { name } }) => [
        ...history,
        [date.getTime(), name]
      ],
      []
    )
  )
  const quartileEventsSubject = rememberLastValue(quartileEvents$, [])

  const duration$ = receiveVpaidCalls(tracking$, 'getAdDuration').pipe(
    map(({ payload: { result } }) => result)
  )
  const durationSubject = rememberLastValue(duration$, -2)

  const serializeHistory = () => {
    const history = quartileEventsSubject.value
    if (history.length === 0) {
      return 'no quartile events published'
    }
    return history.map(([time, name]) => `${name} at ${time}`).join(', ')
  }

  const failingOnIdle = _timer(0, 100)
    .pipe(
      map(() => {
        const duration = durationSubject.value
        const history = quartileEventsSubject.value
        if (!(duration > 0 && history.length > 0)) {
          return false
        }
        const [lastTime] = history[history.length - 1]
        const expectedTime = lastTime + (duration * 1000) / 4
        return Date.now() - expectedTime > maxEventWaitingTime
      }),
      filter(Boolean),
      take(1)
    )
    .toPromise()
    .then(() => {
      t.fail('Timed out waiting for next quartile event: ' + serializeHistory())
    })

  const failingOnAdStopped = receiveVpaidEvent(tracking$, 'AdStopped').then(
    () => {
      t.fail('AdStopped published before quartiles: ' + serializeHistory())
    }
  )

  const failingOnVastError = failOnVastError(t, tracking$)

  await openPage()

  await Promise.race([
    quartileEvents$.toPromise(),
    failingOnIdle,
    failingOnAdStopped,
    failingOnVastError
  ])

  const duration = durationSubject.value
  t.true(duration > 0, 'invalid duration reported')

  const history = quartileEventsSubject.value
  t.deepEqual(
    history.map(([date, name]) => name),
    QUARTILE_EVENT_NAMES,
    'events arrived out of order'
  )

  const startTime = history[0][0]
  for (let quartile = 1; quartile <= 4; ++quartile) {
    const [actualTime, name] = history[quartile]
    const expectedTime = startTime + ((duration * 1000) / 4) * quartile
    const diff = actualTime - expectedTime
    const type = diff > 0 ? 'late' : 'early'
    t.true(
      Math.abs(diff) < maxEventTimeDrift,
      `${name} event published too ${type}: received at ${actualTime} while expected at ${expectedTime}, difference is ${diff} ms`
    )
  }
})
