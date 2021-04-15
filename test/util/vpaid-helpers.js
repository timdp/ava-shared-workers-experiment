const debug = require('debug')('browsertest:test:vpaid')
const { defer: $defer, from: $from } = require('rxjs')
const { filter, ignoreElements, map, take, tap } = require('rxjs/operators')
const browser = require('../../lib/browser')
const httpd = require('../../lib/httpd')
const getFixturePath = require('./get-fixture-path')
const receiveTeardown = require('../../lib/util/receive-teardown')

const ofType = desiredType => filter(({ type }) => type === desiredType)

const receiveTracking = dir =>
  dir
    .expectRequests({
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
        debug(`[${date.toISOString()}] ${message}`)
      }),
      ignoreElements()
    )
    .subscribe()

const setUpVpaidTest = async (t, vpaidUrl, adParameters) => {
  const teardown$ = receiveTeardown(t)
  const fixturePath = getFixturePath('ima-player-vpaid-spy')
  const dir = await httpd.hostDir(t, {
    path: fixturePath,
    templateVars: {
      vpaidUrl,
      adParameters,
      debug: debug.enabled
    }
  })
  const tracking$ = receiveTracking(dir)
  if (debug.enabled) {
    proxyLogs(tracking$)
  }
  const openPage = async () => {
    await browser.openPage(t, {
      url: dir.getFileUrl('index.html')
    })
  }
  const pageOpen$ = $defer(() => $from(openPage()))
  return {
    dir,
    openPage,
    teardown$,
    tracking$,
    pageOpen$
  }
}

const receiveEvents = (tracking$, type) => tracking$.pipe(ofType(type))

const receiveEvent = (tracking$, type) =>
  receiveEvents(tracking$, type).pipe(take(1))

const receiveVpaidEvents = (tracking$, eventName) =>
  receiveEvents(tracking$, 'vpaid-event').pipe(
    filter(({ payload: { name } }) => name === eventName)
  )

const receiveVpaidEvent = (tracking$, eventName) =>
  receiveVpaidEvents(tracking$, eventName).pipe(take(1))

const receiveVpaidCalls = (tracking$, methodName) =>
  receiveEvents(tracking$, 'vpaid-call').pipe(
    filter(({ payload: { name } }) => name === methodName)
  )

const receiveVpaidCall = (tracking$, methodName) =>
  receiveVpaidCalls(tracking$, methodName).pipe(take(1))

const receiveVastError = tracking$ =>
  receiveEvent(tracking$, 'vast-error').pipe(
    map(({ payload: { code } }) => code)
  )

module.exports = {
  setUpVpaidTest,
  receiveEvents,
  receiveEvent,
  receiveVpaidEvents,
  receiveVpaidEvent,
  receiveVpaidCalls,
  receiveVpaidCall,
  receiveVastError
}
