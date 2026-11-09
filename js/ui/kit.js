var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiKit = (function () {
    const preact = window.preact
    const hooks = window.preactHooks
    const html = window.htm.bind(preact.h)
    const useState = hooks.useState
    const useEffect = hooks.useEffect
    const useRef = hooks.useRef
    const store = App.store

    const SEARCH_DEBOUNCE_MS = 150

    const ADD_TYPES = [
        { id: "url", title: "M3U from URL", hint: "An .m3u or .m3u8 address", icon: "link" },
        { id: "file", title: "M3U from a file", hint: "An .m3u on a USB drive", icon: "file" },
        { id: "xtream", title: "Xtream", hint: "Server, username and password", icon: "key" },
        { id: "stalker", title: "Stalker", hint: "Portal and MAC", icon: "box" },
        { id: "raw", title: "Pasted M3U", hint: "The playlist text", icon: "text" },
        {
            id: "auto",
            title: "Detect",
            hint: "Paste whatever your provider gave you",
            icon: "wand",
        },
    ]

    const FIELD_SETS = {
        url: [{ id: "url", label: "Playlist address", placeholder: "http://host:8080/list.m3u" }],
        file: [],
        xtream: [
            { id: "origin", label: "Server", placeholder: "http://host:8080" },
            { id: "user", label: "Username" },
            { id: "pass", label: "Password" },
        ],
        stalker: [
            { id: "origin", label: "Portal", placeholder: "http://host:8080/c" },
            { id: "mac", label: "MAC", placeholder: "00:1A:79:12:34:56" },
        ],
        raw: [{ id: "text", label: "Playlist contents", multiline: true, placeholder: "#EXTM3U…" }],
        auto: [
            {
                id: "text",
                label: "Paste the address, the credentials or the whole message",
                multiline: true,
            },
        ],
    }

    function svg(paths, size) {
        return html`<svg viewBox="0 0 24 24" width=${size || 22} height=${size || 22}>
            ${paths}
        </svg>`
    }

    const iconList = svg(
        html`<path
            d="M3 6h18M3 12h18M3 18h12"
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
        />`,
        24,
    )
    const iconTv = svg(
        html`<rect
                x="2.5"
                y="5"
                width="19"
                height="13"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M8.5 21h7"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
        24,
    )
    const iconClock = svg(
        html`<circle
                cx="12"
                cy="12"
                r="8.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M12 7.5V12l3 2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
        24,
    )
    const iconStar = svg(
        html`<path
            d="M12 4.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
        />`,
        24,
    )
    const iconSearch = svg(
        html`<circle
                cx="11"
                cy="11"
                r="6.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
            /><path
                d="M16 16l4.5 4.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />`,
    )
    const iconLink = svg(
        html`<path
                d="M10 13a4 4 0 006 .5l2-2a4 4 0 00-5.6-5.7L11 7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            /><path
                d="M14 11a4 4 0 00-6-.5l-2 2A4 4 0 0011.6 18L13 16.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconFile = svg(
        html`<path
                d="M6 3h8l4 4v14H6z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
            /><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.7" />`,
    )
    const iconKey = svg(
        html`<circle
                cx="8"
                cy="12"
                r="3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
            /><path
                d="M11.5 12H21M18 12v3M15 12v2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconBox = svg(
        html`<rect
                x="3"
                y="6"
                width="18"
                height="12"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
            /><path
                d="M7 10h6M7 14h10"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
            />`,
    )
    const iconText = svg(
        html`<path
            d="M5 7h14M5 12h14M5 17h8"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
        />`,
    )
    const iconWand = svg(
        html`<path
            d="M6 18L18 6M15 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
        />`,
    )
    const iconPencil = svg(
        html`<path
                d="M5 19h3L19 8l-3-3L5 16z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
            /><path d="M15 6l3 3" fill="none" stroke="currentColor" stroke-width="1.7" />`,
        20,
    )
    const iconCheck = svg(
        html`<path
            d="M5 13l4 4L19 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
        />`,
    )

    const iconPremiumLive = html`<svg viewBox="0 0 24 24" width="38" height="38" class="premium-card-svg">
        <path
            fill="#FFFFFF"
            d="M21,6h-7.59l3.29,-3.29L16,2l-4,4 -4,-4 -0.71,0.71L10.59,6H3C1.9,6 1,6.89 1,8v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.9 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20z"
        />
        <path fill="#7DD3FC" d="M9.5,10.5l6,3.5 -6,3.5z" />
    </svg>`

    const iconPremiumMovies = html`<svg viewBox="0 0 24 24" width="38" height="38" class="premium-card-svg">
        <path
            fill="#FFFFFF"
            d="M18,4l2,4h-3l-2,-4h-2l2,4h-3l-2,-4H8l2,4H7L5,4H4C2.9,4 2.01,4.9 2.01,6L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V4H18zM20,18H4V10h16V18z"
        />
        <path fill="#D8B4FE" d="M10,11.5l5,2.5 -5,2.5z" />
    </svg>`

    const iconPremiumSeries = html`<svg viewBox="0 0 24 24" width="38" height="38" class="premium-card-svg">
        <path
            fill="#FFFFFF"
            d="M4,6H2v14c0,1.1 0.9,2 2,2h14v-2H4V6zM20,2H8C6.9,2 6,2.9 6,4v12c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V4C22,2.9 21.1,2 20,2zM20,16H8V4h12V16z"
        />
        <path fill="#FCD34D" d="M12,6.5l5,3.5 -5,3.5z" />
    </svg>`

    const iconRefresh = html`<svg viewBox="0 0 24 24" width="16" height="16">
        <path
            fill="currentColor"
            d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
        />
    </svg>`

    function BrandLogo(props) {
        const compact = !!(props && props.compact)
        const size = compact ? 36 : 44
        return html`<div class=${`fs-brand-header${compact ? " compact" : ""}`}>
            <svg viewBox="0 0 120 120" width=${size} height=${size} class="fs-brand-icon">
                <path
                    fill="rgba(59, 130, 246, 0.12)"
                    stroke="rgba(96, 165, 250, 0.28)"
                    stroke-width="2"
                    d="M60,4 A56,56,0,1,1,60,116 A56,56,0,1,1,60,4z"
                />
                <path
                    stroke="rgba(59, 130, 246, 0.25)"
                    stroke-width="3"
                    stroke-linecap="round"
                    fill="none"
                    d="M88,32 A40,40,0,0,1,88,88"
                />
                <path
                    stroke="rgba(59, 130, 246, 0.5)"
                    stroke-width="3"
                    stroke-linecap="round"
                    fill="none"
                    d="M78,42 A26,26,0,0,1,78,78"
                />
                <path fill="#6366F1" d="M42,35 L42,85 L85,60 Z" />
                <path fill="#3B82F6" d="M42,35 L42,60 L63.5,47.5 Z" />
                <path fill="#60A5FA" d="M60,12 A48,48,0,1,1,59.9,12 Z" fill-opacity="0.06" />
            </svg>
            <div class="fs-brand-texts">
                <span class="fs-brand-title">Family Stream</span>
                ${props && props.subtitle
                    ? html`<span class="fs-brand-sub">${props.subtitle}</span>`
                    : null}
            </div>
        </div>`
    }

    function dateClockValue() {
        const now = new Date()
        const time = `${`0${now.getHours()}`.slice(-2)}:${`0${now.getMinutes()}`.slice(-2)}`
        const days = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."]
        const months = [
            "Janv.",
            "Févr.",
            "Mars",
            "Avr.",
            "Mai",
            "Juin",
            "Juil.",
            "Août",
            "Sept.",
            "Oct.",
            "Nov.",
            "Déc.",
        ]
        const date = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`
        return { time, date }
    }

    function useDateClock() {
        const state = useState(dateClockValue())
        const setVal = state[1]
        useEffect(() => {
            const tick = setInterval(() => {
                setVal(dateClockValue())
            }, 15000)
            return function () {
                clearInterval(tick)
            }
        }, [])
        return state[0]
    }

    const TYPE_ICONS = {
        link: iconLink,
        file: iconFile,
        key: iconKey,
        box: iconBox,
        text: iconText,
        wand: iconWand,
    }

    function initial(name) {
        const match = (name || "").match(/[a-z0-9]/i)
        return match ? match[0].toUpperCase() : "?"
    }

    function logoStyle(url) {
        return url ? { backgroundImage: `url(${JSON.stringify(url)})` } : null
    }

    function clock(value) {
        const match = (value || "").match(/(\d{1,2}:\d{2})/)
        return match ? match[1] : ""
    }

    function programText(program) {
        if (!program || !program.title) return ""
        const span =
            program.start && program.end ? ` ${clock(program.start)}–${clock(program.end)}` : ""
        return program.title + span
    }

    // Rail clock: the system time, refreshed by the minute. A clock that ticks every
    // second is a distraction on a TV.
    function timeText() {
        const now = new Date()
        return `${`0${now.getHours()}`.slice(-2)}:${`0${now.getMinutes()}`.slice(-2)}`
    }

    function useClock() {
        const state = useState(timeText())
        const setTime = state[1]
        useEffect(() => {
            const tick = setInterval(() => {
                setTime(timeText())
            }, 20000)
            return function () {
                clearInterval(tick)
            }
        }, [])
        return state[0]
    }

    // Sidebar: the brand, the four sections, a shortcut to each source and, at the
    // bottom, the clock and the count. Anchored to the grid: 64px sections, 56px sources.
    function Rail(props) {
        const items = [
            {
                id: "navHome",
                label: "Sources",
                icon: iconList,
                screens: ["home"],
                action: function () {
                    store.goHome()
                },
            },
            {
                id: "navTv",
                label: "Live TV",
                icon: iconTv,
                screens: ["tv", "cats"],
                action: function () {
                    store.openTv()
                },
            },
            {
                id: "navMovies",
                label: "Movies",
                icon: iconTv,
                screens: [],
                action: function () { store.openMedia("movie") },
            },
            {
                id: "navSeries",
                label: "Series",
                icon: iconTv,
                screens: [],
                action: function () { store.openMedia("series") },
            },
            {
                id: "navServers",
                label: "MAC Servers",
                icon: iconList,
                screens: ["servers"],
                action: function () { store.openServers() },
            },
            {
                id: "navRecents",
                label: "Recent",
                icon: iconClock,
                screens: ["recents"],
                action: function () {
                    store.openRecents()
                },
            },
            {
                id: "navFavs",
                label: "Favorites",
                icon: iconStar,
                screens: ["favs"],
                action: function () {
                    store.openFavorites()
                },
            },
        ]
        const nav = useRef(null)
        const clock = useClock()
        const stats = store.stats()
        const sources = store.state.lists.slice(0, 3)
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

        useEffect(() => {
            const rail = nav.current
            if (!rail) return
            const element = rail.querySelector(".rail-btn.active")
            const height = element ? Math.round(element.offsetHeight * 0.62) : 0
            rail.style.setProperty("--rail-mark-h", `${height}px`)
            rail.style.setProperty(
                "--rail-mark-y",
                element
                    ? `${element.offsetTop + Math.round((element.offsetHeight - height) / 2)}px`
                    : "0px",
            )
            // The marker stretches as it travels: you see the trip, not a jump.
            rail.classList.add("moving")
            const timer = setTimeout(() => {
                rail.classList.remove("moving")
            }, 300)
            return function () {
                clearTimeout(timer)
            }
        }, [props.screen])

        return html`<nav class="rail" ref=${nav}>
            <span class="rail-glow" aria-hidden="true"></span>
            <div class="brand" aria-hidden="true">
                <img class="brand-img" src="brand.png" alt="" />
                <span class="wordmark">
                    <span class="wordmark-name">Family</span>
                    <span class="wordmark-tag">Premium</span>
                </span>
            </div>
            <div class="rail-nav">
                ${items.map((item) => {
                    const active = item.screens.indexOf(props.screen) !== -1 ||
                        (item.id === "navMovies" && props.screen === "tv" && store.state.mediaType === "movie") ||
                        (item.id === "navSeries" && props.screen === "tv" && store.state.mediaType === "series") ||
                        (item.id === "navTv" && props.screen === "tv" && store.state.mediaType === "live")
                    return html`<button
                        id=${item.id}
                        class=${`rail-btn${active ? " active" : ""}`}
                        tabindex="-1"
                        onClick=${item.action}
                    >
                        ${item.icon}<span>${item.label}</span>
                    </button>`
                })}
            </div>
            ${
                sources.length
                    ? html`<div class="rail-block">
                          <p class="rail-title">Sources</p>
                          ${sources.map((list) => {
                              return html`<button
                                  class=${`rail-src${
                                      props.screen === "tv" && store.state.tvSource === list.id
                                          ? " selected"
                                          : ""
                                  }`}
                                  tabindex="-1"
                                  data-list=${list.id}
                                  onClick=${function () {
                                      store.openSource(list.id)
                                  }}
                              >
                                  <span class="rail-src-name">${list.name}</span>
                                  <span class="rail-src-kind">${store.listLabel(list)}</span>
                              </button>`
                          })}
                      </div>`
                    : null
            }
            <div class="rail-foot">
                <button
                    class="rail-fs-btn rail-install-btn"
                    id="railInstallBtn"
                    title="Installer l'application"
                    tabindex="-1"
                    onClick=${function () {
                        if (App.installPwa) App.installPwa()
                    }}
                >
                    <span class="rail-fs-icon">📲</span>
                    <span class="rail-fs-label">Installer l'app</span>
                </button>
                <button
                    class="rail-fs-btn"
                    id="railFsBtn"
                    title=${isFullscreen ? "Quitter le plein écran" : "Plein écran"}
                    tabindex="-1"
                    onClick=${function () {
                        if (App.toggleFullscreen) App.toggleFullscreen()
                    }}
                >
                    <span class="rail-fs-icon">${isFullscreen ? "⤦" : "⛶"}</span>
                    <span class="rail-fs-label">${isFullscreen ? "Réduire" : "Plein écran"}</span>
                </button>
                <p class="rail-clock" id="railClock">${clock}</p>
                <p class="rail-counts" id="railCounts">${stats.counts}</p>
            </div>
        </nav>`
    }

    function ChannelRow(props) {
        const channel = props.channel
        const listId = props.listId || channel.listId
        const now = programText(store.programOf(channel))
        function open() {
            const isMobile = typeof window !== "undefined" && (window.innerWidth <= 768 || (window.matchMedia && window.matchMedia("(max-width: 768px)").matches))
            if (isMobile) {
                if (channel.mediaType === "series") {
                    store.openSeries(channel)
                } else {
                    store.play(channel, listId, props.source)
                }
            } else if (props.detail) {
                store.selectPreview(channel)
            } else {
                store.play(channel, listId, props.source)
            }
        }
        return html`<button
            class="row channel"
            data-url=${channel.url}
            data-list=${listId}
            tabindex="-1"
            onClick=${open}
        >
            <span class="num">${props.number}</span>
            <span class="thumb" style=${logoStyle(channel.logo)}>
                ${channel.logo ? null : html`<span class="thumb-letter">${initial(channel.name)}</span>`}
            </span>
            <span class="row-main">
                <span class="row-name">${channel.name}</span>
                ${
                    props.detail && now
                        ? html`<span class="row-sub">${now}</span>`
                        : props.showGroup
                          ? html`<span class="row-sub">${channel.group || ""}</span>`
                          : null
                }
            </span>
            ${!props.detail && now ? html`<span class="row-now">${now}</span>` : null}
            ${props.saved ? html`<span class="saved">★</span>` : null}
        </button>`
    }

    function ChannelList(props) {
        const view = props.view
        function listOf(channel) {
            return props.listId || channel.listId
        }
        return html`<div class="rows" id=${props.id}>
            ${
                view.loading
                    ? html`<div class="empty loading-channels"><span class="spinner"></span> <span>Chargement des chaînes…</span></div>`
                    : view.total
                      ? null
                      : html`<p class="empty">${view.empty || "No channels."}</p>`
            }
            ${view.items.map((channel, index) => {
                return html`<${ChannelRow}
                    key=${channel.url || channel.cmd || index}
                    channel=${channel}
                    listId=${listOf(channel)}
                    number=${index + 1}
                    source=${view.items}
                    showGroup=${view.showGroup}
                    detail=${props.detail}
                    saved=${store.isFavorite(listOf(channel), channel.url || channel)}
                />`
            })}
            ${view.hasMore ? html`<button class="row channel load-more" tabindex="-1" onClick=${store.loadMore}>
                Show ${store.formatCount(Math.min(200, view.total - view.items.length))} more
                <span class="row-count">${store.formatCount(view.items.length)} / ${store.formatCount(view.total)}</span>
            </button>` : null}
        </div>`
    }

    function SourceRow(props) {
        const channels = props.channels
        return html`<div
            class="row source"
            data-list=${props.list.id}
            tabindex="-1"
            onClick=${function () {
                store.openSource(props.list.id)
            }}
        >
            <span class="kind">${store.listLabel(props.list)}</span>
            <span class="row-main">
                <span class="row-name">${props.list.name}</span>
                <span class="row-sub">${props.list.url || props.list.origin || ""}</span>
            </span>
            <span class="row-count">${channels ? store.formatCount(channels.length) : "—"}</span>
            <button
                class="edit"
                data-list=${props.list.id}
                tabindex="-1"
                aria-label="Edit source"
                onClick=${function (event) {
                    event.stopPropagation()
                    store.openEdit(props.list.id)
                }}
            >
                ${iconPencil}<span>Edit</span>
            </button>
        </div>`
    }

    function AddRow() {
        return html`<button
            class="row add"
            tabindex="-1"
            onClick=${function () {
                store.openAdd()
            }}
        >
            <span class="kind">+</span>
            <span class="row-main">
                <span class="row-name">Add source</span>
                <span class="row-sub">M3U, Xtream, Stalker or pasted text</span>
            </span>
        </button>`
    }

    function Search(props) {
        const inputRef = useRef(null)
        const timer = useRef(null)
        useEffect(() => {
            if (inputRef.current)
                inputRef.current.value =
                    props.value !== undefined ? props.value : store.searchOf(props.scope)
        }, [props.scope, props.resetKey, props.value])

        function onInput(event) {
            const value = event.target.value
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                props.onInput(value)
            }, SEARCH_DEBOUNCE_MS)
        }

        return html`<div class="search">
            ${iconSearch}
            <input
                id=${props.id}
                ref=${inputRef}
                type="text"
                placeholder=${props.placeholder}
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                tabindex="-1"
                onInput=${onInput}
            />
            <span class="search-count" id=${props.countId}>${props.count}</span>
        </div>`
    }

    function Bar(props) {
        return html`<header class="bar">
            <div class="bar-text">
                <h1 id=${props.titleId}>${props.title}</h1>
                <p class="meta" id=${props.metaId}>${props.meta}</p>
            </div>
            ${props.actions || null} ${props.search || null}
        </header>`
    }

    return {
        html,
        store,
        useState,
        useEffect,
        useRef,
        TYPE_ICONS,
        ADD_TYPES,
        FIELD_SETS,
        clock,
        svg,
        initial,
        logoStyle,
        programText,
        iconCheck,
        iconPremiumLive,
        iconPremiumMovies,
        iconPremiumSeries,
        iconRefresh,
        BrandLogo,
        useDateClock,
        Rail,
        Bar,
        Search,
        ChannelRow,
        ChannelList,
        SourceRow,
        AddRow,
    }
})()
