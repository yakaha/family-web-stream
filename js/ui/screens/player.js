var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const player = App.player
    const html = kit.html
    const useState = kit.useState
    const useEffect = kit.useEffect
    const useRef = kit.useRef
    const clock = kit.clock
    const OVERLAY_MS = 3800

    function formatPosition(value) {
        const num = Number(value)
        if (!isFinite(num) || isNaN(num) || num <= 0) return "00:00"
        const total = Math.max(0, Math.floor(num))
        const hours = Math.floor(total / 3600)
        const minutes = Math.floor((total % 3600) / 60)
        const seconds = total % 60
        return hours
            ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
            : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    }

    App.uiScreens.player = function Player() {
        const state = store.state
        const videoRef = useRef(null)
        const overlayState = useState(true)
        const overlay = overlayState[0]
        const setOverlay = overlayState[1]
        const timer = useRef(null)
        const audioChoiceState = useState(0)
        const audioChoice = audioChoiceState[0]
        const setAudioChoice = audioChoiceState[1]
        const subtitleChoiceState = useState(-1)
        const subtitleChoice = subtitleChoiceState[0]
        const setSubtitleChoice = subtitleChoiceState[1]
        const isFsState = useState(App.isFullscreen ? App.isFullscreen() : false)
        const isFullscreen = isFsState[0]
        const setIsFullscreen = isFsState[1]

        useEffect(() => {
            function updateFs() {
                setIsFullscreen(App.isFullscreen ? App.isFullscreen() : false)
            }
            document.addEventListener("fullscreenchange", updateFs)
            document.addEventListener("webkitfullscreenchange", updateFs)
            return function () {
                document.removeEventListener("fullscreenchange", updateFs)
                document.removeEventListener("webkitfullscreenchange", updateFs)
            }
        }, [])

        function handleExit(e) {
            if (e && e.stopPropagation) e.stopPropagation()
            store.exitPlayer()
        }

        function handleToggleFs(e) {
            if (e && e.stopPropagation) e.stopPropagation()
            if (App.toggleFullscreen) App.toggleFullscreen()
            show()
        }

        useEffect(() => {
            show()
            return function () {
                const goingToPreview = store.state.screen === "tv" && store.state.preview
                if (!goingToPreview) {
                    player.stop()
                }
                if (timer.current) clearTimeout(timer.current)
            }
        }, [])

        useEffect(() => {
            if (state.playing && state.playing.channel) {
                const url = state.playing.channel.url
                if (url && player.isPlayingUrl(url)) {
                    player.resize(null)
                    store.playStarted()
                } else if (url) {
                    player.play(url, null, state.playing.resumeAt || 0)
                }
                show()
            }
        }, [state.playing])

        useEffect(() => {
            document.body.classList.add("playing")
            return function () {
                document.body.classList.remove("playing")
            }
        }, [])

        useEffect(() => {
            const tick = setInterval(() => {
                store.refreshProgram()
            }, 30000)
            return function () {
                clearInterval(tick)
            }
        }, [])

        function updateVodProgress() {
            if (!overlay && !state.menuFocus) return
            if (store.state.virtualSeekPosition !== null && store.state.virtualSeekPosition !== undefined) {
                return
            }
            const info = store.state.playbackInfo || player.playbackInfo()
            if (!info) return
            const ch = state.playing ? state.playing.channel : null
            const pos = isFinite(info.position) ? Math.max(0, info.position) : 0
            const chDur = ch && store.parseDuration ? store.parseDuration(ch.durationSecs || ch.duration_secs || ch.duration) : 0
            const dur = (isFinite(info.duration) && info.duration > 0)
                ? info.duration
                : chDur
            const currentEl = document.getElementById("vodTimeCurrent")
            const totalEl = document.getElementById("vodTimeTotal")
            const seekEl = document.getElementById("vodSeek")
            if (currentEl) currentEl.textContent = formatPosition(pos)
            if (totalEl && dur > 0) totalEl.textContent = formatPosition(dur)
            if (seekEl) {
                if (dur > 0) {
                    seekEl.max = Math.max(1, Math.floor(dur))
                    seekEl.value = Math.min(Math.floor(pos), Math.max(1, Math.floor(dur)))
                    const progress = Math.min(100, (pos / dur) * 100)
                    seekEl.style.setProperty("--seek-progress", `${progress}%`)
                } else {
                    seekEl.value = Math.floor(pos)
                }
            }
        }

        useEffect(() => {
            if (!state.playing || !store.isVod(state.playing.channel)) return
            store.refreshPlayback()
            const tick = setInterval(() => {
                store.refreshPlayback()
                updateVodProgress()
            }, 1000)
            return function () {
                clearInterval(tick)
            }
        }, [state.playing, overlay, state.menuFocus])

        useEffect(() => {
            setAudioChoice(0)
            setSubtitleChoice(-1)
        }, [state.playing])

        function hide() {
            setOverlay(false)
            if (timer.current) {
                clearTimeout(timer.current)
                timer.current = null
            }
            if (store.state.menuFocus && !store.isVod(store.state.playing && store.state.playing.channel)) {
                store.setMenuFocus(false)
                if (App.tv) App.tv.set("playerIdle", 0, 0)
            }
        }

        function show() {
            setOverlay(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                setOverlay(false)
                if (store.state.menuFocus && !store.isVod(store.state.playing && store.state.playing.channel)) {
                    store.setMenuFocus(false)
                    if (App.tv) App.tv.set("playerIdle", 0, 0)
                }
            }, OVERLAY_MS)
        }

        function toggleOverlay() {
            if (overlay || store.state.menuFocus) {
                hide()
            } else {
                show()
            }
        }

        useEffect(() => {
            let lastX = 0
            let lastY = 0
            function onKey() {
                show()
            }
            function onMouseMove(e) {
                if (Math.abs(e.clientX - lastX) > 4 || Math.abs(e.clientY - lastY) > 4) {
                    lastX = e.clientX
                    lastY = e.clientY
                    show()
                }
            }
            document.addEventListener("keydown", onKey)
            window.addEventListener("mousemove", onMouseMove, { passive: true })
            return function () {
                document.removeEventListener("keydown", onKey)
                window.removeEventListener("mousemove", onMouseMove)
            }
        }, [])

        const channel = state.playing ? state.playing.channel : null
        if (!channel) return null
        const saved = store.isFavorite(state.playing.listId, channel.url || channel)
        const program = state.nowProgram
        const next = state.nextProgram
        const progress = store.programProgress(program)
        const vod = store.isVod(channel)
        const playback = state.playbackInfo || player.playbackInfo()
        const curDur =
            playback && isFinite(playback.duration) && playback.duration > 0
                ? playback.duration
                : (channel && store.parseDuration ? store.parseDuration(channel.durationSecs || channel.duration_secs || channel.duration) : 0)
        const audioTracks = playback.tracks
            ? playback.tracks.filter((track) => track.type === "AUDIO")
            : []
        const subtitleTracks = playback.tracks
            ? playback.tracks.filter((track) => track.type === "SUBTITLE" || track.type === "TEXT")
            : []
        function trackLabel(track, index) {
            if (!track) return `Piste ${index + 1}`
            const details = track.extra_info || {}
            return details.label || details.language || details.codec || details.track || `Piste ${index + 1}`
        }

        return html`<section
            class=${`screen player${player.hardware() ? " hw" : ""}`}
            id="screen-player"
            onClick=${function (e) {
                if (e.target && !e.target.closest("button, input, .vod-controls, .ov-actions, .player-top-bar, .fs-stats-hud")) {
                    toggleOverlay()
                }
            }}
        >
            <div
                class=${`player-top-bar${
                    (overlay || state.menuFocus) && !state.playError && !state.zapOpen
                        ? " visible"
                        : ""
                }`}
                id="playerTopBar"
            >
                <button
                    class="player-btn-back"
                    id="playerBackBtn"
                    title="Retour"
                    tabindex="-1"
                    onClick=${handleExit}
                >
                    <span class="icon-arrow">←</span>
                    <span class="player-btn-label">Retour</span>
                </button>
                <div class="player-top-meta">
                    <span class="player-channel-badge">${vod ? (channel.mediaType === "movie" ? "Film" : "Épisode") : "En direct"}</span>
                    <span class="player-channel-title">${channel.name}</span>
                </div>
                <button
                    class="player-btn-fs"
                    id="playerFullscreenBtn"
                    title=${isFullscreen ? "Quitter le plein écran" : "Plein écran"}
                    tabindex="-1"
                    onClick=${handleToggleFs}
                >
                    <span class="icon-fs">${isFullscreen ? "⤦" : "⛶"}</span>
                    <span class="player-btn-label">${isFullscreen ? "Réduire" : "Plein écran"}</span>
                </button>
            </div>
            ${state.statsVisible
                ? html`<div class="fs-stats-hud" id="statsContainer">
                      <div class="fs-stats-title">📊 STATS POUR NERDS</div>
                      <div class="fs-stats-line">
                          Flux : <strong>${vod ? "VOD / Série" : "Direct TV"}</strong>
                      </div>
                      <div class="fs-stats-line">
                          Moteur : <strong>${player.hardware() ? "Samsung AVPlay" : "HTML5 / HLS"}</strong>
                      </div>
                      <div class="fs-stats-line">
                          Format : <strong>${state.aspectRatio === "fill" ? "16:9 Étiré" : state.aspectRatio === "cover" ? "Zoom" : "Original"}</strong>
                      </div>
                      <div class="fs-stats-line">
                          DNS / Réseau : <strong>${state.dnsPref} ${state.vpnEnabled ? "• WARP ON" : ""}</strong>
                      </div>
                  </div>`
                : null}
            ${
                state.playStatus === "opening"
                    ? html`<div class="player-status" id="playerStatus">
                          <div class="spinner"></div>
                          <p class="player-status-text">Opening “${channel.name}”…</p>
                      </div>`
                    : null
            }
            ${
                state.playError
                    ? html`<div class="player-error" id="playError">
                          <div class="play-card">
                              <p class="play-why" id="playErrorWhy">${state.playError.message}</p>
                              <h1 class="play-name" id="playErrorName">${channel.name}</h1>
                              <p class="play-hint">You can try again or pick another channel.</p>
                              <div class="play-actions" id="playActions">
                                  <button
                                      class="btn primary"
                                      id="playRetry"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.retryPlay()
                                      }}
                                  >
                                      Retry
                                  </button>
                                  <button
                                      class="btn"
                                      id="playClose"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.exitPlayer()
                                      }}
                                  >
                                      Back
                                  </button>
                              </div>
                          </div>
                      </div>`
                    : null
            }
            ${state.zapOpen ? html`<${App.uiScreens.zap} />` : null}
            <div
                class=${`overlay${
                    (overlay || state.menuFocus) && !state.playError && !state.zapOpen
                        ? " visible"
                        : ""
                }`}
                id="playerOverlay"
            >
                <div class="ov-info">
                    <p class=${`ov-live${vod ? " vod-title" : ""}`} id="ovLive">
                        <span class="dot"></span
                        >${vod ? (channel.mediaType === "movie" ? "Movie" : "Episode") : "Live"}<span
                            class="ov-engine"
                            id="ovEngine"
                            >${player.hardware() ? "AVPlay" : "HTML5"}</span
                        >
                    </p>
                    <h1 id="ovName">${channel.name}</h1>
                    <p class="ov-group" id="ovGroup">${channel.group || ""}</p>
                    ${
                        program
                            ? html`<div class="ov-guide" id="ovProgram">
                                  <p class="ov-program">
                                      ${program.title}${
                                          program.start
                                              ? html`<span class="ov-time"
                                                    >${clock(program.start)} –
                                                    ${clock(program.end)}</span
                                                >`
                                              : null
                                      }
                                  </p>
                                  ${
                                      progress !== null
                                          ? html`<div class="ov-progress">
                                                <span
                                                    class="ov-progress-fill"
                                                    id="ovProgress"
                                                    style=${`width:${progress}%`}
                                                ></span>
                                            </div>`
                                          : null
                                  }
                              </div>`
                            : null
                    }
                    ${
                        next
                            ? html`<p class="ov-next" id="ovNext">
                                  <span class="ov-next-tag">Next</span>${next.title}${
                                      next.start
                                          ? html`<span class="ov-time"
                                                >${clock(next.start)} – ${clock(next.end)}</span
                                            >`
                                          : null
                                  }
                              </p>`
                            : null
                    }
                    <!-- The legend goes last: the name, the guide and what comes next
                         are one thing and do not split down the middle. -->
                    ${vod
                        ? html`<p class="ov-keys" id="ovKeys">
                              <span class="ov-key">OK / PLAY</span><span>lecture / pause</span>
                              <span class="ov-key">◀ / ▶</span><span>±10 s</span>
                              <span class="ov-key">BACK</span><span>quitter</span>
                          </p>`
                        : html`<p class="ov-keys" id="ovKeys">
                              <span class="ov-key">CH ▲/▼</span><span>chaîne</span>
                              <span class="ov-key">OK / GAUCHE</span><span>liste chaînes</span>
                              <span class="ov-key">BAS</span><span>favoris</span>
                              <span class="ov-key">BACK</span><span>quitter</span>
                              <span class="ov-key">ROUGE</span><span>favori</span>
                          </p>`}
                </div>
                <div class="ov-actions" id="ovActions">
                    ${
                        vod
                            ? html`<div class="vod-controls" id="vodControls">
                                  <div class="vod-controls-heading">
                                      <span class="vod-eyebrow">EN COURS DE LECTURE</span>
                                      <span class="vod-heading-title">${channel.name}</span>
                                  </div>
                                  <div class="vod-timeline">
                                      <span class="vod-time vod-time-current" id="vodTimeCurrent"
                                          >${formatPosition(playback.position)}</span
                                      >
                                      <input
                                          id="vodSeek"
                                          class="vod-seek"
                                          type="range"
                                          min="0"
                                          max=${Math.max(1, Math.floor(curDur || 100))}
                                          value=${Math.min(
                                              Math.floor(store.state.virtualSeekPosition !== null && store.state.virtualSeekPosition !== undefined ? store.state.virtualSeekPosition : (playback.position || 0)),
                                              Math.max(1, Math.floor(curDur || 100)),
                                          )}
                                          style=${`--seek-progress:${curDur > 0 ? Math.min(100, (((store.state.virtualSeekPosition !== null && store.state.virtualSeekPosition !== undefined ? store.state.virtualSeekPosition : (playback.position || 0)) / curDur) * 100)) : 0}%`}
                                          aria-label="Playback position"
                                          onInput=${function (event) {
                                              store.seekTo(Number(event.currentTarget.value))
                                              show()
                                          }}
                                          onChange=${function (event) {
                                              store.seekTo(Number(event.currentTarget.value))
                                              show()
                                          }}
                                      />
                                      <span class="vod-time vod-time-total" id="vodTimeTotal"
                                          >${curDur > 0 ? formatPosition(curDur) : "--:--"}</span
                                      >
                                  </div>
                                  <div class="vod-actions">
                                      <button
                                          class="btn vod-action"
                                          tabindex="-1"
                                          onClick=${function () {
                                              store.smartSeek(-10)
                                              show()
                                          }}
                                      >
                                          <span class="vod-action-icon">↶</span><span>−10 s</span>
                                      </button>
                                      <button
                                           class="btn primary vod-action vod-play"
                                           tabindex="-1"
                                           onClick=${function () {
                                               store.togglePlay()
                                               show()
                                           }}
                                       >
                                           <span class="vod-action-icon"
                                               >${state.playStatus === "paused" || player.state() === "PAUSED" ? "▶" : "Ⅱ"}</span
                                           ><span
                                               >${state.playStatus === "paused" || player.state() === "PAUSED" ? "Lire" : "Pause"}</span
                                           >
                                       </button>
                                      <button
                                          class="btn vod-action"
                                          tabindex="-1"
                                          onClick=${function () {
                                              store.smartSeek(10)
                                              show()
                                          }}
                                      >
                                          <span class="vod-action-icon">↷</span><span>+10 s</span>
                                      </button>
                                      ${
                                          audioTracks.length > 1
                                              ? html`<button
                                                    class="btn vod-action vod-track"
                                                    tabindex="-1"
                                                    onClick=${function () {
                                                        const next =
                                                            (audioChoice + 1) % audioTracks.length
                                                        const trIndex = audioTracks[next].index !== undefined ? audioTracks[next].index : next
                                                        store.selectPlaybackTrack("AUDIO", trIndex)
                                                        setAudioChoice(next)
                                                        store.notify(`Audio : ${trackLabel(audioTracks[next], next)}`)
                                                        show()
                                                    }}
                                                >
                                                    <span class="vod-action-icon">♫</span
                                                    ><span class="vod-track-copy"
                                                        ><small>LANGUE</small
                                                        ><strong
                                                            >${trackLabel(audioTracks[audioChoice % audioTracks.length], audioChoice)}</strong
                                                        ></span
                                                    >
                                                </button>`
                                              : audioTracks.length === 1
                                                ? html`<span class="track-indicator">
                                                      <span class="vod-action-icon">♫</span
                                                      ><span class="vod-track-copy"
                                                          ><small>AUDIO</small
                                                          ><strong
                                                              >${trackLabel(audioTracks[0], 0)}</strong
                                                          ></span
                                                      >
                                                  </span>`
                                                : html`<span class="track-indicator unavailable">
                                                      <span class="vod-action-icon">♫</span><span class="vod-track-copy"><small>AUDIO</small><strong>Défaut</strong></span>
                                                  </span>`
                                      }
                                      ${
                                          subtitleTracks.length
                                              ? html`<button
                                                    class="btn vod-action vod-track"
                                                    tabindex="-1"
                                                    onClick=${function () {
                                                        const next =
                                                            subtitleChoice + 1 >=
                                                            subtitleTracks.length
                                                                ? -1
                                                                : subtitleChoice + 1
                                                        const trackIndex =
                                                            next < 0
                                                                ? -1
                                                                : (subtitleTracks[next].index !== undefined ? subtitleTracks[next].index : next)
                                                        store.selectPlaybackTrack(
                                                            "SUBTITLE",
                                                            trackIndex,
                                                        )
                                                        setSubtitleChoice(next)
                                                        store.notify(next < 0 ? "Sous-titres désactivés" : `Sous-titres : ${trackLabel(subtitleTracks[next], next)}`)
                                                        show()
                                                    }}
                                                >
                                                    <span class="vod-action-icon">CC</span
                                                    ><span class="vod-track-copy"
                                                        ><small>SOUS-TITRES</small
                                                        ><strong
                                                            >${subtitleChoice < 0 ? "Désactivés" : trackLabel(subtitleTracks[subtitleChoice], subtitleChoice)}</strong
                                                        ></span
                                                    >
                                                </button>`
                                              : html`<span class="track-indicator unavailable">
                                                    <span class="vod-action-icon">CC</span><span class="vod-track-copy"><small>SOUS-TITRES</small><strong>Aucun</strong></span>
                                                </span>`
                                      }
                                      <button
                                          class="btn vod-action vod-aspect"
                                          id="vodAspect"
                                          tabindex="-1"
                                          onClick=${function () {
                                              store.toggleAspectRatio()
                                              show()
                                          }}
                                      >
                                          <span class="vod-action-icon">⛶</span>
                                          <span class="vod-track-copy">
                                              <small>FORMAT</small>
                                              <strong>${state.aspectRatio === "fill" ? "Plein écran" : state.aspectRatio === "cover" ? "Zoom" : "Original"}</strong>
                                          </span>
                                      </button>
                                      <button
                                          class="btn vod-action"
                                          id="vodStatsBtn"
                                          tabindex="-1"
                                          onClick=${function () {
                                              store.toggleStats()
                                              show()
                                          }}
                                      >
                                          <span class="vod-action-icon">📊</span>
                                          <span class="vod-track-copy">
                                              <small>INFOS</small>
                                              <strong>Stats</strong>
                                          </span>
                                      </button>
                                      <button
                                          class="btn vod-action vod-exit"
                                          id="vodExitBtn"
                                          tabindex="-1"
                                          onClick=${handleExit}
                                      >
                                          <span class="vod-action-icon">✕</span>
                                          <span class="vod-track-copy">
                                              <small>QUITTER</small>
                                              <strong>Retour</strong>
                                          </span>
                                      </button>
                                  </div>
                              </div>`
                            : html`<div class="ov-live-actions">
                                  <button
                                      class="btn vod-action"
                                      id="ovPrevChan"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.zap(-1)
                                          show()
                                      }}
                                  >
                                      ⏮ Préc.
                                  </button>
                                  <button
                                      class="btn vod-action"
                                      id="ovNextChan"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.zap(1)
                                          show()
                                      }}
                                  >
                                      Suiv. ⏭
                                  </button>
                                  <button
                                      class="btn vod-action"
                                      id="ovZapList"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.openZap()
                                      }}
                                  >
                                      📋 Chaînes
                                  </button>
                                  <button
                                      class=${`btn${saved ? " saved" : ""}`}
                                      id="ovFav"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.toggleFavorite(channel, state.playing.listId)
                                          show()
                                      }}
                                  >
                                      ${saved ? "❤️ Favori" : "🤍 Favori"}
                                  </button>
                                  <button
                                      class="btn vod-action vod-aspect"
                                      id="ovAspect"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.toggleAspectRatio()
                                          show()
                                      }}
                                  >
                                      <span class="vod-action-icon">⛶</span>
                                      <span>${state.aspectRatio === "fill" ? "Format : 16:9" : state.aspectRatio === "cover" ? "Format : Zoom" : "Format : Original"}</span>
                                  </button>
                                  <button
                                      class="btn vod-action"
                                      id="ovStatsBtn"
                                      tabindex="-1"
                                      onClick=${function () {
                                          store.toggleStats()
                                          show()
                                      }}
                                  >
                                      📊 Stats
                                  </button>
                                  <button
                                      class="btn vod-action ov-exit"
                                      id="ovExitBtn"
                                      tabindex="-1"
                                      onClick=${handleExit}
                                  >
                                      <span class="vod-action-icon">✕</span>
                                      <span>Quitter</span>
                                  </button>
                              </div>`
                    }
                </div>
            </div>
        </section>`
    }
})()
