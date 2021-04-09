/* global google */

;(() => {
  const ima = google.ima
  const {
    AdDisplayContainer,
    AdErrorEvent,
    AdsLoader,
    AdsManagerLoadedEvent,
    AdsRenderingSettings,
    AdsRequest,
    ViewMode
  } = ima

  const videoContent = document.getElementById('contentElement')
  const adContainer = document.getElementById('adContainer')
  const adDisplayContainer = new AdDisplayContainer(adContainer, videoContent)
  const adsLoader = new AdsLoader(adDisplayContainer)

  let adsManager = null
  let done = false

  const destroyAdsManager = () => {
    if (adsManager == null) {
      return
    }
    adsManager.destroy()
    adsManager = null
  }

  const onAdError = () => {
    if (done) {
      return
    }
    done = true
    destroyAdsManager()
  }

  const onAdErrorEvent = adErrorEvent => {
    const error = adErrorEvent.getError()
    onAdError(error)
  }

  const onAdsManagerLoaded = adsManagerLoadedEvent => {
    const adsRenderingSettings = new AdsRenderingSettings()

    adsManager = adsManagerLoadedEvent.getAdsManager(
      videoContent,
      adsRenderingSettings
    )
    adsManager.addEventListener(AdErrorEvent.Type.AD_ERROR, onAdErrorEvent)

    adDisplayContainer.initialize()

    try {
      adsManager.init(window.innerWidth, window.innerHeight, ViewMode.NORMAL)
      adsManager.setVolume(0)
      adsManager.start()
    } catch (error) {
      onAdError(error)
    }
  }

  videoContent.defaultMuted = true

  adsLoader.addEventListener(
    AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
    onAdsManagerLoaded
  )
  adsLoader.addEventListener(AdErrorEvent.Type.AD_ERROR, onAdErrorEvent)

  const adsRequest = new AdsRequest()
  adsRequest.adTagUrl = new URL('vast.xml', window.location.href).href
  adsRequest.linearAdSlotWidth = window.innerWidth
  adsRequest.linearAdSlotHeight = window.innerHeight
  adsRequest.setAdWillPlayMuted(true)

  adsLoader.requestAds(adsRequest)
})()
