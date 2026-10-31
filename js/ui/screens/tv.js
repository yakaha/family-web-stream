var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const clock = kit.clock
    const useEffect = kit.useEffect
    const Bar = kit.Bar
    const Search = kit.Search
    const ChannelList = kit.ChannelList
    const useRef = kit.useRef

    const player = App.player

    // The stylesheet ships both spellings of mask subtraction; accept either.
    function supportsHole() {
        if (!window.CSS || !window.CSS.supports) return false
        return (
            window.CSS.supports("-webkit-mask-composite", "xor") ||
            window.CSS.supports("mask-composite", "exclude")
        )
    }

    // CSS pixels: AVPlay converts to its grid at the other end.
    function previewBox() {
        const element = document.getElementById("previewStage")
        return element && element.getBoundingClientRect ? element.getBoundingClientRect() : null
    }

    function videoRect() {
        const box = previewBox()
        if (!box || box.width < 2) return null
        const scale = 1920 / (window.innerWidth || 1920)
        return {
            x: box.left * scale,
            y: box.top * scale,
            w: box.width * scale,
            h: box.height * scale,
        }
    }

    // The rect goes on the document root: the card's own mask reads the same variables.
    function setHole() {
        const box = previewBox()
        const layer = document.getElementById("backdrop")
        const stage = document.getElementById("previewStage")
        if (!box || !layer) return
        const rootStyle = document.documentElement.style
        // One pixel per side: the focus edge lives on the card border, and flush to the
        // edge the mask ate it right where the video is (the border was cut there).
        const inset = 1
        rootStyle.setProperty("--hole-x", `${Math.round(box.left + inset)}px`)
        rootStyle.setProperty("--hole-y", `${Math.round(box.top + inset)}px`)
        rootStyle.setProperty("--hole-w", `${Math.round(box.width - inset * 2)}px`)
        rootStyle.setProperty("--hole-h", `${Math.round(box.height - inset * 2)}px`)
        if (stage && stage.offsetParent) {
            rootStyle.setProperty("--stage-x", `${Math.round(stage.offsetLeft + inset)}px`)
            rootStyle.setProperty("--stage-y", `${Math.round(stage.offsetTop + inset)}px`)
        }
    }

    const iconTvBig = kit.svg(
        html`<rect
                x="2.5"
                y="5"
                width="19"
                height="13"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
            /><path
                d="M8.5 21h7"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
            />`,
        64,
    )

    function Preview() {
        const state = store.state
        const channel = state.preview
        if (!channel) {
            return html`<div class="preview-card" id="previewCard">
                <div class="preview-stage" id="previewStage">
                    <div class="preview-empty" id="previewEmpty">
                        <span class="preview-icon">${iconTvBig}</span>
                        <p class="preview-hint">
                            ${state.mediaType === "movie" ? "Sélectionnez un film pour voir son synopsis" : state.mediaType === "series" ? "Sélectionnez une série pour voir ses détails" : "Select a channel to see it here"}
                        </p>
                    </div>
                </div>
            </div>`
        }

        // VOD Mode: Synopsis, tags, details and Start button (No stream preview)
        if (state.mediaType === "movie" || state.mediaType === "series") {
            const isMovie = state.mediaType === "movie"
            const synopsis =
                channel.description ||
                channel.plot ||
                channel.desc ||
                "Aucun résumé disponible pour ce titre."
            const durationText = channel.duration ? `${channel.duration} min` : ""
            const ratingText = channel.rating ? `★ ${channel.rating}` : ""
            const yearText = channel.year || ""
            const metaTags = [yearText, durationText, ratingText, channel.genre || channel.group].filter(Boolean)

            return html`<div class="preview-card vod-preview-card" id="previewCard">
                <div class="vod-poster-stage" id="previewStage">
                    <span class="preview-logo vod-poster" style=${kit.logoStyle(channel.logo)}>
                        ${channel.logo ? null : html`<span class="preview-letter">${kit.initial(channel.name)}</span>`}
                    </span>
                </div>
                <div class="vod-details">
                    <h2 class="preview-name vod-title">${channel.name}</h2>
                    ${metaTags.length ? html`<div class="vod-tags">${metaTags.map((t) => html`<span class="vod-tag">${t}</span>`)}</div>` : null}
                    <div class="vod-synopsis-box">
                        <p class="vod-synopsis">${synopsis}</p>
                    </div>
                    ${channel.director ? html`<p class="vod-meta-item"><strong>Réalisateur :</strong> ${channel.director}</p>` : null}
                    ${channel.actors ? html`<p class="vod-meta-item"><strong>Distribution :</strong> ${channel.actors}</p>` : null}
                    <div class="vod-play-action">
                        <button
                            class="btn primary vod-start-btn"
                            id="playVodBtn"
                            tabindex="-1"
                            onClick=${function () {
                                if (isMovie) {
                                    store.play(channel, channel.listId, store.visibleTvCategory().items)
                                } else {
                                    store.openSeries(channel)
                                }
                            }}
                        >
                            <span class="vod-action-icon">${isMovie ? "▶" : "☰"}</span>
                            <span>${isMovie ? "Regarder le film" : "Voir les saisons & épisodes"}</span>
                        </button>
                    </div>
                </div>
            </div>`
        }

        const program = store.programOf(channel)
        const next = store.nextOf(channel)
        const progress = store.programProgress(program)
        return html`<div class="preview-card" id="previewCard">
            <div class="preview-stage" id="previewStage">
                <span class="preview-logo" style=${kit.logoStyle(channel.logo)}>
                    ${channel.logo ? null : html`<span class="preview-letter">${kit.initial(channel.name)}</span>`}
                </span>
                ${!channel.url && channel.cmd ? html`<div class="preview-busy"><span class="spinner"></span><span>Préparation du flux…</span></div>` : null}
            </div>
            <div class="preview-info">
                <h2 class="preview-name">${channel.name}</h2>
                <p class="preview-group">${channel.group || ""}</p>
                ${
                    program
                        ? html`<div class="preview-guide">
                              <p class="preview-program">
                                  ${program.title}
                                  <span class="ov-time"
                                      >${clock(program.start)} – ${clock(program.end)}</span
                                  >
                              </p>
                              ${
                                  progress !== null
                                      ? html`<div class="ov-progress">
                                            <span
                                                class="ov-progress-fill"
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
                        ? html`<p class="preview-next">
                              <span class="ov-next-tag">Next</span>${next.title}
                              ${next.start ? html`<span class="ov-time">${clock(next.start)} – ${clock(next.end)}</span>` : null}
                          </p>`
                        : null
                }
                <p class="preview-open">Press OK to watch full screen</p>
            </div>
        </div>`
    }

    function TvScreen() {
        const state = store.state

        useEffect(() => {
            // For VOD (Movies & Series): Do NOT auto-play in preview box!
            if (state.mediaType === "movie" || state.mediaType === "series") {
                player.stop()
                return
            }

            setHole()
            if (!state.preview || !state.preview.url) {
                return
            }
            if (player.isPlayingUrl(state.preview.url)) {
                setHole()
                player.resize(videoRect())
                return
            }
            const previewTimer = setTimeout(() => {
                setHole()
                if (supportsHole() && player.hardware()) document.body.classList.add("previewing")
                player.play(state.preview.url, videoRect())
            }, 250)
            function onResize() {
                setHole()
                player.resize(videoRect())
            }
            window.addEventListener("resize", onResize)
            return function () {
                clearTimeout(previewTimer)
                window.removeEventListener("resize", onResize)
                document.body.classList.remove("previewing")
                const goingToFullscreen =
                    store.state.screen === "player" &&
                    store.state.playing &&
                    state.preview &&
                    store.state.playing.channel.url === state.preview.url
                if (!goingToFullscreen && store.state.screen !== "player") {
                    player.stop()
                }
            }
        }, [state.preview, state.mediaType])

        const view = store.tvCategories()
        const channels = store.visibleTvCategory()
        const pending = store.loadingRows(state.mediaType)
        const rows = store.tvCategories().rows

        return html`<section class="screen" id="screen-tv">
            <${Bar}
                title=${state.mediaType === "movie" ? "Movies" : state.mediaType === "series" ? "Series" : "Live TV"}
                meta=${view.label}
                metaId="tvMeta"
                titleId="tvTitle"
                actions=${html`<div class="bar-actions" id="tvActions">
                    <button
                        class="btn"
                        id="catsBtn"
                        tabindex="-1"
                        onClick=${function () {
                            store.openCategories()
                        }}
                    >
                        Categories
                    </button>
                </div>`}
                search=${html`<${Search}
                    id="tvSearch"
                    countId="tvSearchCount"
                    scope="tv"
                    resetKey="tv"
                    placeholder="Search categories"
                    count=${view.count}
                    onInput=${function (value) {
                        store.setSearch("tv", value)
                    }}
                />`}
            />
            ${state.lists.length ? null : html`<p class="empty">Every source's channels meet here. Add one to start.</p>`}
            <div class="browse" id="browse">
                <div class="browse-cats" id="tvCats">
                    ${pending.map((row) => {
                        return html`<div class="row pending" key=${`load-${row.key}`}>
                            <span class="pending-dot"></span>
                            <span class="row-main">
                                <span class="row-name">${row.name}</span>
                                <span class="row-sub"
                                    >${row.label}${
                                        row.count !== undefined
                                            ? ` · ${store.formatCount(row.count)} ${
                                                  row.mediaType === "movie"
                                                      ? "films"
                                                      : row.mediaType === "series"
                                                        ? "series"
                                                        : "channels"
                                              }`
                                            : "…"
                                    }</span
                                >
                            </span>
                        </div>`
                    })}
                    ${
                        rows.length || pending.length
                            ? null
                            : html`<p class="empty">
                                  ${view.total ? "No category matches your search." : "No categories yet."}
                              </p>`
                    }
                    ${rows.map((row) => {
                        return html`<button
                            class=${`row tvcat${row.name === state.catName ? " selected" : ""}`}
                            tabindex="-1"
                            data-group=${row.name}
                            onClick=${function () {
                                store.openTvCategory(row.name)
                            }}
                        >
                            <span class="row-main">
                                <span class="row-name">${row.name}</span>
                                ${row.sources > 1 ? html`<span class="row-sub">${row.sources} sources</span>` : null}
                            </span>
                            <span class="row-count">${store.formatCount(row.count)}</span>
                        </button>`
                    })}
                </div>
                <div class="browse-channels">
                    <${ChannelList} id="tvChannels" view=${channels} detail=${true} />
                </div>
                <div
                    class="browse-preview"
                    id="tvPreview"
                    tabindex="-1"
                    onClick=${function () {
                        if (state.preview)
                            store.play(
                                state.preview,
                                state.preview.listId,
                                store.visibleTvCategory().items,
                            )
                    }}
                >
                    <${Preview} />
                </div>
            </div>
        </section>`
    }

    App.uiScreens.tv = TvScreen
})()
