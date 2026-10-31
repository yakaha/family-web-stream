var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const useState = kit.useState

    App.uiScreens.series = function SeriesEpisodes() {
        const state = store.state
        const series = state.currentSeries
        const allEpisodes = state.seriesEpisodes || []

        // Group episodes by season
        const seasonsMap = {}
        for (let i = 0; i < allEpisodes.length; i++) {
            const ep = allEpisodes[i]
            const s = Number(ep.season) || 1
            if (!seasonsMap[s]) seasonsMap[s] = []
            seasonsMap[s].push(ep)
        }
        // Sort episodes within each season by episode number
        Object.keys(seasonsMap).forEach((s) => {
            seasonsMap[s].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
        })
        const seasonNumbers = Object.keys(seasonsMap).map(Number).sort((a, b) => a - b)
        const firstSeason = seasonNumbers.length ? seasonNumbers[0] : 1

        const seasonState = useState(firstSeason)
        const selectedSeason = seasonState[0]
        const setSelectedSeason = seasonState[1]

        const currentSeason = seasonsMap[selectedSeason] ? selectedSeason : firstSeason
        const currentEpisodes = seasonsMap[currentSeason] || []

        return html`<section class="screen" id="screen-series">
            <${Bar}
                title=${series ? series.name : "Série"}
                titleId="seriesTitle"
                meta=${`${allEpisodes.length} épisode${allEpisodes.length === 1 ? "" : "s"} · ${seasonNumbers.length} saison${seasonNumbers.length === 1 ? "" : "s"}`}
                metaId="seriesMeta"
                actions=${html`<div class="bar-actions"><button class="btn" id="seriesBack" onClick=${store.closeSeries}>Retour</button></div>`}
            />
            <div class="series-container">
                <div class="series-seasons-col" id="seriesSeasons">
                    <div class="series-seasons-header">
                        <span>Saisons (${seasonNumbers.length})</span>
                    </div>
                    <div class="series-seasons-list">
                        ${seasonNumbers.map((s) => {
                            const count = seasonsMap[s].length
                            const isActive = s === currentSeason
                            return html`<button
                                class=${`row season-btn${isActive ? " active" : ""}`}
                                tabindex="-1"
                                key=${s}
                                data-season=${s}
                                onClick=${() => {
                                    setSelectedSeason(s)
                                    if (App.tv) App.tv.set("seriesEpisodes", 0, 0)
                                }}
                            >
                                <span class="season-badge">S${String(s).padStart(2, "0")}</span>
                                <span class="row-main">
                                    <span class="row-name">Saison ${s}</span>
                                    <span class="row-sub">${count} épisode${count > 1 ? "s" : ""}</span>
                                </span>
                                <span class="server-card-arrow">${isActive ? "●" : "›"}</span>
                            </button>`
                        })}
                    </div>
                </div>

                <div class="series-episodes-col">
                    <div class="series-episodes-header">
                        <span>Épisodes — Saison ${currentSeason} (${currentEpisodes.length})</span>
                    </div>
                    <div class="series-list" id="seriesEpisodes">
                        ${currentEpisodes.length ? currentEpisodes.map((episode, index) => html`<button
                            class="row channel"
                            tabindex="-1"
                            key=${`${episode.season}-${episode.number}-${index}`}
                            onClick=${() => store.playSeriesEpisode(episode)}
                        >
                            <span class="kind">E${String(episode.number || index + 1).padStart(2, "0")}</span>
                            <span class="row-main">
                                <span class="row-name">${episode.title}</span>
                                <span class="row-sub">Saison ${episode.season || currentSeason} · Épisode ${episode.number || index + 1}</span>
                            </span>
                            <span class="server-card-arrow">▶</span>
                        </button>`) : html`<p class="empty">Aucun épisode disponible pour cette saison.</p>`}
                    </div>
                </div>
            </div>
        </section>`
    }
})()
