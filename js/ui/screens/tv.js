var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const clock = kit.clock
    const useEffect = kit.useEffect
    const BrandLogo = kit.BrandLogo

    const player = App.player

    function supportsHole() {
        if (!window.CSS || !window.CSS.supports) return false
        return (
            window.CSS.supports("-webkit-mask-composite", "xor") ||
            window.CSS.supports("mask-composite", "exclude")
        )
    }

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

    function setHole() {
        const box = previewBox()
        const layer = document.getElementById("backdrop")
        const stage = document.getElementById("previewStage")
        if (!box || !layer) return
        const rootStyle = document.documentElement.style
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

    function MovieDetailOverlay() {
        const movie = store.state.selectedMovie
        if (!movie) return null
        const listId = movie.listId || (store.state.lists[0] && store.state.lists[0].id)
        const isFav = store.isFavorite(listId, movie)
        const synopsis =
            movie.description ||
            movie.plot ||
            movie.desc ||
            "Aucun synopsis disponible pour ce film."
        const rating = movie.rating || movie.rating_5based || ""
        const year = movie.year || movie.releaseDate || "—"
        const duration = movie.duration ? `${movie.duration} min` : "HD / 4K"
        const genre = movie.genre || movie.group || "Cinéma & VOD"
        const director = movie.director || "Non spécifié"
        const actors = movie.actors || movie.cast || "Non spécifié"

        return html`<div class="fs-media-info-overlay" id="movieDetailModal">
            ${movie.logo
                ? html`<div
                      class="fs-media-info-backdrop"
                      style=${{ backgroundImage: `url(${JSON.stringify(movie.logo)})` }}
                  ></div>`
                : null}
            <div class="fs-media-info-scrim"></div>

            <div class="fs-media-info-content">
                <header class="fs-media-info-topbar">
                    <button
                        type="button"
                        class="fs-btn-back-pill"
                        id="movieDetailBack"
                        tabindex="-1"
                        onClick=${() => store.closeMovieDetail()}
                    >
                        ← Back
                    </button>
                    <${BrandLogo} compact=${true} />
                    <span class="fs-media-info-tag">FILM VOD</span>
                </header>

                <div class="fs-media-info-body">
                    <div class="fs-media-poster-card">
                        <div class="fs-media-poster-img" style=${kit.logoStyle(movie.logo)}>
                            ${movie.logo
                                ? null
                                : html`<span class="fs-vod-placeholder">
                                      ${kit.initial(movie.name)}
                                  </span>`}
                        </div>
                    </div>

                    <div class="fs-media-details-col">
                        <h1 class="fs-media-title">${movie.name}</h1>
                        <div class="fs-media-rating-row">
                            <span class="fs-media-stars">
                                ★ ★ ★ ★ ☆ ${rating ? `(${rating})` : ""}
                            </span>
                            <span class="fs-media-badge-hd">FULL HD</span>
                        </div>

                        <div class="fs-media-meta-grid">
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Directed By:</span>
                                <span class="fs-meta-val">${director}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Release Date:</span>
                                <span class="fs-meta-val">${year}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Duration:</span>
                                <span class="fs-meta-val">${duration}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Genre:</span>
                                <span class="fs-meta-val">${genre}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Cast:</span>
                                <span class="fs-meta-val">${actors}</span>
                            </div>
                        </div>

                        <div class="fs-media-divider"></div>

                        <p class="fs-media-synopsis">${synopsis}</p>

                        <div class="fs-media-actions" id="movieDetailActions">
                            <button
                                type="button"
                                class="fs-btn-play-gold"
                                id="btnMoviePlay"
                                tabindex="-1"
                                onClick=${() => {
                                    const item = movie
                                    store.closeMovieDetail()
                                    store.play(item, listId, store.visibleTvCategory().items)
                                }}
                            >
                                ▶ Lecture
                            </button>
                            <button
                                type="button"
                                class="fs-btn-fav-outline"
                                id="btnMovieFav"
                                tabindex="-1"
                                onClick=${() => store.toggleFavorite(movie, listId)}
                            >
                                ${isFav ? "❤️ Favori" : "🤍 Favori"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`
    }

    function LiveZapView() {
        const state = store.state
        const view = store.tvCategories()
        const channels = store.visibleTvCategory()
        const rows = view.rows
        const preview = state.preview
        const listId =
            (preview && preview.listId) || (state.lists[0] && state.lists[0].id) || "source"
        const isFav = preview ? store.isFavorite(listId, preview) : false
        const program = preview ? store.programOf(preview) : null
        const next = preview ? store.nextOf(preview) : null

        function onChannelClick(channel) {
            const isMobile =
                typeof window !== "undefined" &&
                (window.innerWidth <= 768 ||
                    (window.matchMedia && window.matchMedia("(max-width: 768px)").matches))
            if (isMobile) {
                store.play(channel, channel.listId || listId, channels.items)
            } else {
                store.selectPreview(channel)
            }
        }

        return html`<section class="fs-zap-screen" id="screen-tv">
            <!-- Top Bar (activity_zap.xml) -->
            <header class="fs-zap-topbar">
                <button
                    type="button"
                    class="fs-round-back"
                    id="zapBackBtn"
                    tabindex="-1"
                    title="Retour à l'accueil"
                    onClick=${() => store.goHome()}
                >
                    ←
                </button>
                <h1 class="fs-zap-title">Live TV</h1>
                <div class="fs-zap-search-wrap">
                    <span class="fs-zap-search-icon">🔍</span>
                    <input
                        type="text"
                        id="tvChannelSearch"
                        class="fs-zap-search-input"
                        placeholder="Rechercher une chaîne dans toutes les catégories…"
                        value=${store.searchOf("tvchannels")}
                        autocomplete="off"
                        tabindex="-1"
                        onInput=${(e) => store.setSearch("tvchannels", e.target.value)}
                    />
                </div>
            </header>

            <!-- 3-Panel Body: Categories (28%) | Channels (34%) | Preview & EPG (38%) -->
            <div class="fs-zap-body" id="browse">
                <!-- Panel 1: Categories -->
                <div class="fs-zap-col-cats">
                    <div class="fs-zap-filter-box">
                        <span class="fs-zap-filter-icon">📁</span>
                        <input
                            type="text"
                            id="tvSearch"
                            class="fs-zap-filter-input"
                            placeholder="Filtrer les catégories…"
                            value=${store.searchOf("tv")}
                            autocomplete="off"
                            tabindex="-1"
                            onInput=${(e) => store.setSearch("tv", e.target.value)}
                        />
                    </div>

                    <div class="fs-zap-list" id="tvCats">
                        ${rows.map((row) => {
                            const selected = row.name === state.catName
                            return html`<button
                                type="button"
                                class=${`row tvcat fs-zap-cat-item${selected ? " selected" : ""}`}
                                key=${row.id || row.name}
                                data-group=${row.name}
                                tabindex="-1"
                                onClick=${() => store.openTvCategory(row.name)}
                            >
                                <span class="fs-zap-cat-name">${row.name}</span>
                                <span class="fs-zap-cat-right">
                                    ${row.count
                                        ? html`<small class="fs-zap-cat-count"
                                              >${store.formatCount(row.count)}</small
                                          >`
                                        : null}
                                    <span class="fs-zap-cat-arrow">›</span>
                                </span>
                            </button>`
                        })}
                    </div>
                </div>

                <!-- Panel 2: Channels -->
                <div class="fs-zap-col-chans">
                    <div class="fs-zap-list" id="tvChannels">
                        ${channels.loading
                            ? html`<div class="fs-empty-state">
                                  <span class="spinner"></span>
                                  <p>Chargement des chaînes…</p>
                              </div>`
                            : channels.items.length === 0
                              ? html`<div class="fs-empty-state">
                                    <p>${channels.empty || "Aucune chaîne dans cette catégorie."}</p>
                                </div>`
                              : null}
                        ${channels.items.map((channel, index) => {
                            const isCurrent =
                                preview &&
                                (preview.id === channel.id && preview.name === channel.name)
                            const fav = store.isFavorite(
                                channel.listId || listId,
                                channel.url || channel,
                            )
                            return html`<button
                                type="button"
                                class=${`row channel fs-zap-chan-item${isCurrent ? " playing" : ""}`}
                                key=${channel.id || channel.url || channel.cmd || index}
                                data-url=${channel.url}
                                data-list=${channel.listId || listId}
                                tabindex="-1"
                                onClick=${() => onChannelClick(channel)}
                            >
                                <span class="fs-chan-num">${index + 1}</span>
                                <span class="fs-chan-sep"></span>
                                <span
                                    class="fs-chan-logo"
                                    style=${kit.logoStyle(channel.logo || "img/tv_default.png")}
                                ></span>
                                <span class="fs-chan-name">${channel.name}</span>
                                ${fav ? html`<span class="fs-chan-fav">★</span>` : null}
                                ${isCurrent ? html`<span class="fs-chan-play">▶</span>` : null}
                            </button>`
                        })}
                        ${channels.hasMore
                            ? html`<button
                                  type="button"
                                  class="row channel fs-zap-chan-item load-more"
                                  tabindex="-1"
                                  onClick=${store.loadMore}
                              >
                                  <span class="fs-chan-name">
                                      Afficher plus (${store.formatCount(channels.items.length)} /
                                      ${store.formatCount(channels.total)})
                                  </span>
                              </button>`
                            : null}
                    </div>
                    <div class="fs-zap-dl-status">
                        ✓ Liste téléchargée · ${store.formatCount(channels.total)} chaînes
                    </div>
                </div>

                <!-- Panel 3: Live Video Preview + Channel Info + Action Buttons -->
                <div class="fs-zap-col-preview">
                    <div
                        class="fs-zap-preview-box"
                        id="tvPreview"
                        tabindex="-1"
                        onClick=${() => {
                            if (preview) {
                                store.play(preview, preview.listId || listId, channels.items)
                            }
                        }}
                    >
                        <div class="preview-stage" id="previewStage">
                            ${preview
                                ? html`<div class="fs-preview-overlay-logo">
                                      <span
                                          class="fs-preview-fallback-logo"
                                          style=${kit.logoStyle(preview.logo || "img/tv_default.png")}
                                      ></span>
                                      ${!preview.url && preview.cmd
                                          ? html`<div class="fs-preview-loading">
                                                <span class="spinner"></span>
                                                <span>Ouverture du flux…</span>
                                            </div>`
                                          : null}
                                  </div>`
                                : html`<div class="fs-preview-empty">
                                      <span>📺</span>
                                      <p>Sélectionnez une chaîne pour l'aperçu en direct</p>
                                  </div>`}
                        </div>
                    </div>

                    <div class="fs-zap-info-block">
                        <h2 class="fs-zap-preview-title">
                            ${preview ? preview.name : "Aucune chaîne sélectionnée"}
                        </h2>
                        <p class="fs-zap-preview-epg">
                            ${program && program.title
                                ? `${program.title} (${clock(program.start)} - ${clock(program.end)})`
                                : next && next.title
                                  ? `À suivre : ${next.title}`
                                  : preview && preview.group
                                    ? `${preview.group} • Flux Haute Définition`
                                    : "Direct TV • Flux Haute Définition"}
                        </p>
                        <p class="fs-zap-preview-status">● En direct</p>
                    </div>

                    <div class="fs-zap-actions-row" id="zapPreviewActions">
                        <button
                            type="button"
                            class="fs-zap-action-btn"
                            id="btnZapFav"
                            tabindex="-1"
                            disabled=${!preview}
                            onClick=${() => {
                                if (preview) store.toggleFavorite(preview, listId)
                            }}
                        >
                            ${isFav ? "❤️ Favori" : "🤍 Favori"}
                        </button>
                        <button
                            type="button"
                            class="fs-zap-action-btn"
                            id="btnZapLang"
                            tabindex="-1"
                            disabled=${!preview}
                            onClick=${() => {
                                store.notify("🌐 Piste audio par défaut active")
                            }}
                        >
                            🌐 Langue
                        </button>
                        <button
                            type="button"
                            class="fs-zap-action-btn"
                            id="btnZapGuide"
                            tabindex="-1"
                            disabled=${!preview}
                            onClick=${() => {
                                if (preview) {
                                    store.loadProgramFor(preview)
                                    store.notify("🕒 Guide EPG mis à jour")
                                }
                            }}
                        >
                            🕒 Guide
                        </button>
                        <button
                            type="button"
                            class="fs-zap-action-btn fs-zap-btn-fullscreen"
                            id="btnZapFullscreen"
                            tabindex="-1"
                            disabled=${!preview}
                            onClick=${() => {
                                if (preview) {
                                    store.play(preview, preview.listId || listId, channels.items)
                                }
                            }}
                        >
                            ⛶ Plein Écran
                        </button>
                    </div>
                </div>
            </div>
        </section>`
    }

    function VodBrowserView() {
        const state = store.state
        const isMovie = state.mediaType === "movie"
        const view = store.tvCategories()
        const channels = store.visibleTvCategory()
        const rows = view.rows
        const sortLabels = {
            default: "⚡ Trier ▼",
            az: "⚡ Tri: A-Z ▼",
            year: "⚡ Tri: Année ▼",
            rating: "⚡ Tri: Note ▼",
        }

        function onCardClick(item) {
            if (item.mediaType === "series" || state.mediaType === "series") {
                store.openSeries(item)
            } else {
                store.openMovieDetail(item)
            }
        }

        return html`<section class="fs-vod-screen" id="screen-tv">
            <!-- Top Bar (activity_vod_browser.xml) -->
            <header class="fs-zap-topbar">
                <button
                    type="button"
                    class="fs-round-back"
                    id="vodBackBtn"
                    tabindex="-1"
                    title="Retour à l'accueil"
                    onClick=${() => store.goHome()}
                >
                    ←
                </button>
                <h1 class="fs-zap-title">${isMovie ? "Films & VOD" : "Séries TV"}</h1>
                <div class="fs-zap-search-wrap">
                    <span class="fs-zap-search-icon">🔍</span>
                    <input
                        type="text"
                        id="tvChannelSearch"
                        class="fs-zap-search-input"
                        placeholder=${isMovie
                            ? "Rechercher un film…"
                            : "Rechercher une série…"}
                        value=${store.searchOf("tvchannels")}
                        autocomplete="off"
                        tabindex="-1"
                        onInput=${(e) => store.setSearch("tvchannels", e.target.value)}
                    />
                </div>
                <button
                    type="button"
                    class="fs-vod-sort-btn"
                    id="btnVodSort"
                    tabindex="-1"
                    onClick=${() => store.cycleVodSort()}
                >
                    ${sortLabels[state.vodSort || "default"]}
                </button>
            </header>

            <!-- 2-Column Body: Genres Sidebar (26%) | Poster Grid (74%) -->
            <div class="fs-vod-body" id="browse">
                <!-- Left Column: Genres Sidebar -->
                <div class="fs-vod-col-genres">
                    <div class="fs-zap-filter-box">
                        <span class="fs-zap-filter-icon">🎬</span>
                        <input
                            type="text"
                            id="tvSearch"
                            class="fs-zap-filter-input"
                            placeholder="Filtrer les genres…"
                            value=${store.searchOf("tv")}
                            autocomplete="off"
                            tabindex="-1"
                            onInput=${(e) => store.setSearch("tv", e.target.value)}
                        />
                    </div>

                    <div class="fs-zap-list" id="tvCats">
                        ${rows.map((row) => {
                            const selected = row.name === state.catName
                            return html`<button
                                type="button"
                                class=${`row tvcat fs-zap-cat-item${selected ? " selected" : ""}`}
                                key=${row.id || row.name}
                                data-group=${row.name}
                                tabindex="-1"
                                onClick=${() => store.openTvCategory(row.name)}
                            >
                                <span class="fs-zap-cat-name">${row.name}</span>
                                <span class="fs-zap-cat-right">
                                    ${row.count
                                        ? html`<small class="fs-zap-cat-count"
                                              >${store.formatCount(row.count)}</small
                                          >`
                                        : null}
                                    <span class="fs-zap-cat-arrow">›</span>
                                </span>
                            </button>`
                        })}
                    </div>
                </div>

                <!-- Right Column: Category Header + Poster Grid -->
                <div class="fs-vod-col-grid">
                    <div class="fs-vod-cat-bar">
                        <span class="fs-vod-cat-title">${state.catName || "Catalogue"}</span>
                        <span class="fs-vod-cat-count">${channels.label}</span>
                    </div>

                    <div class="fs-vod-grid-scroll" id="tvChannels">
                        ${channels.loading
                            ? html`<div class="fs-empty-state">
                                  <span class="spinner"></span>
                                  <p>Chargement du catalogue…</p>
                              </div>`
                            : channels.items.length === 0
                              ? html`<div class="fs-empty-state">
                                    <p>${channels.empty || "Aucun titre dans cette catégorie."}</p>
                                </div>`
                              : html`<div class="fs-vod-grid">
                                    ${channels.items.map((item, idx) => {
                                        const listId =
                                            item.listId ||
                                            (state.lists[0] && state.lists[0].id) ||
                                            "source"
                                        const fav = store.isFavorite(listId, item)
                                        const rating = item.rating || item.rating_5based || ""
                                        const sub = item.year || item.releaseDate || item.group || ""
                                        return html`<button
                                            type="button"
                                            class="row channel fs-vod-card"
                                            key=${item.id || item.streamId || item.url || idx}
                                            tabindex="-1"
                                            onClick=${() => onCardClick(item)}
                                        >
                                            <div
                                                class="fs-vod-poster"
                                                style=${kit.logoStyle(item.logo)}
                                            >
                                                ${item.logo
                                                    ? null
                                                    : html`<span class="fs-vod-placeholder">
                                                          ${kit.initial(item.name)}
                                                      </span>`}
                                                ${rating
                                                    ? html`<span class="fs-vod-rating-badge">
                                                          ★ ${rating}
                                                      </span>`
                                                    : null}
                                                ${fav
                                                    ? html`<span class="fs-vod-fav-badge">❤️</span>`
                                                    : null}
                                            </div>
                                            <div class="fs-vod-meta">
                                                <span class="fs-vod-title">${item.name}</span>
                                                <span class="fs-vod-year">${sub}</span>
                                            </div>
                                        </button>`
                                    })}
                                </div>`}
                        ${channels.hasMore
                            ? html`<div class="fs-vod-load-more">
                                  <button
                                      type="button"
                                      class="row channel fs-btn-secondary"
                                      tabindex="-1"
                                      onClick=${store.loadMore}
                                  >
                                      Afficher plus (${store.formatCount(channels.items.length)} /
                                      ${store.formatCount(channels.total)})
                                  </button>
                              </div>`
                            : null}
                    </div>
                </div>
            </div>

            <!-- Bottom Status Bar (activity_vod_browser.xml) -->
            <footer class="fs-vod-bottom-bar">
                <span>Sélectionnez un titre et appuyez sur OK pour voir les détails</span>
                <span>◀▶ Navigation • OK Voir • ↩ Retour</span>
            </footer>

            <${MovieDetailOverlay} />
        </section>`
    }

    function TvScreen() {
        const state = store.state

        useEffect(() => {
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

        if (state.mediaType === "movie" || state.mediaType === "series") {
            return html`<${VodBrowserView} />`
        }
        return html`<${LiveZapView} />`
    }

    App.uiScreens.tv = TvScreen
})()
