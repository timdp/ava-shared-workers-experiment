const test = require('ava')
const {
  combineLatest: _combineLatest,
  from: _from,
  merge: _merge,
  race: _race,
  timer: _timer
} = require('rxjs')
const {
  delay,
  filter,
  map,
  mapTo,
  materialize,
  mergeMap,
  mergeMapTo,
  scan,
  share,
  skip,
  startWith,
  take,
  tap
} = require('rxjs/operators')
const {
  setUpVpaidTest,
  receiveVpaidEvents,
  receiveVpaidEvent,
  receiveVpaidCalls,
  receiveVastError
} = require('./util/vpaid-helpers')

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

test('VPAID unit publishes AdImpression event', async t => {
  const { tracking$, openPage } = await setUpVpaidTest(
    t,
    vpaidUrl,
    adParameters
  )

  const receivingAdImpression = receiveVpaidEvent(
    tracking$,
    'AdImpression'
  ).toPromise()
  const receivingVastError = receiveVastError(tracking$).toPromise()

  await openPage()
  const errorMessage = await Promise.race([
    receivingAdImpression.then(() => false),
    receivingVastError.then(code => `VAST error tracker fired: ${code}`)
  ])
  t.false(errorMessage)
})

test('VPAID unit publishes exactly one AdImpression event', async t => {
  const waitTime = 2000 // How long to wait for second impression event

  const { tracking$, openPage } = await setUpVpaidTest(
    t,
    vpaidUrl,
    adParameters
  )

  const impressions$ = receiveVpaidEvents(tracking$, 'AdImpression')

  const receivingFirstImpressionWithDelay = impressions$
    .pipe(take(1), delay(waitTime))
    .toPromise()
  const receivingSecondImpression = impressions$
    .pipe(skip(1), take(1))
    .toPromise()
  const receivingVastError = receiveVastError(tracking$).toPromise()

  await openPage()
  const errorMessage = await Promise.race([
    receivingFirstImpressionWithDelay.then(() => false),
    receivingSecondImpression.then(() => 'Multiple AdImpressions received'),
    receivingVastError.then(code => `VAST error tracker fired: ${code}`)
  ])
  t.false(errorMessage)
})

test('VPAID unit correctly publishes quartile events', t => {
  const maxEventTimeDrift = 1000 // Maximum difference to expected event time
  const maxEventWaitingTime = 3000 // Maximum time to wait before timeout

  return _from(setUpVpaidTest(t, vpaidUrl, adParameters)).pipe(
    mergeMap(({ pageOpen$, tracking$ }) => {
      const duration$ = receiveVpaidCalls(tracking$, 'getAdDuration').pipe(
        map(({ payload: { result } }) => result),
        share()
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
        ),
        startWith([]),
        share()
      )

      const lastQuartileEvent$ = quartileEvents$.pipe(
        materialize(),
        filter(({ kind }) => kind === 'C'),
        take(1)
      )

      const succeeding$ = _combineLatest(
        duration$,
        quartileEvents$,
        lastQuartileEvent$
      )

      const becomingIdle$ = _combineLatest(
        duration$,
        quartileEvents$,
        _timer(0, 100)
      ).pipe(
        map(([duration, history]) => {
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

      const adStopped$ = receiveVpaidEvent(tracking$, 'AdStopped')

      const vastError$ = receiveVastError(tracking$)

      const failing$ = _race(
        [
          becomingIdle$.pipe(
            mapTo('Timed out waiting for next quartile event')
          ),
          adStopped$.pipe(mapTo('AdStopped published before quartile events')),
          vastError$.pipe(map(code => `VAST error tracker fired: ${code}`))
        ].map(obs =>
          _combineLatest(obs, quartileEvents$).pipe(
            tap(([errorMessage, history]) => {
              const historyStr =
                history.length > 0
                  ? history
                    .map(([time, name]) => `${name} at ${time}`)
                    .join(', ')
                  : '(no events)'
              t.fail(`${errorMessage}, history: ${historyStr}`)
            })
          )
        )
      )

      return pageOpen$.pipe(mergeMapTo(_race(succeeding$, failing$)), take(1))
    }),
    map(([duration, history]) => {
      t.true(duration > 0, 'invalid duration reported')

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
  )
})
