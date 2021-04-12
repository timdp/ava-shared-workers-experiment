;(() => {
  const METHODS = [
    'initAd',
    'resizeAd',
    'startAd',
    'stopAd',
    'pauseAd',
    'resumeAd',
    'expandAd',
    'collapseAd',
    'skipAd'
  ]
  const PROPERTIES = {
    Linear: true,
    Width: 16,
    Height: 9,
    Expanded: false,
    SkippableState: false,
    RemainingTime: -2,
    Duration: -2,
    Volume: -1,
    Companions: '',
    Icons: false
  }
  const EVENTS = [
    'AdLoaded',
    'AdStarted',
    'AdSkipped',
    'AdSkippableStateChange',
    'AdSizeChange',
    'AdLinearChange',
    'AdDurationChange',
    'AdExpandedChange',
    'AdRemainingTimeChange',
    'AdVolumeChange',
    'AdImpression',
    'AdVideoStart',
    'AdVideoFirstQuartile',
    'AdVideoMidpoint',
    'AdVideoThirdQuartile',
    'AdVideoComplete',
    'AdClickThru',
    'AdInteraction',
    'AdUserAcceptInvitation',
    'AdUserMinimize',
    'AdUserClose',
    'AdPaused',
    'AdPlaying',
    'AdLog',
    'AdError'
  ]

  const config = new URLSearchParams(
    new URL(document.currentScript.src).hash.substr(1)
  )
  const originUrl = config.get('origin')
  const vpaidUrl = config.get('vpaid')
  const debug = config.get('debug') === 'true'

  const trackingUrl = originUrl + '/track'
  const subscribers = {}

  let guestVpaidAd

  const sanitize = (value, seen = []) => {
    if (value == null) {
      return null
    }
    if (typeof value !== 'object') {
      return value
    }
    const idx = seen.indexOf(value)
    if (idx >= 0) {
      return `[Circular~${idx}]`
    }
    seen.push(value)
    if (Array.isArray(value)) {
      return value.map(el => sanitize(el, seen))
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== null && proto !== Object.prototype) {
      return String(value)
    }
    return Object.fromEntries(
      [...Object.entries(value)].map(([k, v]) => [k, sanitize(v, seen)])
    )
  }

  const track = (type, payload) => {
    const data = {
      timestamp: Date.now(),
      type,
      payload: sanitize(payload)
    }
    const qs = 'data=' + encodeURIComponent(JSON.stringify(data))
    const url = trackingUrl + '?' + qs
    navigator.sendBeacon(url)
  }

  const log = debug
    ? message => {
      console.log(message)
      track('log', { message })
    }
    : () => {}

  const proxyEvents = () => {
    log('Proxying events')
    for (const name of EVENTS) {
      guestVpaidAd.subscribe((...args) => {
        track('vpaid-event', { name, args })
        const subs = subscribers[name]
        if (subs == null) {
          if (name !== 'AdRemainingTimeChange') {
            log(`Not proxying ${name} event, no subscribers`)
          }
          return
        }
        if (name !== 'AdRemainingTimeChange') {
          log(`Proxying ${name} event to ${subs.length} subscriber(s)`)
        }
        for (const { fn, scope } of subs) {
          fn.apply(scope, args)
        }
      }, name)
    }
  }

  const loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.onload = () => {
      log('Script loaded, getting VPAID ad')
      guestVpaidAd = window.getVPAIDAd()
      if (guestVpaidAd == null || hostVpaidAd === guestVpaidAd) {
        log('Guest VPAID initialization failed')
        reject(new Error('Guest VPAID initialization failed'))
        return
      }
      log('Performing VPAID handshake')
      guestVpaidAd.handshakeVersion('2.0')
      proxyEvents()
      resolve()
    }
    script.onerror = () => {
      log('Guest VPAID script load failed')
      reject(new Error('Guest VPAID script load failed'))
    }
    script.src = vpaidUrl
    log(`Inserting script ${vpaidUrl}`)
    document.body.appendChild(script)
  })

  const proxyCall = (name, args) => {
    if (name !== 'getAdRemainingTime') {
      log(`Proxying ${name}(${args.map(arg => String(arg)).join(', ')}) call`)
    }
    const result = guestVpaidAd[name]()
    if (name !== 'getAdRemainingTime') {
      log(`Proxied ${name}() call, got ${result}`)
    }
    track('vpaid-call', { name, args: [], result })
    return result
  }

  const hostVpaidAd = {
    handshakeVersion: ver => ver,
    subscribe: (fn, event, scope) => {
      log(`Adding subscriber for ${event}`)
      subscribers[event] = subscribers[event] || []
      subscribers[event].push({ fn, scope })
    },
    unsubscribe: (fn, event) => {
      log(`Removing subscriber for ${event}`)
      if (subscribers[event] == null) {
        return
      }
      const idx = subscribers[event].findIndex(s => s.fn === fn)
      if (idx < 0) {
        return
      }
      subscribers[event].splice(idx, 1)
    },
    setAdVolume: volume => {
      if (guestVpaidAd == null) {
        log(`Not proxying setAdVolume(${volume}) call, guest not available`)
        return
      }
      proxyCall('setAdVolume', [volume])
    }
  }

  for (const name of METHODS) {
    hostVpaidAd[name] = (...args) => {
      log(`Scheduling ${name}()`)
      loading.then(() => {
        proxyCall(name, args)
      })
    }
  }

  for (const [name, defaultValue] of Object.entries(PROPERTIES)) {
    const fn = 'getAd' + name
    hostVpaidAd[fn] = () => {
      if (guestVpaidAd == null) {
        if (fn !== 'getAdRemainingTime') {
          log(`Not proxying ${fn}() call, returning default ${defaultValue}`)
        }
        return defaultValue
      }
      return proxyCall(fn, [])
    }
  }

  window.getVPAIDAd = () => {
    log('Player called getVPAIDAd()')
    return hostVpaidAd
  }
})()
