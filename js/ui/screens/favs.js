var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const Search = kit.Search
    const ChannelList = kit.ChannelList

    App.uiScreens.favs = function Favs() {
        const view = store.visibleFavorites()
        return html`<section class="screen" id="screen-favs">
            <${Bar}
                title="Favorites"
                meta=${view.label}
                metaId="favsMeta"
                titleId="favsTitle"
                search=${html`<${Search}
                    id="favsSearch"
                    countId="favsSearchCount"
                    scope="favorites"
                    resetKey="favorites"
                    placeholder="Search favorites"
                    count=${view.count}
                    onInput=${function (value) {
                        store.setSearch("favorites", value)
                    }}
                />`}
            />
            ${view.total ? null : html`<p class="empty">Mark channels with the red key while you watch them and they will show up here.</p>`}
            <${ChannelList} id="favList" view=${view} />
        </section>`
    }
})()
