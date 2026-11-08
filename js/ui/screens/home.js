var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const SourceRow = kit.SourceRow
    const AddRow = kit.AddRow

    App.uiScreens.home = function Home() {
        const state = store.state
        const sources = store.sources()
        return html`<section class="screen" id="screen-home">
            <${Bar}
                title="Sources"
                titleId="homeTitle"
                meta=${store.stats().counts}
                metaId="listCounts"
                actions=${html`<div class="bar-actions" id="homeActions">
                    <button
                        class="btn"
                        id="addSourceBtn"
                        tabindex="-1"
                        onClick=${function () {
                            store.openAdd()
                        }}
                    >
                        Add source
                    </button>
                    <button class="btn" id="serverSelectBtn" tabindex="-1" onClick=${store.openServers}>Changer de serveur</button>
                    <button
                        class="btn primary"
                        id="installAppBtn"
                        tabindex="-1"
                        onClick=${function () {
                            if (App.installPwa) App.installPwa()
                        }}
                    >
                        📲 Installer l'application
                    </button>
                </div>`}
            />
            <div class="columns">
                <div class="col-groups" id="typeList">
                    ${sources.types.map((type) => {
                        return html`<button
                            class=${`row group type${type.selected ? " selected" : ""}`}
                            tabindex="-1"
                            onClick=${function () {
                                store.setFilter(type.id)
                            }}
                        >
                            <span class="row-name">${type.label}</span>
                            <span class="row-count">${store.formatCount(type.count)}</span>
                        </button>`
                    })}
                </div>
                <div class="rows" id="sourceList">
                    ${
                        sources.items.length
                            ? null
                            : html`<p class="empty">
                                  ${state.lists.length ? "No sources of that type." : "Add your first source: an M3U link, an Xtream portal, Stalker, or the playlist text."}
                              </p>`
                    }
                    ${sources.items.map((list) => {
                        return html`<${SourceRow}
                            key=${list.id}
                            list=${list}
                            channels=${state.channels[list.id]}
                        />`
                    })}
                    <${AddRow} />
                </div>
            </div>
        </section>`
    }
})()
