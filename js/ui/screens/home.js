var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const useState = kit.useState
    const useEffect = kit.useEffect
    const BrandLogo = kit.BrandLogo

    function GlobalSearchModal() {
        const state = store.state
        if (!state.globalSearchOpen) return null
        const results = store.globalSearchResults()

        function onSelectItem(item) {
            store.closeGlobalSearch()
            if (item.mediaType === "series") {
                store.openSeries(item)
            } else if (item.mediaType === "movie") {
                store.openMedia("movie")
                setTimeout(() => {
                    store.openMovieDetail(item)
                }, 50)
            } else {
                store.play(item, item.listId || (state.lists[0] && state.lists[0].id), results)
            }
        }

        return html`<div class="fs-global-search-overlay" id="globalSearchModal">
            <div class="fs-global-search-box">
                <header class="fs-zap-topbar">
                    <button
                        type="button"
                        class="fs-round-back"
                        id="globalSearchBack"
                        tabindex="-1"
                        onClick=${() => store.closeGlobalSearch()}
                    >
                        ←
                    </button>
                    <h2 class="fs-zap-title">Recherche Globale</h2>
                    <div class="fs-zap-search-wrap">
                        <span class="fs-zap-search-icon">🔍</span>
                        <input
                            type="text"
                            id="globalSearchInput"
                            class="fs-zap-search-input"
                            placeholder="Rechercher une chaîne, un film ou une série…"
                            value=${state.globalSearchQuery}
                            autocomplete="off"
                            onInput=${(e) => store.setGlobalSearchQuery(e.target.value)}
                        />
                    </div>
                </header>

                <div class="fs-global-search-body" id="globalSearchResults">
                    ${!state.globalSearchQuery || state.globalSearchQuery.trim().length < 2
                        ? html`<div class="fs-empty-state">
                              <span class="fs-empty-icon">🔍</span>
                              <p>Tapez au moins 2 lettres pour rechercher dans votre catalogue chargé.</p>
                          </div>`
                        : results.length === 0
                          ? html`<div class="fs-empty-state">
                                <span class="fs-empty-icon">😕</span>
                                <p>Aucun résultat trouvé pour « ${state.globalSearchQuery} ».</p>
                            </div>`
                          : html`<div class="fs-vod-grid">
                                ${results.map((item, idx) => {
                                    const badge =
                                        item.mediaType === "movie"
                                            ? "FILM"
                                            : item.mediaType === "series"
                                              ? "SÉRIE"
                                              : "DIRECT"
                                    return html`<button
                                        type="button"
                                        class="fs-vod-card search-result-item"
                                        key=${item.id || item.url || idx}
                                        tabindex="-1"
                                        onClick=${() => onSelectItem(item)}
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
                                            <span class="fs-vod-badge">${badge}</span>
                                        </div>
                                        <div class="fs-vod-meta">
                                            <span class="fs-vod-title">${item.name}</span>
                                            <span class="fs-vod-year">${item.group || ""}</span>
                                        </div>
                                    </button>`
                                })}
                            </div>`}
                </div>
            </div>
        </div>`
    }

    App.uiScreens.home = function Home() {
        const state = store.state
        const dateClock = kit.useDateClock()
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

        const activeList = state.lists[0] || null
        const cats = (activeList && state.categories[activeList.id]) || {}
        const liveCatCount = cats.live ? cats.live.length : 0
        const movieCatCount = cats.movie ? cats.movie.length : 0
        const seriesCatCount = cats.series ? cats.series.length : 0

        const userName =
            (state.firebaseUser && state.firebaseUser.name) ||
            (activeList && activeList.name) ||
            "Utilisateur VIP"
        const activeServer =
            (state.firebaseServers || []).find((s) => s.id === state.activeServerId) || activeList
        const serverName = activeServer ? activeServer.name : "Serveur Principal"

        return html`<section class="fs-home-screen" id="screen-home">
            <!-- Top Bar (activity_premium_home.xml) -->
            <header class="fs-home-topbar">
                <div class="fs-home-brand">
                    <${BrandLogo} compact=${true} />
                </div>

                <div class="fs-home-top-actions" id="homeTopBtns">
                    <button
                        type="button"
                        class="fs-top-pill"
                        id="btnTopSearch"
                        tabindex="-1"
                        onClick=${() => store.openGlobalSearch()}
                    >
                        🔍 <span>Recherche</span>
                    </button>
                    <button
                        type="button"
                        class="fs-top-pill"
                        id="btnTopProfile"
                        tabindex="-1"
                        onClick=${() => {
                            if (state.firebaseUser && state.firebaseServers && state.firebaseServers.length) {
                                store.openServers()
                            } else {
                                store.notify(`Compte actif : ${userName} · ${serverName}`)
                            }
                        }}
                    >
                        👤 <span>Compte</span>
                    </button>
                    <button
                        type="button"
                        class=${`fs-top-pill${state.parentalLocked ? " active-lock" : ""}`}
                        id="btnTopParental"
                        tabindex="-1"
                        onClick=${() => store.toggleParental()}
                    >
                        ${state.parentalLocked ? "🔒" : "🔓"} <span>Parental</span>
                    </button>
                    <button
                        type="button"
                        class="fs-top-pill"
                        id="btnTopChangePin"
                        tabindex="-1"
                        onClick=${() => store.changeAccountPin()}
                    >
                        🔄 <span>Changer</span>
                    </button>
                    <button
                        type="button"
                        class="fs-top-pill"
                        id="btnTopInstall"
                        tabindex="-1"
                        onClick=${() => {
                            if (App.installPwa) App.installPwa()
                        }}
                    >
                        📲 <span>Installer</span>
                    </button>
                    <button
                        type="button"
                        class="fs-top-pill"
                        id="btnTopFullscreen"
                        tabindex="-1"
                        onClick=${() => {
                            if (App.toggleFullscreen) App.toggleFullscreen()
                        }}
                    >
                        ${isFullscreen ? "⤦" : "⛶"}
                        <span>${isFullscreen ? "Réduire" : "Plein écran"}</span>
                    </button>
                </div>

                <div class="fs-home-clock">
                    <span class="fs-clock-time" id="tvClock">${dateClock.time}</span>
                    <span class="fs-clock-date" id="tvDate">${dateClock.date}</span>
                </div>
            </header>

            <!-- Center Row: 3 Main Luxury Cards (TV EN DIRECT, FILMS, SÉRIES) -->
            <div class="fs-home-cards-row" id="homeCards">
                <!-- Card 1: TV EN DIRECT -->
                <div
                    class="fs-premium-card fs-card-live"
                    id="cardLive"
                    role="button"
                    tabindex="-1"
                    onClick=${() => store.openTv()}
                >
                    <img
                        class="fs-card-bg-art"
                        src="img/bg_card_live_art.jpg"
                        alt=""
                        loading="eager"
                    />
                    <div class="fs-card-sheen"></div>
                    <div class="fs-card-content">
                        <div class="fs-card-top-row">
                            <div class="fs-card-icon-badge">${kit.iconPremiumLive}</div>
                            ${liveCatCount
                                ? html`<span class="fs-card-count-pill"
                                      >${store.formatCount(liveCatCount)} cat.</span
                                  >`
                                : null}
                        </div>
                        <div class="fs-card-spacer"></div>
                        <h2 class="fs-card-title">TV EN DIRECT</h2>
                        <p class="fs-card-subtitle">Chaînes & Guide EPG</p>
                        <div class="fs-card-divider"></div>
                        <div class="fs-card-footer">
                            <span class="fs-card-footer-label">Direct & Zapping</span>
                            <button
                                type="button"
                                class="fs-card-refresh-btn"
                                title="Actualiser TV en Direct"
                                tabindex="-1"
                                onClick=${(e) => {
                                    e.stopPropagation()
                                    store.refreshMediaCatalog("live")
                                }}
                            >
                                ${kit.iconRefresh}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Card 2: FILMS -->
                <div
                    class="fs-premium-card fs-card-movies"
                    id="cardMovies"
                    role="button"
                    tabindex="-1"
                    onClick=${() => store.openMedia("movie")}
                >
                    <img
                        class="fs-card-bg-art"
                        src="img/bg_card_movies_art.jpg"
                        alt=""
                        loading="eager"
                    />
                    <div class="fs-card-sheen"></div>
                    <div class="fs-card-content">
                        <div class="fs-card-top-row">
                            <div class="fs-card-icon-badge">${kit.iconPremiumMovies}</div>
                            ${movieCatCount
                                ? html`<span class="fs-card-count-pill"
                                      >${store.formatCount(movieCatCount)} cat.</span
                                  >`
                                : null}
                        </div>
                        <div class="fs-card-spacer"></div>
                        <h2 class="fs-card-title">FILMS</h2>
                        <p class="fs-card-subtitle">Cinéma & VOD</p>
                        <div class="fs-card-divider"></div>
                        <div class="fs-card-footer">
                            <span class="fs-card-footer-label">Catalogue VOD</span>
                            <button
                                type="button"
                                class="fs-card-refresh-btn"
                                title="Actualiser les Films"
                                tabindex="-1"
                                onClick=${(e) => {
                                    e.stopPropagation()
                                    store.refreshMediaCatalog("movie")
                                }}
                            >
                                ${kit.iconRefresh}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Card 3: SÉRIES -->
                <div
                    class="fs-premium-card fs-card-series"
                    id="cardSeries"
                    role="button"
                    tabindex="-1"
                    onClick=${() => store.openMedia("series")}
                >
                    <img
                        class="fs-card-bg-art"
                        src="img/bg_card_series_art.jpg"
                        alt=""
                        loading="eager"
                    />
                    <div class="fs-card-sheen"></div>
                    <div class="fs-card-content">
                        <div class="fs-card-top-row">
                            <div class="fs-card-icon-badge">${kit.iconPremiumSeries}</div>
                            ${seriesCatCount
                                ? html`<span class="fs-card-count-pill"
                                      >${store.formatCount(seriesCatCount)} cat.</span
                                  >`
                                : null}
                        </div>
                        <div class="fs-card-spacer"></div>
                        <h2 class="fs-card-title">SÉRIES</h2>
                        <p class="fs-card-subtitle">Saisons & Épisodes</p>
                        <div class="fs-card-divider"></div>
                        <div class="fs-card-footer">
                            <span class="fs-card-footer-label">Saisons complètes</span>
                            <button
                                type="button"
                                class="fs-card-refresh-btn"
                                title="Actualiser les Séries"
                                tabindex="-1"
                                onClick=${(e) => {
                                    e.stopPropagation()
                                    store.refreshMediaCatalog("series")
                                }}
                            >
                                ${kit.iconRefresh}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bottom Status Row (3 Glass Chips) -->
            <footer class="fs-home-bottom">
                <div class="fs-status-chip">
                    <span>👤 Logged In : <strong>${userName}</strong> (${serverName})</span>
                </div>
                <div class="fs-status-chip">
                    <span>📅 Expiration : <strong class="fs-text-green">Actif • Illimité</strong></span>
                </div>
                <div class="fs-status-chip fs-chip-right">
                    <span>💡 [OK] Valider • [◀ / ▶] Choisir</span>
                </div>
            </footer>

            <${GlobalSearchModal} />
        </section>`
    }
})()
