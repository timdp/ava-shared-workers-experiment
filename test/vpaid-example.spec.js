const test = require('ava')
const {
  EMPTY: EMPTY$,
  combineLatest: $combineLatest,
  from: $from,
  merge: $merge,
  of: $of,
  race: $race,
  timer: $timer,
  throwError: $throwError,
  firstValueFrom
} = require('rxjs')
const {
  catchError,
  delay,
  filter,
  ignoreElements,
  last,
  map,
  mapTo,
  mergeMap,
  mergeMapTo,
  share,
  skip,
  take,
  tap,
  timeout
} = require('rxjs/operators')
const accumulate = require('./util/accumulate')
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

  const receivingAdImpression = firstValueFrom(
    receiveVpaidEvent(tracking$, 'AdImpression')
  )
  const receivingVastError = firstValueFrom(receiveVastError(tracking$))

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

  const receivingFirstImpressionWithDelay = firstValueFrom(
    impressions$.pipe(take(1), delay(waitTime))
  )
  const receivingSecondImpression = firstValueFrom(
    impressions$.pipe(skip(1), take(1))
  )
  const receivingVastError = firstValueFrom(receiveVastError(tracking$))

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
  const maxFirstEventWaitingTime = 2000 // Maximum time before AdVideoStart
  const maxQuartileWaitingTime = 3000 // Maximum time to wait between quartiles

  // Set up the test and turn the resulting promise into a stream. This kicks
  // off the reactive pipeline.
  return $from(setUpVpaidTest(t, vpaidUrl, adParameters)).pipe(
    mergeMap(({ pageOpen$, tracking$ }) => {
      // Stream of ad duration updates. Each emitted value is the last known
      // duration.
      const duration$ = receiveVpaidCalls(tracking$, 'getAdDuration').pipe(
        map(({ payload: { result } }) => result),
        share()
      )

      // Stream of published quartile events. Each emitted value is a tuple
      // containing the event time and the event name.
      const quartileEvents$ = $merge(
        ...QUARTILE_EVENT_NAMES.map(name => receiveVpaidEvents(tracking$, name))
      ).pipe(
        take(QUARTILE_EVENT_NAMES.length),
        map(({ date, payload: { name } }) => [date.getTime(), name]),
        share()
      )

      // Accumulated version of the quartile event stream. Each emitted value
      // is an array of all events published so far.
      const quartileEventHistory$ = quartileEvents$.pipe(accumulate(), share())

      // Stream that emits the last event in the stream of histories. The only
      // emitted value is the full history, containing all expected quartile
      // events with their timestamp. This will be used for validating time
      // intervals later on.
      const fullQuartileEventHistory$ = quartileEventHistory$.pipe(
        last(),
        share()
      )

      // Stream that validates that quartiles arrive in the correct order. For
      // each event received, checks if the event is the next logical one. If
      // not, throws with an error message that's caught by the generic error
      // handler. Does not emit any values.
      const failOnQuartilesOutOfOrder$ = quartileEvents$.pipe(
        mergeMap(([time, actualName], idx) => {
          const expectedName = QUARTILE_EVENT_NAMES[idx]
          if (actualName === expectedName) {
            return EMPTY$
          }
          return $throwError(
            `Received ${actualName} event instead of ${expectedName}`
          )
        })
      )

      // Stream that validates that quartiles arrive with an acceptable amount
      // of time in between. For each event received, compares the elapsed time
      // to the expected amount of time between quartile events, based on the
      // ad duration. If the deviation is too large, throws with an error
      // message that's caught by the generic error handler. Does not emit any
      // values.
      const failOnQuartileTimeIntervalInvalid$ = $combineLatest(
        duration$,
        fullQuartileEventHistory$.pipe(skip(1))
      ).pipe(
        mergeMap(([duration, history]) => {
          const [actualTime, name] = history[history.length - 1]
          const [prevTime] = history[history.length - 2]
          const expectedTime =
            prevTime + ((duration * 1000) / 4) * (history.length - 1)
          const diff = actualTime - expectedTime
          if (Math.abs(diff) < maxEventTimeDrift) {
            return EMPTY$
          }
          const kind = diff > 0 ? 'late' : 'early'
          return $throwError(
            `${name} event published too ${kind}: received at ${actualTime} ` +
              `while expected at ${expectedTime}, difference is ${diff} ms`
          )
        })
      )

      // Stream that throws if the first quartile event (i.e., AdVideoStart)
      // does not arrive within the given number of milliseconds. If it does
      // not arrive, the error is caught by the generic error handler. Does not
      // emit any values.
      const failOnFirstQuartileEventTimeout$ = quartileEvents$.pipe(
        take(1),
        timeout(maxFirstEventWaitingTime),
        ignoreElements(),
        catchError(() =>
          $throwError(`Timed out waiting for ${QUARTILE_EVENT_NAMES[0]} event`)
        )
      )

      // Stream that throws if events after AdVideoStart (i.e., the "real"
      // quartile events) do not arrive within a certain amount of time. This
      // is the counterpart to the time interval validation stream in the sense
      // that that one only detects issues if the events actually arrive,
      // whereas this one handles the case where events don't arrive at all.
      // If any event does not arrive, the error is caught by the generic error
      // handler. Does not emit any values.
      const failOnSubsequentQuartileEventTimeout$ = $combineLatest(
        duration$,
        quartileEventHistory$,
        $timer(0, 100)
      ).pipe(
        filter(([duration]) => duration > 0), // TODO Deal with this better
        mergeMap(([duration, history]) => {
          const [prevTime] = history[history.length - 1]
          const expectedTime = prevTime + (duration * 1000) / 4
          if (Date.now() - expectedTime < maxQuartileWaitingTime) {
            return EMPTY$
          }
          const expectedName = QUARTILE_EVENT_NAMES[history.length]
          return $throwError(`Timed out waiting for ${expectedName} event`)
        })
      )

      // Stream that throws when AdStopped is published. The error is caught by
      // the generic error handler. Does not emit any values.
      const failOnAdStopped$ = receiveVpaidEvent(tracking$, 'AdStopped').pipe(
        mergeMapTo(
          $throwError('AdStopped published before final quartile event')
        )
      )

      // Stream that throws when the VAST error tracker is requested. The error
      // is caught by the generic error handler. Does not emit any values.
      const failOnVastError$ = receiveVastError(tracking$).pipe(
        mergeMap(code => $throwError(`VAST error tracker fired: ${code}`))
      )

      // Stream that models test success. The test is considered a success if
      // all quartile events have been published. Hence, this stream emits once:
      // when the last quartile event comes in. The value emitted is true, which
      // is validated below. After that event, it immediately completes.
      const success$ = quartileEvents$.pipe(last(), mapTo(true))

      // Stream that aggregates all the error cases described above. None of
      // them emit any values, but if any of them throws, this stream emits
      // the error message as a value. This is used in the stream below.
      const firstErrorMessage$ = $merge(
        failOnQuartilesOutOfOrder$,
        failOnQuartileTimeIntervalInvalid$,
        failOnFirstQuartileEventTimeout$,
        failOnSubsequentQuartileEventTimeout$,
        failOnAdStopped$,
        failOnVastError$
      ).pipe(
        mergeMap(value =>
          $throwError(`Unexpected value from error stream: ${value}`)
        ),
        catchError(error => $of(error)),
        take(1)
      )

      // Stream that appends the partial quartile event history to the first
      // error that occurs. The first and only event is a combination of the
      // first error (if any) and the last known quartile event history at that
      // point in time, for diagnostic purposes.
      const failure$ = $combineLatest(
        firstErrorMessage$,
        quartileEventHistory$
      ).pipe(
        mergeMap(([errorMessage, history]) => {
          const historyStr =
            history.length > 0
              ? history.map(([time, name]) => `${name} at ${time}`).join(', ')
              : '(no events)'
          return $throwError(`${errorMessage} - history: ${historyStr}`)
        })
      )

      // Subscribe to the page-opening stream, and when the page is available,
      // wait for either success (true is emitted) or error (the stream throws).
      return pageOpen$.pipe(mergeMapTo($race(success$, failure$)), take(1))
    }),
    take(1),
    tap(result => {
      // An event came in. It must be true because that is the only value
      // emitted. Hence, t.pass() would also work here. For good measure, have
      // AVA confirm that it's actually true.
      t.true(result)
    }),
    catchError(errorMessage => {
      // An error was thrown somewhere in the pipeline. It should come from any
      // of the failure streams, which all throw a human-readable message that
      // explains why validation failed. Just pass that on to AVA.
      t.fail(errorMessage)
      return EMPTY$
    })
  )
})
