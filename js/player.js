var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.player = (function () {
    // Reading webapis.avplay can throw when the privilege was not granted: probe defensively.
    function avplay() {
        try {
            return typeof webapis !== "undefined" && webapis.avplay ? webapis.avplay : null
        } catch {
            return null
        }
    }
    let video = null
    let surface = null
    let handlers = {}
    let startTimer = null
    let activeUrl = ""
    let playbackGeneration = 0
    let displayRectGeneration = -1
    let playbackStarted = false

    // A stream that never answers sends no error event; give up after this.
    const START_TIMEOUT_MS = 12000

    // AVPlay reports PLAYER_ERROR_* codes; the viewer needs words.
    const REASONS = {
        PLAYER_ERROR_CONNECTION_FAILED: "No connection to the channel",
        PLAYER_ERROR_TIMEOUT: "The channel took too long to answer",
        PLAYER_ERROR_NOT_SUPPORTED_FORMAT: "This TV cannot play that format",
        PLAYER_ERROR_INVALID_URI: "The channel address is not valid",
        PLAYER_ERROR_NOT_AVAILABLE: "The channel is not available right now",
        PLAYER_ERROR_STREAMING_FAILED: "The channel stopped the stream",
    }

    function describe(error) {
        if (!error) return "Could not open the channel"
        if (error.name && REASONS[error.name]) return REASONS[error.name]
        if (error.message) return error.message
        if (typeof error === "string") return error
        return "Could not open the channel"
    }

    let resizeBound = false

    let currentAspectRatio = "contain"

    function setAspectRatio(mode) {
        currentAspectRatio = mode || "contain"
        if (video) {
            video.style.objectFit =
                currentAspectRatio === "fill"
                    ? "fill"
                    : currentAspectRatio === "cover"
                      ? "cover"
                      : "contain"
        }
        if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.style.setProperty(
                "--player-fit",
                currentAspectRatio === "fill"
                    ? "fill"
                    : currentAspectRatio === "cover"
                      ? "cover"
                      : "contain",
            )
        }
        const AV = avplay()
        if (AV) {
            try {
                if (currentAspectRatio === "fill") {
                    AV.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN")
                } else if (currentAspectRatio === "cover") {
                    AV.setDisplayMethod("PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO")
                } else {
                    AV.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX")
                }
            } catch {}
        }
    }

    function init(videoEl, callbacks) {
        video = videoEl || document.getElementById("videoPlayer")
        surface = document.getElementById("avPlayer")
        handlers = callbacks || {}
        if (video) {
            video.style.objectFit =
                currentAspectRatio === "fill"
                    ? "fill"
                    : currentAspectRatio === "cover"
                      ? "cover"
                      : "contain"
        }
        if (!resizeBound) {
            window.addEventListener("resize", resize)
            resizeBound = true
        }
    }

    function hardware() {
        return !!avplay()
    }

    let lastRect = null

    // AVPlay and HTML5 Surface layout management: Preview vs Fullscreen
    function setRect(rect) {
        if (rect !== undefined) lastRect = rect
        const surfaceEl = document.getElementById("videoSurface")
        const isPreview = !!(lastRect && lastRect.w > 2 && lastRect.h > 2)
        if (surfaceEl) {
            surfaceEl.classList.remove("hidden")
            if (isPreview) {
                surfaceEl.classList.remove("fullscreen")
                surfaceEl.classList.add("preview")
                const stage = document.getElementById("previewStage")
                const box = stage && stage.getBoundingClientRect ? stage.getBoundingClientRect() : null
                if (box && box.width > 2) {
                    surfaceEl.style.left = `${Math.round(box.left)}px`
                    surfaceEl.style.top = `${Math.round(box.top)}px`
                    surfaceEl.style.width = `${Math.round(box.width)}px`
                    surfaceEl.style.height = `${Math.round(box.height)}px`
                } else if (lastRect) {
                    surfaceEl.style.left = `${Math.round(lastRect.x)}px`
                    surfaceEl.style.top = `${Math.round(lastRect.y)}px`
                    surfaceEl.style.width = `${Math.round(lastRect.w)}px`
                    surfaceEl.style.height = `${Math.round(lastRect.h)}px`
                }
            } else {
                surfaceEl.classList.remove("preview")
                surfaceEl.classList.add("fullscreen")
                surfaceEl.style.left = "0px"
                surfaceEl.style.top = "0px"
                surfaceEl.style.width = "100vw"
                surfaceEl.style.height = "100vh"
            }
        }
        const AV = avplay()
        if (AV) {
            const area = isPreview ? lastRect : { x: 0, y: 0, w: 1920, h: 1080 }
            try {
                AV.setDisplayRect(
                    Math.round(area.x),
                    Math.round(area.y),
                    Math.round(area.w),
                    Math.round(area.h),
                )
            } catch {}
        }
    }

    function clearRect() {
        lastRect = null
        setRect(null)
    }

    function resize(rect) {
        setRect(rect)
    }

    function state() {
        const AV = avplay()
        if (AV) {
            try {
                return AV.getState()
            } catch {
                return "IDLE"
            }
        }
        if (!video || (!video.src && !tsPlayer)) return "IDLE"
        return video.paused ? "PAUSED" : "PLAYING"
    }

    function clearStart() {
        if (startTimer) {
            clearTimeout(startTimer)
            startTimer = null
        }
    }

    // Without the <object type="application/avplayer"> surface it plays audio and paints nothing.
    function checkSurface() {
        if (!avplay()) return true
        if (!surface) surface = document.getElementById("avPlayer")
        if (!surface)
            console.error(
                'AVPlay sin <object type="application/avplayer">: se oira pero no se vera',
            )
        return !!surface
    }

    let stallCheckInterval = null
    let lastPlaybackTime = 0
    let stallCounter = 0

    function clearStallWatchdog() {
        if (stallCheckInterval) {
            clearInterval(stallCheckInterval)
            stallCheckInterval = null
        }
        lastPlaybackTime = 0
        stallCounter = 0
    }

    function startStallWatchdog(generation) {
        clearStallWatchdog()
        stallCheckInterval = setInterval(() => {
            if (generation !== playbackGeneration || !video) return
            if (video.paused || video.ended) {
                stallCounter = 0
                return
            }

            // 1. Buffer Gap Detection & Auto-Jumping (handles IPTV PTS jumps)
            if (video.buffered && video.buffered.length > 0) {
                const cur = video.currentTime
                for (let i = 0; i < video.buffered.length; i++) {
                    const bStart = video.buffered.start(i)
                    if (bStart > cur && bStart - cur < 1.4) {
                        video.currentTime = bStart + 0.05
                        video.play().catch(() => {})
                        stallCounter = 0
                        return
                    }
                }
            }

            // 2. Stall Detection (currentTime stuck while unpaused)
            if (Math.abs(video.currentTime - lastPlaybackTime) < 0.1 && video.readyState >= 1) {
                stallCounter++
                if (stallCounter >= 4) {
                    video.play().catch(() => {})
                }
                if (stallCounter >= 12) {
                    stallCounter = 0
                    if (activeUrl && generation === playbackGeneration) {
                        const currentUrl = activeUrl
                        const isVod = store && store.state && store.state.playing && store.isVod(store.state.playing.channel)
                        const resume = isVod ? (video.currentTime || 0) : 0
                        play(currentUrl, lastRect, resume)
                    }
                }
            } else {
                stallCounter = 0
                lastPlaybackTime = video.currentTime
            }
        }, 1000)
    }

    function fail(error, generation) {
        if (generation !== undefined && generation !== playbackGeneration) return
        clearStart()
        clearStallWatchdog()
        activeUrl = ""
        playbackStarted = false
        playbackGeneration++
        console.error("playback error:", error)
        if (handlers.onError) handlers.onError(describe(error))
    }

    function started(generation) {
        if (generation !== undefined && generation !== playbackGeneration) return
        clearStart()
        startStallWatchdog(generation)
        if (avplay() && displayRectGeneration !== generation) {
            setRect()
            displayRectGeneration = generation
        }
        if (!playbackStarted) {
            playbackStarted = true
            if (handlers.onStart) handlers.onStart()
        }
    }

    function waitForStart(generation) {
        clearStart()
        startTimer = setTimeout(() => {
            startTimer = null
            fail({ message: "The channel is not responding" }, generation)
        }, START_TIMEOUT_MS)
    }

    let tsPlayer = null

    function destroyTsPlayer() {
        if (tsPlayer) {
            try {
                tsPlayer.pause()
            } catch (e) {}
            try {
                tsPlayer.unload()
            } catch (e) {}
            try {
                tsPlayer.detachMediaElement()
            } catch (e) {}
            try {
                tsPlayer.destroy()
            } catch (e) {}
            tsPlayer = null
        }
        if (video) {
            try {
                video.pause()
                video.removeAttribute("src")
                video.load()
            } catch (e) {}
        }
    }

    function clearVideo() {
        destroyTsPlayer()
        if (!video) return
        video.removeAttribute("src")
        try {
            video.load()
        } catch {}
    }

    function killUpstream() {
        if (typeof window !== "undefined" && window.location) {
            const isLocal =
                window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1"
            if (isLocal) {
                try {
                    fetch(`${window.location.origin}/kill-stream`, {
                        method: "POST",
                        keepalive: true,
                    }).catch(() => {})
                } catch {}
            }
        }
    }

    function stop() {
        playbackGeneration++
        playbackStarted = false
        clearStart()
        clearStallWatchdog()
        destroyTsPlayer()
        const AV = avplay()
        if (AV) {
            try {
                const s = state()
                if (s === "PLAYING" || s === "PAUSED") AV.stop()
            } catch {}
            try {
                const s = state()
                if (s !== "NONE") AV.close()
            } catch {}
        }
        clearVideo()
        activeUrl = ""
        const surfaceEl = document.getElementById("videoSurface")
        if (surfaceEl) {
            surfaceEl.classList.remove("preview", "fullscreen")
            surfaceEl.classList.add("hidden")
        }
    }

    function proxifyStream(rawUrl) {
        if (!rawUrl) return rawUrl
        if (typeof window !== "undefined" && window.location) {
            const host = window.location.hostname
            const port = window.location.port
            const isLocal =
                host === "localhost" ||
                host === "127.0.0.1" ||
                /^192\.168\./.test(host) ||
                /^10\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
                port === "8090" ||
                host.includes("onrender.com")
            if (isLocal && /^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith(window.location.origin)) {
                return `${window.location.origin}/proxy?stream=1&url=${encodeURIComponent(rawUrl)}`
            }
        }
        return rawUrl
    }

    // Fallback for environments without AVPlay: browser, webOS, PC, Public install.
    function playWithVideo(url, resumeAt, generation, audioDisabled) {
        if (!video) {
            video = document.getElementById("videoPlayer")
        }
        if (!video) {
            fail(new Error("No player available"), generation)
            return
        }
        destroyTsPlayer()
        video.muted = false
        video.volume = 1.0

        const streamUrl = proxifyStream(url)
        const isVodChannel =
            (App.store &&
                App.store.state &&
                App.store.state.playing &&
                App.store.isVod &&
                App.store.isVod(App.store.state.playing.channel)) ||
            /\.(mp4|mkv|avi|mov|webm)(\?|$)/i.test(url)

        const isHls = /\.m3u8(\?|$)/i.test(url)

        // Live MPEG-TS playback via mpegts.js (buffer 16MB + anti-stalling)
        if (!isVodChannel && !isHls && typeof mpegts !== "undefined" && mpegts.isSupported()) {
            try {
                const config = {
                    enableWorker: true,
                    lazyLoad: false,
                    enableStashBuffer: true,
                    stashInitialSize: 768, // 768 KB initial buffer: rock-solid anti-stutter pipeline
                    autoCleanupSourceBuffer: true,
                    autoCleanupMaxBackwardDuration: 30,
                    autoCleanupMinBackwardDuration: 15,
                    fixAudioTimestampGap: true,
                    liveBufferLatencyChasing: false,
                    liveSync: false,
                    liveBufferLatencyMaxLatency: 180,
                    liveBufferLatencyMinRemain: 8,
                }
                const dataSource = {
                    type: "mse",
                    isLive: true,
                    url: streamUrl,
                    hasVideo: true,
                    hasAudio: !audioDisabled,
                }
                tsPlayer = mpegts.createPlayer(dataSource, config)
                tsPlayer.attachMediaElement(video)
                tsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
                    if (generation !== playbackGeneration) return
                    const str = String(detail || info || "").toLowerCase()
                    if (!audioDisabled && (str.includes("ac-3") || str.includes("ac3") || str.includes("addsourcebuffer") || str.includes("audio"))) {
                        console.warn("MPEG-TS audio buffer issue, trying direct hardware audio...", str)
                        destroyTsPlayer()
                        video.muted = false
                        video.volume = 1.0
                        video.src = streamUrl
                        video.play()
                            .then(() => started(generation))
                            .catch((directErr) => {
                                console.warn("Direct video fallback failed, using video-only mpegts:", directErr)
                                playWithVideo(url, resumeAt, generation, true)
                            })
                        return
                    }
                    console.warn("mpegts error:", type, detail, info)
                    fail(new Error("Erreur de flux vidéo"), generation)
                })
                waitForStart(generation)
                tsPlayer.load()
                video.play()
                    .then(() => started(generation))
                    .catch((err) => {
                        if (generation !== playbackGeneration) return
                        if (err && (err.name === "AbortError" || String(err.message || "").includes("interrupted"))) {
                            return
                        }
                        if (err && err.name === "NotAllowedError") {
                            video.muted = true
                            video.play().then(() => started(generation)).catch((e) => {
                                if (generation === playbackGeneration && e && e.name !== "AbortError") fail(e, generation)
                            })
                        } else {
                            fail(err, generation)
                        }
                    })
                return
            } catch (err) {
                console.warn("mpegts init failed, falling back to direct video:", err)
            }
        }

        // Direct HTML5 Video for VOD (Movies & Series: MP4, MKV) and HLS
        video.src = streamUrl
        if (resumeAt > 0) {
            video.addEventListener(
                "loadedmetadata",
                () => {
                    if (Math.abs(video.currentTime - resumeAt) > 2) {
                        try {
                            video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 1))
                        } catch (error) {
                            console.warn("Could not resume playback position:", error)
                        }
                    }
                },
                { once: true },
            )
        }
        const onVideoError = () => {
            if (generation === playbackGeneration) {
                fail(new Error("Impossible de lire ce flux vidéo"), generation)
            }
        }
        video.addEventListener("error", onVideoError, { once: true })
        waitForStart(generation)
        video
            .play()
            .then(() => started(generation))
            .catch((error) => {
                if (generation !== playbackGeneration) return
                if (error && (error.name === "AbortError" || String(error.message || "").includes("interrupted"))) {
                    return
                }
                if (error && error.name === "NotAllowedError") {
                    video.muted = true
                    video.play().then(() => started(generation)).catch((e) => {
                        if (generation === playbackGeneration && e && e.name !== "AbortError") fail(e, generation)
                    })
                } else {
                    fail(error, generation)
                }
            })
    }

    function play(url, rect, resumeAt) {
        if (!url) return
        if (activeUrl === url && state() !== "IDLE") {
            lastRect = rect || null
            setRect()
            return
        }
        stop()
        const generation = ++playbackGeneration
        playbackStarted = false
        activeUrl = url
        lastRect = rect || null
        setRect(rect)

        const AV = avplay()
        if (AV) {
            checkSurface()
            try {
                try {
                    const s = state()
                    if (s === "PLAYING" || s === "PAUSED") AV.stop()
                    if (state() !== "NONE") AV.close()
                } catch {}
                AV.open(url)
                setRect()
                AV.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX")
                AV.setListener({
                    onerror: function (error) {
                        fail(error, generation)
                    },
                    onbufferingcomplete: function () {
                        started(generation)
                    },
                    oncurrentplaytime: function () {
                        if (!playbackStarted) started(generation)
                    },
                    onstreamcompleted: function () {
                        if (generation === playbackGeneration && handlers.onEnd) handlers.onEnd()
                    },
                })
                waitForStart(generation)
                AV.prepareAsync(
                    () => {
                        if (generation !== playbackGeneration) return
                        const resume = Number(resumeAt) || 0
                        const startPlayback = () => {
                            if (generation !== playbackGeneration) return
                            try {
                                AV.play()
                            } catch (err) {
                                fail(err, generation)
                                return
                            }
                            if (resume > 0 && typeof AV.seekTo === "function") {
                                try {
                                    AV.seekTo(
                                        Math.round(resume * 1000),
                                        () => started(generation),
                                        (error) => {
                                            started(generation)
                                            if (handlers.onResumeError)
                                                handlers.onResumeError(error)
                                        },
                                    )
                                } catch (error) {
                                    started(generation)
                                    if (handlers.onResumeError) handlers.onResumeError(error)
                                }
                            } else {
                                started(generation)
                            }
                        }
                        startPlayback()
                    },
                    (error) => {
                        fail(error, generation)
                    },
                )
                return
            } catch (error) {
                console.error("AVPlay no disponible, se usa <video>:", error)
            }
        }

        playWithVideo(url, Number(resumeAt) || 0, generation)
    }

    function unmute() {
        if (video && video.muted) {
            video.muted = false
            video.volume = 1.0
        }
    }

    function currentTime() {
        const AV = avplay()
        if (AV) {
            try {
                return Math.max(0, Number(AV.getCurrentTime()) / 1000 || 0)
            } catch {}
        }
        return video ? Number(video.currentTime) || 0 : 0
    }

    function playbackInfo() {
        const AV = avplay()
        if (AV) {
            let position = 0
            let duration = 0
            let tracks = []
            try {
                position = Math.max(0, Number(AV.getCurrentTime()) / 1000 || 0)
            } catch {}
            try {
                duration = Math.max(0, Number(AV.getDuration()) / 1000 || 0)
            } catch {}
            try {
                const available = AV.getTotalTrackInfo()
                tracks = Array.isArray(available) ? available : []
            } catch {}
            const canSeek =
                typeof AV.seekTo === "function" && duration > 5 && isFinite(duration)
            return {
                position,
                duration,
                tracks,
                canSeek,
                canSelectAudio:
                    typeof AV.setSelectTrack === "function" &&
                    tracks.some((track) => track.type === "AUDIO"),
                canSelectSubtitle:
                    typeof AV.setSelectTrack === "function" &&
                    tracks.some((track) => track.type === "SUBTITLE" || track.type === "TEXT"),
            }
        }
        if (!video)
            return {
                position: 0,
                duration: 0,
                tracks: [],
                canSeek: false,
                canSelectAudio: false,
                canSelectSubtitle: false,
            }
        const tracks = []
        try {
            const audioTracks = video.audioTracks
            for (let i = 0; audioTracks && i < audioTracks.length; i++) {
                const at = audioTracks[i]
                tracks.push({
                    type: "AUDIO",
                    index: i,
                    extra_info: {
                        language: at.language || "",
                        label: at.label || at.language || `Piste ${i + 1}`,
                    },
                })
            }
        } catch {}
        try {
            const textTracks = video.textTracks
            for (let i = 0; textTracks && i < textTracks.length; i++) {
                const tt = textTracks[i]
                tracks.push({
                    type: "SUBTITLE",
                    index: i,
                    extra_info: {
                        language: tt.language || "",
                        label: tt.label || tt.language || `Sous-titre ${i + 1}`,
                    },
                })
            }
        } catch {}
        const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0
        return {
            position: Number(video.currentTime) || 0,
            duration: dur,
            tracks,
            canSeek: isFinite(dur) && dur > 5,
            canSelectAudio: tracks.some((t) => t.type === "AUDIO"),
            canSelectSubtitle: tracks.some((t) => t.type === "SUBTITLE"),
        }
    }

    let isSeeking = false
    let pendingSeek = null

    function seekTo(seconds, onDone) {
        const target = Math.max(0, Number(seconds) || 0)
        const AV = avplay()
        if (AV) {
            const s = state()
            if (s !== "PLAYING" && s !== "PAUSED" && s !== "READY") return false
            if (typeof AV.seekTo !== "function") return false

            if (isSeeking) {
                pendingSeek = target
                return true
            }

            isSeeking = true
            try {
                AV.seekTo(
                    Math.round(target * 1000),
                    function () {
                        isSeeking = false
                        if (pendingSeek !== null) {
                            const next = pendingSeek
                            pendingSeek = null
                            seekTo(next, onDone)
                        } else if (onDone) {
                            onDone()
                        }
                    },
                    function (err) {
                        isSeeking = false
                        pendingSeek = null
                        console.warn("AVPlay seek error:", err)
                    },
                )
                return true
            } catch (error) {
                isSeeking = false
                pendingSeek = null
                console.error("AVPlay seek failed:", error)
                return false
            }
        }
        if (!video) return false
        try {
            if (isFinite(video.duration) && video.duration > 0) {
                video.currentTime = Math.min(target, video.duration)
            } else {
                video.currentTime = target
            }
            if (onDone) onDone()
            return true
        } catch (err) {
            console.warn("video seek error:", err)
            return false
        }
    }

    function selectTrack(type, index) {
        const AV = avplay()
        if (AV) {
            if (typeof AV.setSelectTrack !== "function") return false
            try {
                AV.setSelectTrack(type === "SUBTITLE" ? "TEXT" : type, index)
                return true
            } catch (error) {
                console.error("AVPlay track selection failed:", error)
                return false
            }
        }
        if (!video) return false
        if (type === "SUBTITLE") {
            const collection = video.textTracks
            if (!collection) return false
            if (index < 0) {
                for (let i = 0; i < collection.length; i++) collection[i].mode = "disabled"
                return true
            }
            if (!collection[index]) return false
            for (let i = 0; i < collection.length; i++) {
                collection[i].mode = i === index ? "showing" : "disabled"
            }
            return true
        }
        if (type === "AUDIO") {
            const collection = video.audioTracks
            if (!collection || !collection[index]) return false
            for (let i = 0; i < collection.length; i++) {
                collection[i].enabled = i === index
            }
            return true
        }
        return false
    }

    function isPlayingUrl(url) {
        return !!url && activeUrl === url && state() !== "IDLE"
    }

    function pause() {
        const AV = avplay()
        if (AV) {
            try {
                const s = state()
                if (s === "PLAYING") {
                    AV.pause()
                    return "PAUSED"
                }
            } catch (err) {
                console.warn("AVPlay pause error:", err)
            }
            return state()
        }
        if (video && !video.paused) {
            try {
                video.pause()
            } catch (err) {}
            return "PAUSED"
        }
        return state()
    }

    function resume() {
        const AV = avplay()
        if (AV) {
            try {
                const s = state()
                if (s === "PAUSED" || s === "READY") {
                    AV.play()
                    return "PLAYING"
                }
            } catch (err) {
                console.warn("AVPlay resume error:", err)
            }
            return state()
        }
        if (video && video.paused) {
            video.play().catch(() => {})
            return "PLAYING"
        }
        return state()
    }

    function toggle() {
        const s = state()
        if (s === "PLAYING") {
            return pause()
        }
        return resume()
    }

    return {
        init,
        play,
        stop,
        pause,
        resume,
        toggle,
        state,
        playbackInfo,
        currentTime,
        unmute,
        seekTo,
        selectTrack,
        isPlayingUrl,
        clearRect,
        resize,
        describe,
        hardware,
        setAspectRatio,
        aspectRatio: () => currentAspectRatio,
    }
})()
