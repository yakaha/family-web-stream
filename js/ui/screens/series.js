var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const useState = kit.useState
    const BrandLogo = kit.BrandLogo

    App.uiScreens.series = function SeriesEpisodes() {
        const state = store.state
        const series = state.currentSeries
        let allEpisodes = state.seriesEpisodes || []

        if (!allEpisodes.length && series && series.url) {
            allEpisodes = [
                {
                    season: 1,
                    number: 1,
                    title: `${series.name} - Épisode 1`,
                    url: series.url,
                },
            ]
        }

        const listId =
            (series && series.listId) || (state.lists[0] && state.lists[0].id) || "source"
        const isFav = series ? store.isFavorite(listId, series) : false

        // Group episodes by season
        const seasonsMap = {}
        for (let i = 0; i < allEpisodes.length; i++) {
            const ep = allEpisodes[i]
            const s = Number(ep.season) || 1
            if (!seasonsMap[s]) seasonsMap[s] = []
            seasonsMap[s].push(ep)
        }
        Object.keys(seasonsMap).forEach((s) => {
            seasonsMap[s].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
        })
        const seasonNumbers = Object.keys(seasonsMap)
            .map(Number)
            .sort((a, b) => a - b)
        const firstSeason = seasonNumbers.length ? seasonNumbers[0] : 1

        const seasonState = useState(firstSeason)
        const selectedSeason = seasonState[0]
        const setSelectedSeason = seasonState[1]

        const currentSeason = seasonsMap[selectedSeason] ? selectedSeason : firstSeason
        const currentEpisodes = seasonsMap[currentSeason] || []

        const synopsis =
            (series && (series.description || series.plot || series.desc)) ||
            "Sélectionnez une saison puis un épisode ci-dessous pour lancer la lecture."
        const rating = (series && (series.rating || series.rating_5based)) || ""
        const year = (series && (series.year || series.releaseDate)) || "—"
        const genre = (series && (series.genre || series.group)) || "Série TV"
        const director = (series && series.director) || "Non spécifié"
        const cast = (series && (series.actors || series.cast)) || "Non spécifié"

        return html`<section class="fs-series-screen" id="screen-series">
            ${series && series.logo
                ? html`<div
                      class="fs-media-info-backdrop"
                      style=${{ backgroundImage: `url(${JSON.stringify(series.logo)})` }}
                  ></div>`
                : null}
            <div class="fs-media-info-scrim"></div>

            <div class="fs-series-content">
                <!-- Top Bar (activity_series_detail.xml) -->
                <header class="fs-series-topbar">
                    <button
                        type="button"
                        class="fs-btn-back-pill"
                        id="seriesBack"
                        tabindex="-1"
                        onClick=${store.closeSeries}
                    >
                        ← Back
                    </button>
                    <${BrandLogo} compact=${true} />
                    <span class="fs-series-status">
                        ${seasonNumbers.length} saison${seasonNumbers.length > 1 ? "s" : ""} •
                        ${allEpisodes.length} épisode${allEpisodes.length > 1 ? "s" : ""}
                    </span>
                </header>

                <!-- Top Section: Poster + Series Metadata + Synopsis -->
                <div class="fs-series-hero">
                    <div class="fs-series-poster-card">
                        <div
                            class="fs-series-poster-img"
                            style=${kit.logoStyle(series ? series.logo : "")}
                        >
                            ${series && series.logo
                                ? null
                                : html`<span class="fs-vod-placeholder">
                                      ${kit.initial(series ? series.name : "S")}
                                  </span>`}
                        </div>
                    </div>

                    <div class="fs-series-details">
                        <div class="fs-series-title-row">
                            <h1 class="fs-series-title" id="seriesTitle">
                                ${series ? series.name : "Série"}
                            </h1>
                            ${series
                                ? html`<button
                                      type="button"
                                      class="fs-btn-fav-outline fs-btn-fav-sm"
                                      id="seriesFavBtn"
                                      tabindex="-1"
                                      onClick=${() => store.toggleFavorite(series, listId)}
                                  >
                                      ${isFav ? "❤️ Favori" : "🤍 Favori"}
                                  </button>`
                                : null}
                        </div>

                        <div class="fs-media-rating-row">
                            <span class="fs-media-stars">
                                ★ ★ ★ ★ ☆ ${rating ? `(${rating})` : ""}
                            </span>
                        </div>

                        <div class="fs-series-meta-grid">
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Directed By:</span>
                                <span class="fs-meta-val">${director}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Release Date:</span>
                                <span class="fs-meta-val">${year}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Genre:</span>
                                <span class="fs-meta-val">${genre}</span>
                            </div>
                            <div class="fs-media-meta-row">
                                <span class="fs-meta-label">Cast:</span>
                                <span class="fs-meta-val">${cast}</span>
                            </div>
                        </div>

                        <div class="fs-media-divider"></div>
                        <p class="fs-series-synopsis">${synopsis}</p>
                    </div>
                </div>

                <!-- Horizontal Season Pills (item_premium_season.xml) -->
                <div class="fs-seasons-row" id="seriesSeasons">
                    ${seasonNumbers.map((s) => {
                        const count = seasonsMap[s].length
                        const isActive = s === currentSeason
                        return html`<button
                            type="button"
                            class=${`row season-btn fs-season-pill${isActive ? " active" : ""}`}
                            tabindex="-1"
                            key=${s}
                            data-season=${s}
                            onClick=${() => {
                                setSelectedSeason(s)
                                if (App.tv) App.tv.set("seriesEpisodes", 0, 0)
                            }}
                        >
                            <span class="fs-season-pill-title">Saison ${s}</span>
                            <span class="fs-season-pill-count">${count} ép.</span>
                        </button>`
                    })}
                </div>

                <!-- Episodes Section Label -->
                <div class="fs-episodes-section-head">
                    <span class="fs-episodes-label">
                        ÉPISODES — SAISON ${currentSeason} (${currentEpisodes.length})
                    </span>
                </div>

                <!-- Episodes List / Grid (item_premium_episode.xml) -->
                <div class="fs-episodes-grid" id="seriesEpisodes">
                    ${currentEpisodes.length
                        ? currentEpisodes.map((episode, index) => {
                              const epNum = episode.number || index + 1
                              const code = `S${String(currentSeason).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`
                              return html`<button
                                  type="button"
                                  class="row channel fs-episode-card"
                                  tabindex="-1"
                                  key=${`${episode.season}-${epNum}-${index}`}
                                  onClick=${() => store.playSeriesEpisode(episode)}
                              >
                                  <span class="fs-ep-play-icon">▶</span>
                                  <span class="fs-ep-info">
                                      <span class="fs-ep-title">
                                          ${episode.title || `Épisode ${epNum}`}
                                      </span>
                                      <span class="fs-ep-code">${code}</span>
                                  </span>
                              </button>`
                          })
                        : html`<p class="empty">Aucun épisode disponible pour cette saison.</p>`}
                </div>
            </div>
        </section>`
    }
})()
