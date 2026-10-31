var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const Search = kit.Search
    const ChannelList = kit.ChannelList

    App.uiScreens.recents = function Recents() {
        const view = store.visibleRecents()
        return html`<section class="screen" id="screen-recents">
            <${Bar}
                title="Recent"
                meta=${view.label}
                metaId="recentsMeta"
                titleId="recentsTitle"
                search=${html`<${Search}
                    id="recentsSearch"
                    countId="recentsSearchCount"
                    scope="recents"
                    resetKey="recents"
                    placeholder="Search recents"
                    count=${view.count}
                    onInput=${function (value) {
                        store.setSearch("recents", value)
                    }}
                />`}
            />
            <${ChannelList} id="recentsList" view=${view} />
        </section>`
    }
})()
