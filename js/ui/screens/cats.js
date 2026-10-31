var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}

;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const Bar = kit.Bar
    const Search = kit.Search
    const iconCheck = kit.iconCheck

    App.uiScreens.cats = function Categories() {
        const state = store.state
        const view = store.categoriesView()
        return html`<section class="screen" id="screen-cats">
            <${Bar}
                title="Categories"
                titleId="catsTitle"
                meta=${`${view.selected} of ${view.total} on`}
                metaId="catsMeta"
                actions=${html`<div class="bar-actions" id="catActions">
                    <button
                        class="btn"
                        id="catAll"
                        tabindex="-1"
                        onClick=${function () {
                            store.setAllCategories(true)
                        }}
                    >
                        All
                    </button>
                    <button
                        class="btn"
                        id="catNone"
                        tabindex="-1"
                        onClick=${function () {
                            store.setAllCategories(false)
                        }}
                    >
                        None
                    </button>
                    <button
                        class="btn primary"
                        id="catSave"
                        tabindex="-1"
                        onClick=${function () {
                            store.saveCategories()
                        }}
                    >
                        Save
                    </button>
                </div>`}
                search=${html`<${Search}
                    id="catSearch"
                    countId="catSearchCount"
                    scope="cats"
                    resetKey="cats"
                    placeholder="Search categories"
                    value=${state.catSearch}
                    onInput=${function (value) {
                        store.setCatSearch(value)
                    }}
                />`}
            />
            <div class="rows" id="catList">
                ${view.sections.map((section) => {
                    return html`<div class="cat-source" key=${section.list.id}>
                            <span class="cat-source-name">${section.list.name}</span>
                            <span class="row-count">${store.listLabel(section.list)}</span>
                        </div>
                        ${section.groups.map((group) => {
                            return html`<button
                                class=${`row cat${group.enabled ? " on" : ""}`}
                                tabindex="-1"
                                data-group=${group.name}
                                data-list=${group.listId}
                                onClick=${function () {
                                    store.toggleCategory(group.listId, group.name)
                                }}
                            >
                                <span class="check">${group.enabled ? iconCheck : null}</span>
                                <span class="row-name">${group.name}</span>
                                <span class="row-count">${store.formatCount(group.count)}</span>
                            </button>`
                        })}`
                })}
                ${view.total ? null : html`<p class="empty">${state.lists.length ? "Nothing to show." : "Add a source to choose categories."}</p>`}
            </div>
        </section>`
    }
})()
