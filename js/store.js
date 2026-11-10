var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.store = (function () {
    const KEYS = {
        lists: "ts.lists",
        favorites: "ts.favorites",
        recent: "ts.recent",
        progress: "ts.progress",
        filter: "ts.filter",
        search: "ts.search.",
    }
    const PAGE_SIZE = 200
    const MAX_RECENT = 12
    const TOAST_MS = 3600
    // A channel number typed on the remote commits by itself after this.
    const DIGITS_MS = 2200
    // How long a programme listing is trusted before asking the panel again.
    const PROGRAM_MS = 10 * 60 * 1000

    const TYPES = [
        { id: "all", label: "All" },
        { id: "m3u", label: "M3U" },
        { id: "xtream", label: "Xtream" },
        { id: "stalker", label: "Stalker" },
    ]

    const state = {
        canInstallPwa: false,
        screen: "pin",
        mediaType: "live",
        lists: [],
        channels: {},
        groups: {},
        pending: {},
        pendingMedia: {},
        loadedMedia: {},
        viewLimit: PAGE_SIZE,
        flat: null,
        favorites: [],
        recent: [],
        programs: {},
        filter: "all",
        tvSource: null,
        editId: null,
        catDraft: null,
        catSearch: "",
        catName: "",
        loadProgress: {},
        search: {},
        playing: null,
        zapOpen: false,
        menuFocus: false,
        aspectRatio: "fill",
        preview: null,
        previewRequested: false,
        categoryManual: false,
        zapCategory: "",
        playStatus: "idle",
        playError: null,
        zapping: [],
        zapIndex: 0,
        nowProgram: null,
        nextProgram: null,
        numBuffer: "",
        confirm: null,
        loading: null,
        toast: null,
        pendingZone: null,
        firebaseUser: null,
        firebaseServers: [],
        activeServerId: "",
        categories: {},
        loadedCategories: {},
        categoryLoading: false,
        pinError: "",
        pinEntry: "",
        pinLoading: false,
        pinSubmitted: false,
        currentSeries: null,
        seriesEpisodes: [],
        playbackInfo: null,
        vodSort: "default",
        selectedMovie: null,
        globalSearchOpen: false,
        globalSearchQuery: "",
        dnsPref: "1.1.1.1 (Cloudflare)",
        vpnEnabled: true,
        parentalLocked: true,
        statsVisible: false,
    }

    const PROGRESS_MS = 250

    const CATALOG_CACHE_NAME = "family-premium-catalog"
    const CATALOG_CACHE_VERSION = 1
    const CATALOG_CACHE_TTL = 12 * 60 * 60 * 1000

    let listeners = []
    let loadTick = null
    let toastSeq = 0
    let toastTimer = null
    let digitsTimer = null
    let playbackRequest = 0
    let catalogDbPromise = null
    let catalogCacheWarningShown = false

    function subscribe(fn) {
        listeners.push(fn)
        return function () {
            listeners = listeners.filter((item) => {
                return item !== fn
            })
        }
    }

    function emit() {
        for (let i = 0; i < listeners.length; i++) listeners[i]()
    }

    function set(patch) {
        for (const key in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) state[key] = patch[key]
        }
        emit()
    }

    function focus(zone, row, col) {
        state.pendingZone = { zone, row: row || 0, col: col || 0 }
    }

    function takeFocus() {
        const request = state.pendingZone
        state.pendingZone = null
        return request
    }

    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(key)
            return raw ? JSON.parse(raw) : fallback
        } catch {
            return fallback
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value))
        } catch { }
    }

    function formatCount(value) {
        return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    }

    function init() {
        state.lists = read(KEYS.lists, []) || []
        state.favorites = read(KEYS.favorites, []) || []
        state.recent = read(KEYS.recent, []) || []
        state.filter = read(KEYS.filter, "all") || "all"
        state.categories = read("ts.categories", {}) || {}
        state.aspectRatio = read("ts.aspectRatio", "fill") || "fill"
        if (App.player && App.player.setAspectRatio) App.player.setAspectRatio(state.aspectRatio)
        state.loadedCategories = {}
        state.categoryLoading = false
        state.screen = "pin"
    }

    function zoneFor(screen) {
        if (screen === "pin") return "pinGrid"
        if (screen === "tv") return "tvCats"
        if (screen === "episodes") return "seriesSeasons"
        if (screen === "recents") return "recentsList"
        if (screen === "favs") return "favsList"
        if (screen === "home") return "homeCards"
        return null
    }

    function listById(id) {
        for (let i = 0; i < state.lists.length; i++) {
            if (state.lists[i].id === id) return state.lists[i]
        }
        return null
    }

    function listKind(list) {
        if (!list) return "m3u"
        if (list.kind) return list.kind
        return list.user ? "xtream" : "m3u"
    }

    function isVod(channel) {
        return (
            !!channel && (channel.mediaType === "movie" || channel.mediaType === "series-episode")
        )
    }

    function progressId(channel, listId) {
        if (!isVod(channel)) return ""
        const episodeId =
            channel.mediaType === "series-episode"
                ? channel.id ||
                channel.episodeId ||
                channel.episodeNum ||
                channel.number ||
                channel.name
                : ""
        const mediaId =
            channel.resumeId ||
            episodeId ||
            channel.streamId ||
            channel.id ||
            channel.url ||
            channel.cmd ||
            channel.name
        return `${listId || channel.listId || "source"}:${channel.mediaType}:${mediaId}`
    }

    function savedPlayback(channel, listId) {
        const id = progressId(channel, listId)
        if (!id) return 0
        const progress = read(KEYS.progress, {}) || {}
        const entry = progress[id]
        return entry && Number(entry.position) > 0 ? Number(entry.position) : 0
    }

    function recordPlayback(info, force) {
        if (!state.playing || !isVod(state.playing.channel)) return
        const position = Number(info && info.position) || 0
        const duration = Number(info && info.duration) || 0
        if (position < 0 || !isFinite(position)) return
        const now = Date.now()
        if (!force && now - (state.lastProgressWrite || 0) < 4000) return
        state.lastProgressWrite = now

        const id = progressId(state.playing.channel, state.playing.listId)
        if (!id) return
        const progress = read(KEYS.progress, {}) || {}
        if (duration > 0 && duration - position <= 30) delete progress[id]
        else if (position >= 5) progress[id] = { position, duration, updated: now }
        else return
        const keys = Object.keys(progress).sort((a, b) => progress[b].updated - progress[a].updated)
        keys.slice(200).forEach((key) => delete progress[key])
        write(KEYS.progress, progress)
    }

    function refreshPlayback(forceEmit) {
        if (!state.playing || !isVod(state.playing.channel) || !App.player) return
        const info = App.player.playbackInfo()
        state.playbackInfo = info
        recordPlayback(info)
        if (forceEmit) emit()
    }

    function finishPlayback() {
        if (!state.playing || !isVod(state.playing.channel) || !App.player) return
        const info = App.player.playbackInfo()
        if (info.duration > 0) info.position = info.duration
        state.playbackInfo = info
        recordPlayback(info, true)
        emit()
    }

    function listLabel(list) {
        if (listKind(list) === "xtream") return "Xtream"
        if (listKind(list) === "stalker") return "Stalker"
        return list.source === "text" ? "Text" : "M3U"
    }

    function channelsOf(listId) {
        return state.channels[listId] || []
    }
    function groupsOf(listId) {
        return state.groups[listId] || []
    }

    function isMuted(list, group) {
        return !!(list && list.muted && list.muted.indexOf(group) !== -1)
    }

    function groupNames(channels) {
        const seen = {},
            names = []
        for (let i = 0; i < channels.length; i++) {
            const group = channels[i].group || "Otros"
            if (!seen[group]) {
                seen[group] = 1
                names.push(group)
            }
        }
        names.sort(compareCategories)
        return names
    }

    function parseDuration(val) {
        if (!val) return 0
        if (typeof val === "number") {
            if (!isFinite(val) || val <= 0) return 0
            return val > 300 ? val : val * 60
        }
        const str = String(val).trim()
        if (!str) return 0
        if (str.includes(":")) {
            const parts = str.split(":").map(Number)
            if (parts.some(isNaN)) return 0
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
            if (parts.length === 2) return parts[0] * 60 + parts[1]
        }
        const num = parseFloat(str)
        if (!isFinite(num) || num <= 0) return 0
        return num > 300 ? num : num * 60
    }

    function categoryPriority(name) {
        if (!name) return 3
        const str = (typeof name === "string" ? name : name.name || "").trim().toLowerCase()
        if (!str) return 3

        // Priority -2: Pinned beIN SPORTS (Yacine TV)
        if (
            str.includes("bein sport") ||
            str === "⚽ bein sports (yacine tv)" ||
            str === "⚽ bein sports" ||
            str === "bein sports" ||
            str === "__bein__"
        )
            return -2

        // Priority -1: Special Favorites / Recents
        if (str.startsWith("⭐") || str.startsWith("🕒") || str.includes("favori") || str.includes("recent") || str.includes("récent")) return -1

        // Priority 0: French categories (FR, France, French, Français, Francais, VF, VOSTFR)
        const isFrench =
            /^((\||\b|\[|\()?\s*fr\b|\bfrance\b|\bfrench\b|\bfrancais\b|\bfrançais\b|\bvf\b|\bvostfr\b)/i.test(str) ||
            /(?:^|[\s\[\]()_:\-\|\/])(?:fr|france|french|francais|français|vf|vostfr)(?:$|[\s\[\]()_:\-\|\/])/i.test(str)
        if (isFrench) return 0

        // Priority 1: Arabic categories (AR, Arabic, Arabe, Nilesat, or Arabic Unicode script)
        const isArabic =
            /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(str) ||
            /^((\||\b|\[|\()?\s*ar\b|\barabe\b|\barabic\b|\bnilesat\b)/i.test(str) ||
            /(?:^|[\s\[\]()_:\-\|\/])(?:ar|arabe|arabic|nilesat)(?:$|[\s\[\]()_:\-\|\/])/i.test(str)
        if (isArabic) return 1

        return 2
    }

    function compareCategories(first, second) {
        const n1 = typeof first === "string" ? first : (first && first.name) || ""
        const n2 = typeof second === "string" ? second : (second && second.name) || ""
        const p1 = categoryPriority(n1)
        const p2 = categoryPriority(n2)
        if (p1 !== p2) return p1 - p2
        return n1.localeCompare(n2, "fr", { sensitivity: "base", numeric: true })
    }

    function normalizeChannelName(raw) {
        return String(raw || "")
            .toLowerCase()
            .replace(/\b(fhd|uhd|hd|sd|hevc|4k|raw|1080p|720p|50fps|h265|fr|fra|france|ar|ara|arab|arabic)\b/g, "")
            .replace(/[^a-z0-9]/g, "")
            .trim()
    }

    function isBeinChannel(channel) {
        if (!channel) return false
        const name = String(channel.name || "").toLowerCase()
        const group = String(channel.group || "").toLowerCase()
        const genre = String(channel.genre || "").toLowerCase()
        return (
            /(?:^|[\s\[\]()_:\-\|\/])bein(?:$|[\s\[\]()_:\-\|\/])/i.test(name) ||
            name.includes("bein sport") ||
            name.includes("bein_sport") ||
            name.includes("beinsport") ||
            group.includes("bein") ||
            genre.includes("bein")
        )
    }

    function channelLanguagePriority(channel) {
        const name = String(channel.name || "").toLowerCase()
        const group = String(channel.group || "").toLowerCase()
        const text = `${name} ${group}`

        const isFrench =
            /(?:^|[\s\[\]()_:\-\|\/])(?:fr|france|french|francais|français|max)(?:$|[\s\[\]()_:\-\|\/])/i.test(text) ||
            (/bein sports \d/.test(text) && !text.includes("(ar)") && !text.includes("[ar]"))
        const isArabic =
            /[\u0600-\u06ff]/.test(text) ||
            /(?:^|[\s\[\]()_:\-\|\/])(?:ar|arabe|arabic|nilesat|mena|qatar)(?:$|[\s\[\]()_:\-\|\/])/i.test(text) ||
            text.includes("(ar)") || text.includes("[ar]")

        if (isFrench && !isArabic) return 0
        if (isArabic) return 1
        return 2
    }

    function naturalSort(a, b) {
        return String(a || "").localeCompare(String(b || ""), "fr", { numeric: true, sensitivity: "base" })
    }

    const PERMANENT_BEIN_CONFIGS = [
        // beIN SPORTS Bouquet Yacine TV (Flux directs Anti-Coupure HLS Multi-Qualités)
        { id: "yacine_bein_1", name: "beIN SPORTS 1 HD", url: "/yacine/play.m3u8?id=6217599430189993723&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_2", name: "beIN SPORTS 2 HD", url: "/yacine/play.m3u8?id=6217599430191304124&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_3", name: "beIN SPORTS 3 HD", url: "/yacine/play.m3u8?id=6217599430187956457&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_4", name: "beIN SPORTS 4 HD", url: "/yacine/play.m3u8?id=6217599430189092794&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_5", name: "beIN SPORTS 5 HD", url: "/yacine/play.m3u8?id=6217599430194016479&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_6", name: "beIN SPORTS 6 HD", url: "/yacine/play.m3u8?id=6217599430194998784&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_7", name: "beIN SPORTS 7 HD", url: "/yacine/play.m3u8?id=6217599430192788662&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_8", name: "beIN SPORTS 8 HD", url: "/yacine/play.m3u8?id=6217599430193374805&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_9", name: "beIN SPORTS 9 HD", url: "/yacine/play.m3u8?id=6217599430198106168&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_news", name: "beIN SPORTS NEWS HD", url: "/yacine/play.m3u8?id=6217599430202494892&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_xtra1", name: "beIN SPORTS XTRA 1", url: "/yacine/play.m3u8?id=6217599430220838088&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_xtra2", name: "beIN SPORTS XTRA 2", url: "/yacine/play.m3u8?id=6217599430217533349&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_xtra3", name: "beIN SPORTS XTRA 3", url: "/yacine/play.m3u8?id=6217599430218118150&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_3fr", name: "beIN SPORTS 3 FR (Yacine Multi)", url: "/yacine/play.m3u8?id=6217599430197030425&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "yacine_bein_en1", name: "beIN SPORTS English 1 HD", url: "/yacine/play.m3u8?id=6217599430283631330&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        { id: "yacine_bein_en2", name: "beIN SPORTS English 2 HD", url: "/yacine/play.m3u8?id=6217599430280562883&q=1080p", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/qatar/bein-sports-1.png" },
        // French beIN bouquet
        { id: "perm_bein_fr_1", name: "beIN SPORTS 1 HD (FR)", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_2", name: "beIN SPORTS 2 HD (FR)", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_3", name: "beIN SPORTS 3 HD (FR)", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max4", name: "beIN SPORTS MAX 4", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max5", name: "beIN SPORTS MAX 5", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max6", name: "beIN SPORTS MAX 6", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max7", name: "beIN SPORTS MAX 7", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max8", name: "beIN SPORTS MAX 8", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max9", name: "beIN SPORTS MAX 9", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
        { id: "perm_bein_fr_max10", name: "beIN SPORTS MAX 10", group: "⚽ beIN SPORTS (Yacine TV)", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/bein-sports-1-fr.png" },
    ]

    function getPermanentBeinChannels(listId) {
        return PERMANENT_BEIN_CONFIGS.map((cfg) =>
            Object.assign({}, cfg, {
                listId: listId || (state.lists[0] && state.lists[0].id) || "",
                mediaType: "live",
                isPermanent: true,
            })
        )
    }

    function getBeinChannelsList(scope) {
        const activeId = scope || state.tvSource || (state.lists[0] && state.lists[0].id)
        const serverChans = allChannels().filter((channel) => {
            if (activeId && channel.listId !== activeId) return false
            if (!matchesMedia(channel, "live")) return false
            return isBeinChannel(channel)
        })

        const permChans = getPermanentBeinChannels(activeId)
        const merged = []
        const seenNorm = Object.create(null)

        // 1. Add permanent anti-coupure Yacine channels
        permChans.forEach((perm) => {
            const norm = normalizeChannelName(perm.name)
            if (norm) seenNorm[norm] = true
            merged.push(perm)
        })

        // 2. Add server beIN channels
        serverChans.forEach((ch) => {
            const norm = normalizeChannelName(ch.name)
            if (!norm || !seenNorm[norm]) {
                seenNorm[norm] = true
                merged.push(ch)
            }
        })

        merged.sort((a, b) => {
            const pA = channelLanguagePriority(a)
            const pB = channelLanguagePriority(b)
            if (pA !== pB) return pA - pB
            return naturalSort(a.name, b.name)
        })

        return merged
    }

    function sources() {
        const counts = { all: state.lists.length, m3u: 0, xtream: 0, stalker: 0 }
        state.lists.forEach((list) => {
            const kind = listKind(list)
            counts[kind] = (counts[kind] || 0) + 1
        })
        return {
            items:
                state.filter === "all"
                    ? state.lists
                    : state.lists.filter((list) => {
                        return listKind(list) === state.filter
                    }),
            types: TYPES.map((type) => {
                return {
                    id: type.id,
                    label: type.label,
                    count: counts[type.id] || 0,
                    selected: type.id === state.filter,
                }
            }),
        }
    }

    function setFilter(id) {
        state.filter = id
        write(KEYS.filter, id)
        set({ filter: id })
        focus("sources")
    }

    function allChannels() {
        if (state.flat) return state.flat
        const flat = []
        state.lists.forEach((list) => {
            const channels = state.channels[list.id]
            if (!channels) return
            for (let i = 0; i < channels.length; i++) {
                channels[i].listId = list.id
                if (!isMuted(list, channels[i].group || "Otros")) flat.push(channels[i])
            }
        })
        state.flat = flat
        return flat
    }

    function invalidate() {
        state.flat = null
    }

    function channelByUrl(url, listId) {
        const pools = [channelsOf(listId), state.favorites, state.recent]
        for (let p = 0; p < pools.length; p++) {
            for (let i = 0; i < pools[p].length; i++) {
                if (pools[p][i].url === url) return pools[p][i]
            }
        }
        return null
    }

    function startLoadEntry(key, name) {
        state.loadProgress[key] = {
            since: Date.now(),
            at: 0,
            lastCount: -1,
            label: "Connecting",
            percent: 8,
            name,
        }
    }

    // A list that was imported before is not downloaded again: it resyncs, and the
    // notice says so. The first time it really is a download.
    function progressOf(listId, update, list, catalogListId) {
        if (list && list.imported && update.label === "Downloading") update.label = "Syncing"
        if (Array.isArray(update.items) && update.items.length) {
            const entry = state.loadProgress[listId]
            if (entry) {
                mergeCatalogBatch(catalogListId || listId, update.items, listId, update.mediaType)
                chooseDefaultCategory(update.mediaType)
                if (state.screen === "tv" && state.mediaType === update.mediaType) hideNotice()
                emit()
            }
        }
        return progressOfEntry(listId, update)
    }

    function mergeCatalogBatch(targetListId, items, listId, mediaType) {
        const entry = state.loadProgress[listId]
        entry.catalogPreviewTypes = entry.catalogPreviewTypes || Object.create(null)
        entry.catalogKeysByType = entry.catalogKeysByType || Object.create(null)
        const current = state.channels[targetListId] || []
        let channels = current
        if (!entry.catalogPreviewTypes[mediaType]) {
            channels = current.filter((channel) => channel.mediaType !== mediaType)
            state.channels[targetListId] = channels
            state.groups[targetListId] = groupNames(channels)
            const initial = Object.create(null)
            channels.forEach((channel) => {
                initial[
                    `${channel.mediaType || "live"}|${channel.streamId || channel.url || channel.cmd || channel.name}`
                ] = true
            })
            entry.catalogKeysByType[mediaType] = initial
            entry.catalogPreviewTypes[mediaType] = true
        }
        const seen = entry.catalogKeysByType[mediaType]
        const groupSet = Object.create(null)
            ; (state.groups[targetListId] || []).forEach((group) => (groupSet[group] = true))
        items.forEach((channel) => {
            const key = `${channel.mediaType || "live"}|${channel.streamId || channel.url || channel.cmd || channel.name}`
            if (seen[key]) return
            seen[key] = true
            channels.push(Object.assign({ listId }, channel))
            const group = channel.group || "Otros"
            if (!groupSet[group]) {
                groupSet[group] = true
                state.groups[targetListId].push(group)
            }
        })
        state.groups[targetListId].sort(compareCategories)
        invalidate()
    }

    function chooseDefaultCategory(mediaType) {
        if (state.screen !== "tv" || state.mediaType !== mediaType || state.categoryManual) return
        const rows = tvCategories().rows
        const regular = rows.find((r) => !r.special) || rows[0]
        if (regular && state.catName !== regular.name) {
            state.catName = regular.name
            focus("tvChannels")
        }
    }

    function progressOfEntry(listId, update) {
        const entry = state.loadProgress[listId] || {
            since: Date.now(),
            at: 0,
            lastCount: -1,
            label: "Connecting",
            percent: 8,
        }
        if (update.mediaType) entry.mediaType = update.mediaType
        entry.label = update.label || entry.label
        const phasePercent = {
            Connecting: 8,
            "Fetching categories": 28,
            Downloading: 46,
            Syncing: 58,
            Preparing: 88,
            Reading: 72,
        }
        if (phasePercent[entry.label] !== undefined) entry.percent = phasePercent[entry.label]
        if (update.count !== undefined) entry.count = update.count
        if (update.count !== undefined && entry.percent < 84)
            entry.percent = Math.min(84, entry.percent + 1)

        const now = Date.now()
        const jumped = entry.count !== undefined && entry.count - entry.lastCount >= 500
        const stale = now - entry.at >= PROGRESS_MS
        entry.phase = update.label

        if (update.count !== undefined && !stale && !jumped) {
            state.loadProgress[listId] = entry
            return
        }
        entry.at = now
        if (entry.count !== undefined) entry.lastCount = entry.count
        state.loadProgress[listId] = entry
        emit()
    }

    function elapsedOf(entry) {
        return Math.max(0, Math.round((Date.now() - entry.since) / 1000))
    }

    function loadingRows(mediaType) {
        return Object.keys(state.loadProgress)
            .filter((key) => {
                const entry = state.loadProgress[key]
                return !mediaType || !entry.mediaType || entry.mediaType === mediaType
            })
            .map((key) => {
                const entry = state.loadProgress[key]
                return {
                    key,
                    name: entry.name || "Fuente",
                    label: entry.label,
                    count: entry.count,
                    percent: entry.percent || 8,
                    mediaType: entry.mediaType,
                }
            })
    }

    function showNotice(eyebrow, title) {
        state.loading = { eyebrow, title, since: Date.now() }
        noticeTick()
    }

    function hideNotice() {
        if (!state.loading) return
        state.loading = null
        noticeTick()
    }

    function hasMediaChannels(listIds, mediaType) {
        return listIds.some((listId) =>
            (state.channels[listId] || []).some((channel) => channel.mediaType === mediaType),
        )
    }

    function storeChannels(listId, channels) {
        state.channels[listId] = channels
        state.groups[listId] = groupNames(channels)
        invalidate()
    }

    function hasIndexedDB() {
        try {
            return (
                typeof window !== "undefined" &&
                typeof window.indexedDB !== "undefined" &&
                !!window.indexedDB
            )
        } catch {
            return false
        }
    }

    function openCatalogCache() {
        if (!hasIndexedDB()) return Promise.reject(new Error("IndexedDB is unavailable"))
        if (catalogDbPromise) return catalogDbPromise
        catalogDbPromise = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(CATALOG_CACHE_NAME, CATALOG_CACHE_VERSION)
            request.onupgradeneeded = function () {
                const db = request.result
                if (!db.objectStoreNames.contains("catalogs"))
                    db.createObjectStore("catalogs", { keyPath: "key" })
            }
            request.onsuccess = function () {
                resolve(request.result)
            }
            request.onerror = function () {
                reject(request.error || new Error("Could not open the catalog cache"))
            }
        }).catch((error) => {
            catalogDbPromise = null
            throw error
        })
        return catalogDbPromise
    }

    function readCachedCatalog(key) {
        return openCatalogCache().then((db) => {
            return new Promise((resolve, reject) => {
                const request = db
                    .transaction("catalogs", "readonly")
                    .objectStore("catalogs")
                    .get(key)
                request.onsuccess = function () {
                    resolve(request.result || null)
                }
                request.onerror = function () {
                    reject(request.error || new Error("Could not read the catalog cache"))
                }
            })
        })
    }

    function writeCachedCatalog(key, channels) {
        return openCatalogCache().then((db) => {
            return new Promise((resolve) => {
                try {
                    const transaction = db.transaction("catalogs", "readwrite")
                    transaction.objectStore("catalogs").put({
                        key,
                        savedAt: Date.now(),
                        channels,
                    })
                    transaction.oncomplete = resolve
                    transaction.onerror = function (e) {
                        warnCatalogCache(e)
                        resolve()
                    }
                    transaction.onabort = function (e) {
                        warnCatalogCache(e)
                        resolve()
                    }
                } catch (e) {
                    warnCatalogCache(e)
                    resolve()
                }
            })
        }).catch((err) => {
            warnCatalogCache(err)
        })
    }

    function deleteCachedCatalogs(listId) {
        if (!hasIndexedDB()) return Promise.resolve()
        return openCatalogCache().then((db) => {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction("catalogs", "readwrite")
                const store = transaction.objectStore("catalogs")
                    ;["live", "movie", "series"].forEach((type) => store.delete(`${listId}:${type}`))
                transaction.oncomplete = resolve
                transaction.onerror = function () {
                    reject(transaction.error || new Error("Could not clear the catalog cache"))
                }
                transaction.onabort = function () {
                    reject(transaction.error || new Error("Catalog cache clear was aborted"))
                }
            })
        })
    }

    function warnCatalogCache(error) {
        if (catalogCacheWarningShown) return
        catalogCacheWarningShown = true
        console.warn("Catalog cache is unavailable; loading from the server:", error)
    }

    function cachedMediaChannels(listId, mediaType, channels) {
        const current = state.channels[listId] || []
        const retained = current.filter((channel) => channel.mediaType !== mediaType)
        const combined = retained.concat(
            channels.map((channel) => Object.assign({ listId }, channel)),
        )
        storeChannels(listId, combined)
        return combined
    }

    function markMediaLoaded(listId, mediaType) {
        state.loadedMedia[listId] = state.loadedMedia[listId] || {}
        if (mediaType) state.loadedMedia[listId][mediaType] = true
        else {
            state.loadedMedia[listId].all = true
            state.loadedMedia[listId].live = true
            state.loadedMedia[listId].movie = true
            state.loadedMedia[listId].series = true
        }
    }

    function requestedMediaType(list, mediaType) {
        if (mediaType === "all") return null
        if (mediaType) return mediaType
        return listKind(list) === "stalker" || listKind(list) === "xtream" ? "live" : null
    }

    function ensureMedia(listId, mediaType) {
        const loaded = state.loadedMedia[listId]
        if (loaded && (loaded.all || loaded[mediaType]))
            return Promise.resolve(state.channels[listId] || [])
        const requestKey = `${listId}:${mediaType}`
        if (state.pendingMedia[requestKey]) return state.pendingMedia[requestKey]

        const list = listById(listId)
        if (!list) return Promise.reject(new Error("That source is gone"))

        const remote = listKind(list) === "stalker" || listKind(list) === "xtream"

        function loadFromServer() {
            startLoadEntry(requestKey, list.name)
            emit()
            const promise = App.api
                .load(
                    list,
                    (update) => {
                        progressOf(requestKey, update, list, listId)
                    },
                    mediaType,
                )
                .then((channels) => {
                    list.imported = true
                    write(KEYS.lists, state.lists)
                    const current = state.channels[listId] || []
                    const combined = remote
                        ? current
                            .filter((channel) => channel.mediaType !== mediaType)
                            .concat(channels)
                        : channels
                    const unique = []
                    const seen = Object.create(null)
                    combined.forEach((channel) => {
                        const key = `${channel.mediaType || "live"}|${channel.streamId || channel.url || channel.cmd || channel.name}`
                        if (seen[key]) return
                        seen[key] = true
                        unique.push(channel)
                    })
                    storeChannels(listId, unique)
                    chooseDefaultCategory(mediaType)
                    if (remote) {
                        markMediaLoaded(listId, mediaType)
                        if (hasIndexedDB())
                            writeCachedCatalog(requestKey, channels).catch(warnCatalogCache)
                    } else markMediaLoaded(listId)
                    delete state.pendingMedia[requestKey]
                    delete state.loadProgress[requestKey]
                    emit()
                    return unique
                })
                .catch((error) => {
                    delete state.pendingMedia[requestKey]
                    delete state.loadProgress[requestKey]
                    emit()
                    throw error
                })
            state.pendingMedia[requestKey] = promise
            return promise
        }

        if (!remote || !hasIndexedDB()) return loadFromServer()

        const cached = readCachedCatalog(requestKey)
            .catch((error) => {
                warnCatalogCache(error)
                return null
            })
            .then((entry) => {
                const hasCache = entry && Array.isArray(entry.channels)
                if (hasCache) {
                    const channels = cachedMediaChannels(listId, mediaType, entry.channels)
                    emit()
                    const age = Date.now() - Number(entry.savedAt)
                    if (age >= 0 && age < CATALOG_CACHE_TTL) {
                        markMediaLoaded(listId, mediaType)
                        return channels
                    }

                    const refresh = loadFromServer()
                    refresh.catch((error) => {
                        const source = listById(listId)
                        notify(
                            `${source ? source.name : "Playlist"} · ${mediaType}: ${error.message}`,
                        )
                    })
                    return channels
                }
                return loadFromServer()
            })
        state.pendingMedia[requestKey] = cached
        cached.then(
            () => {
                if (state.pendingMedia[requestKey] === cached) delete state.pendingMedia[requestKey]
            },
            () => {
                if (state.pendingMedia[requestKey] === cached) delete state.pendingMedia[requestKey]
            },
        )
        return cached
    }

    function ensureChannels(listId) {
        return ensureMedia(listId, "live")
    }

    function preloadCatalog(listId) {
        const list = listById(listId)
        if (!list) return Promise.resolve()
        const isRemote = listKind(list) === "stalker" || listKind(list) === "xtream"
        if (isRemote) {
            return App.api
                .loadCategories(list, "movie")
                .then((cats) => {
                    state.categories[listId] = state.categories[listId] || {}
                    state.categories[listId].movie = cats
                    write("ts.categories", state.categories)
                    return App.api.loadCategories(list, "series")
                })
                .then((cats) => {
                    state.categories[listId] = state.categories[listId] || {}
                    state.categories[listId].series = cats
                    write("ts.categories", state.categories)
                })
                .catch((err) => console.warn("Could not pre-fetch VOD/Series categories:", err))
        }
        return Promise.resolve()
    }

    function ensureCategories(listId, mediaType) {
        state.categories[listId] = state.categories[listId] || {}
        if (state.categories[listId][mediaType] && state.categories[listId][mediaType].length) {
            return Promise.resolve(state.categories[listId][mediaType])
        }
        const list = listById(listId)
        if (!list) return Promise.reject(new Error("Source introuvable"))
        showNotice(
            "Catégories",
            `Chargement des catégories ${mediaType === "movie" ? "Films" : mediaType === "series" ? "Séries" : "Live"}…`,
        )
        emit()
        return App.api
            .loadCategories(list, mediaType)
            .then((categories) => {
                state.categories[listId][mediaType] = categories
                state.groups[listId] = state.groups[listId] || []
                categories.forEach((c) => {
                    if (state.groups[listId].indexOf(c.name) === -1) state.groups[listId].push(c.name)
                })
                markMediaLoaded(listId, mediaType)
                write("ts.categories", state.categories)
                hideNotice()
                emit()
                return categories
            })
            .catch((err) => {
                hideNotice()
                emit()
                throw err
            })
    }

    function ensureCategoryLoaded(categoryName) {
        if (categoryName === "⭐ Favoris" || categoryName === "🕒 Récents") {
            return Promise.resolve([])
        }

        if (categoryName === "⚽ beIN SPORTS" || categoryName === "beIN SPORTS" || categoryName === "__bein__") {
            const list = state.tvSource ? listById(state.tvSource) : state.lists[0]
            if (!list) return Promise.resolve(getBeinChannelsList())
            const listCats = state.categories[list.id] && state.categories[list.id].live
            if (!listCats || !listCats.length) return Promise.resolve(getBeinChannelsList(list.id))

            const beinCats = listCats.filter((c) => /bein/i.test(c.name))
            if (!beinCats.length) return Promise.resolve(getBeinChannelsList(list.id))

            state.loadedCategories[list.id] = state.loadedCategories[list.id] || {}
            const unloaded = beinCats.filter((cat) => !state.loadedCategories[list.id][`live:${cat.id}`])
            if (!unloaded.length) {
                return Promise.resolve(getBeinChannelsList(list.id))
            }

            state.categoryLoading = categoryName
            emit()

            function appendBeinLoaded(newItems) {
                if (!newItems || !newItems.length) return
                const current = state.channels[list.id] || []
                const combined = current.slice()
                const seen = Object.create(null)
                combined.forEach((c) => {
                    seen[`${c.mediaType || "live"}|${c.streamId || c.url || c.cmd || c.name}`] = true
                })
                let addedCount = 0
                newItems.forEach((item) => {
                    const key = `${item.mediaType || "live"}|${item.streamId || item.url || item.cmd || item.name}`
                    if (!seen[key]) {
                        seen[key] = true
                        combined.push(Object.assign({ listId: list.id }, item))
                        addedCount++
                    }
                })
                if (addedCount > 0) {
                    state.channels[list.id] = combined
                    invalidate()
                    if (state.screen === "tv") emit()
                }
            }

            const tasks = unloaded.map((cObj) => {
                const cKey = `live:${cObj.id}`
                return App.api
                    .loadCategoryChannels(list, cObj.id, "live", cObj.name)
                    .then((items) => {
                        state.loadedCategories[list.id][cKey] = true
                        appendBeinLoaded(items)
                        return items
                    })
                    .catch((err) => {
                        console.warn("Could not load beIN category:", cObj.name, err)
                        return []
                    })
            })

            return Promise.all(tasks).finally(() => {
                state.categoryLoading = false
                emit()
            })
        }

        const list = state.tvSource ? listById(state.tvSource) : state.lists[0]
        if (!list) return Promise.resolve([])
        const listCats = state.categories[list.id] && state.categories[list.id][state.mediaType]
        if (!listCats || !listCats.length) return Promise.resolve([])
        const catObj = listCats.find((c) => c.name === categoryName)
        if (!catObj) return Promise.resolve([])

        const catKey = `${state.mediaType}:${catObj.id}`
        state.loadedCategories[list.id] = state.loadedCategories[list.id] || {}

        // Instant cache hit (0 ms)
        if (state.loadedCategories[list.id][catKey]) {
            const currentChans = (state.channels[list.id] || []).filter(
                (c) => matchesMedia(c, state.mediaType) && (c.group || "Otros") === categoryName,
            )
            return Promise.resolve(currentChans)
        }

        // LRU RAM Protection: keep at most 6 categories in memory to protect Samsung TV heap
        state.recentCatKeys = state.recentCatKeys || []
        state.recentCatKeys = state.recentCatKeys.filter((k) => k !== catKey)
        state.recentCatKeys.push(catKey)

        const MAX_CACHED_CATS = 6
        if (state.recentCatKeys.length > MAX_CACHED_CATS) {
            const oldestKey = state.recentCatKeys.shift()
            if (state.loadedCategories[list.id]) delete state.loadedCategories[list.id][oldestKey]
            const oldCatId = oldestKey.split(":")[1]
            state.channels[list.id] = (state.channels[list.id] || []).filter(
                (c) => c.categoryId !== oldCatId,
            )
            invalidate()
        }

        state.categoryLoading = categoryName
        emit()

        function appendChannels(newItems) {
            if (!newItems || !newItems.length) return
            const current = state.channels[list.id] || []
            const combined = current.slice()
            const seen = Object.create(null)
            combined.forEach((c) => {
                seen[`${c.mediaType || "live"}|${c.streamId || c.url || c.cmd || c.name}`] = true
            })
            let addedCount = 0
            newItems.forEach((item) => {
                const key = `${item.mediaType || "live"}|${item.streamId || item.url || item.cmd || item.name}`
                if (!seen[key]) {
                    seen[key] = true
                    combined.push(Object.assign({ listId: list.id }, item))
                    addedCount++
                }
            })
            if (addedCount > 0) {
                state.channels[list.id] = combined
                invalidate()
                if (state.screen === "tv" && state.catName === categoryName) {
                    emit()
                }
            }
        }

        return App.api
            .loadCategoryChannels(
                list,
                catObj.id,
                state.mediaType,
                catObj.name,
                (progressUpdate) => {
                    if (progressUpdate && progressUpdate.items) {
                        appendChannels(progressUpdate.items)
                    }
                },
            )
            .then((result) => {
                state.loadedCategories[list.id][catKey] = true
                state.categoryLoading = false

                const items = Array.isArray(result) ? result : (result && result.items) || []
                appendChannels(items)

                const catChans = (state.channels[list.id] || []).filter(
                    (c) => matchesMedia(c, state.mediaType) && (c.group || "Otros") === categoryName,
                )
                if (state.screen === "tv" && state.mediaType === "live" && !state.preview && catChans.length > 0) {
                    selectPreview(catChans[0])
                }
                emit()
                return catChans
            })
            .catch((error) => {
                state.categoryLoading = false
                emit()
                notify(`Erreur lors du chargement : ${error.message}`)
                throw error
            })
    }

    function buildSource(type, fields) {
        fields = fields || {}
        const name = (fields.name || "").trim()
        const url = (fields.url || "").trim()
        const origin = (fields.origin || "").trim()

        if (type === "auto") {
            const guess = App.api.parseAuto(fields.text, name)
            if (guess.error) return guess
            return { list: decorate(guess.list) }
        }

        if (type === "raw") {
            if (!/(^#EXTM3U)|(#EXTINF)/i.test(fields.text || "")) {
                return { error: "That text does not look like an M3U playlist" }
            }
            return {
                list: decorate({
                    kind: "m3u",
                    source: "text",
                    text: fields.text,
                    name: name || "Pasted list",
                }),
            }
        }

        if (type === "file") {
            if (!fields.text) return { error: "Choose an .m3u file first" }
            return {
                list: decorate({
                    kind: "m3u",
                    source: "text",
                    text: fields.text,
                    name: name || fields.fileName || "Local list",
                }),
            }
        }

        if (type === "xtream") {
            if (!/^https?:\/\//i.test(origin))
                return { error: "The server must start with http:// or https://" }
            if (!fields.user || !fields.pass)
                return { error: "An Xtream portal needs a username and password" }
            return {
                list: decorate({
                    kind: "xtream",
                    source: "creds",
                    origin: origin.replace(/\/+$/, ""),
                    user: fields.user,
                    pass: fields.pass,
                    name: name || App.api.hostOf(origin),
                }),
            }
        }

        if (type === "stalker") {
            if (!/^https?:\/\//i.test(origin) && !/^https?:\/\//i.test(url))
                return { error: "The portal must start with http:// or https://" }
            const mac = (fields.mac || "").trim().toUpperCase()
            if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac))
                return { error: "The MAC must look like 00:1A:79:12:34:56" }
            return {
                list: decorate({
                    kind: "stalker",
                    source: "mac",
                    origin: (origin || url).replace(/\/+$/, ""),
                    mac,
                    name: name || App.api.hostOf(origin || url),
                }),
            }
        }

        if (!/^https?:\/\/.+/i.test(url))
            return { error: "The address must start with http:// or https://" }
        const inline = App.api.parseXtreamUrl(url)
        if (inline) {
            return {
                list: decorate({
                    kind: "xtream",
                    source: "url",
                    url,
                    origin: inline.origin,
                    user: inline.user,
                    pass: inline.pass,
                    name: name || App.api.hostOf(url),
                }),
            }
        }
        return {
            list: decorate({ kind: "m3u", source: "url", url, name: name || deriveName(url) }),
        }
    }

    function decorate(list) {
        list.id = list.id || `l${Date.now()}${Math.floor(Math.random() * 1000)}`
        if (!list.url && list.source === "text") list.url = "texto"
        if (!list.url) list.url = list.origin || ""
        return list
    }

    function deriveName(url) {
        const host = App.api.hostOf(url)
        const file = (url.match(/\/([^\/?#]+?)(?:\.m3u8?)?(?:[?#]|$)/i) || [])[1]
        return file && !/\.(php|aspx?|cgi|json)$/i.test(file) ? file : host
    }

    function addList(list, mediaType) {
        const requestMediaType = requestedMediaType(list, mediaType) || "live"
        showNotice("Vérification", list.name)
        startLoadEntry("draft", list.name)
        emit()

        const isRemote = listKind(list) === "stalker" || listKind(list) === "xtream"
        if (isRemote) {
            return App.api
                .checkServer(list)
                .then(() => {
                    showNotice("Catégories", `Chargement des catégories pour ${list.name}…`)
                    emit()
                    return App.api.loadCategories(list, requestMediaType)
                })
                .then((categories) => {
                    list.imported = true
                    state.categories[list.id] = state.categories[list.id] || {}
                    state.categories[list.id][requestMediaType] = categories
                    state.channels[list.id] = []
                    state.groups[list.id] = categories.map((c) => c.name)
                    markMediaLoaded(list.id, requestMediaType)
                    state.lists = state.lists.concat([list])
                    invalidate()
                    write(KEYS.lists, state.lists)
                    write("ts.categories", state.categories)
                    delete state.loadProgress.draft
                    hideNotice()
                    notify(`Ajouté : ${formatCount(categories.length)} catégories prêtes`)
                    if (!list.firebaseManaged) {
                        goHome()
                    }
                    return []
                })
                .catch((error) => {
                    delete state.loadProgress.draft
                    hideNotice()
                    emit()
                    throw error
                })
        }

        return App.api
            .load(
                list,
                (update) => {
                    progressOf("draft", update, list)
                },
                requestMediaType,
            )
            .then((channels) => {
                list.imported = true
                storeChannels(list.id, channels)
                markMediaLoaded(list.id, requestMediaType)
                state.lists = state.lists.concat([list])
                write(KEYS.lists, state.lists)
                delete state.loadProgress.draft
                hideNotice()
                notify(`Added: ${formatCount(channels.length)} channels`)
                goHome()
                return channels
            })
            .catch((error) => {
                delete state.loadProgress.draft
                hideNotice()
                emit()
                throw error
            })
    }

    function updateList(listId, fields, mediaType) {
        const list = listById(listId)
        if (!list) return Promise.reject(new Error("That source is gone"))

        const draft = {
            id: list.id,
            kind: list.kind,
            source: list.source,
            text: list.text,
            muted: list.muted,
            mac: list.mac,
        }
        const built = buildSource(fields.type || "url", {
            url: fields.url || list.url,
            origin: fields.origin || list.origin,
            user: fields.user,
            pass: fields.pass,
            mac: fields.mac,
            text: fields.text || list.text,
            name: fields.name,
        })
        if (built.error) return Promise.reject(new Error(built.error))
        if (list.imported) draft.imported = true
        if (list.firebaseManaged) draft.firebaseManaged = true
        for (const key in built.list) {
            if (built.list[key] !== undefined) draft[key] = built.list[key]
        }
        draft.id = list.id
        const requestMediaType = requestedMediaType(draft, mediaType) || "live"

        showNotice("Vérification", draft.name || list.name)
        startLoadEntry("draft", draft.name || list.name)
        emit()

        const isRemote = listKind(draft) === "stalker" || listKind(draft) === "xtream"
        if (isRemote) {
            return App.api
                .checkServer(draft)
                .then(() => {
                    showNotice("Catégories", `Mise à jour des catégories pour ${draft.name}…`)
                    emit()
                    return App.api.loadCategories(draft, requestMediaType)
                })
                .then((categories) => {
                    draft.imported = true
                    state.categories[draft.id] = state.categories[draft.id] || {}
                    state.categories[draft.id][requestMediaType] = categories
                    state.channels[draft.id] = []
                    state.groups[draft.id] = categories.map((c) => c.name)
                    state.loadedCategories[draft.id] = {}
                    state.loadedMedia[draft.id] = {}
                    markMediaLoaded(draft.id, requestMediaType)
                    deleteCachedCatalogs(draft.id).catch(warnCatalogCache)
                    state.lists = state.lists.map((item) => (item.id === list.id ? draft : item))
                    invalidate()
                    write(KEYS.lists, state.lists)
                    write("ts.categories", state.categories)
                    delete state.loadProgress.draft
                    hideNotice()
                    notify(`Mis à jour : ${formatCount(categories.length)} catégories prêtes`)
                    if (!list.firebaseManaged && !draft.firebaseManaged) {
                        goHome()
                    }
                    return []
                })
                .catch((error) => {
                    delete state.loadProgress.draft
                    hideNotice()
                    emit()
                    throw error
                })
        }

        return App.api
            .load(
                draft,
                (update) => {
                    progressOf("draft", update, list)
                },
                requestMediaType,
            )
            .then((channels) => {
                draft.imported = true
                storeChannels(list.id, channels)
                state.loadedMedia[listId] = {}
                markMediaLoaded(listId, requestMediaType)
                deleteCachedCatalogs(listId).catch(warnCatalogCache)
                state.lists = state.lists.map((item) => {
                    return item.id === list.id ? draft : item
                })
                write(KEYS.lists, state.lists)
                delete state.loadProgress.draft
                hideNotice()
                notify(`Updated: ${formatCount(channels.length)} channels`)
                goHome()
                return channels
            })
            .catch((error) => {
                delete state.loadProgress.draft
                hideNotice()
                emit()
                throw error
            })
    }

    function removeList(listId) {
        state.lists = state.lists.filter((list) => {
            return list.id !== listId
        })
        deleteCachedCatalogs(listId).catch(warnCatalogCache)
        delete state.channels[listId]
        delete state.groups[listId]
        delete state.pending[listId]
        delete state.loadedMedia[listId]
        write(KEYS.lists, state.lists)
        invalidate()
        emit()
    }

    function loadWithNotice(listIds, title, mediaType) {
        showNotice("Loading", title)
        emit()

        function maybeDismiss() {
            if (state.loading && hasMediaChannels(listIds, mediaType || "live")) {
                hideNotice()
                emit()
            }
        }

        return Promise.all(
            listIds.map((listId) => {
                return ensureMedia(listId, mediaType || "live").then(maybeDismiss, (error) => {
                    const list = listById(listId)
                    maybeDismiss()
                    notify((list ? `${list.name}: ` : "") + error.message)
                })
            }),
        ).then(() => {
            if (state.loading) {
                hideNotice()
                emit()
            }
        })
    }

    function noticeTick() {
        if (state.loading && !loadTick) {
            loadTick = setInterval(() => {
                emit()
            }, 1000)
        } else if (!state.loading && loadTick) {
            clearInterval(loadTick)
            loadTick = null
        }
    }

    function openCategories() {
        const draft = {}
        state.lists.forEach((list) => {
            draft[list.id] = (list.muted || []).slice()
        })
        set({ screen: "cats", catDraft: draft, catSearch: "" })
        focus("catSearch")
    }

    function categoriesView() {
        const needle = (state.catSearch || "").trim().toLowerCase()
        const sections = []
        let total = 0,
            selected = 0

        state.lists.forEach((list) => {
            const channels = channelsOf(list.id)
            if (!channels.length) return
            const counts = {}
            channels.forEach((channel) => {
                const group = channel.group || "Otros"
                counts[group] = (counts[group] || 0) + 1
            })
            const muted = state.catDraft ? state.catDraft[list.id] || [] : list.muted || []
            const groups = Object.keys(counts)
                .sort((a, b) => {
                    return a.localeCompare(b, "en")
                })
                .filter((group) => {
                    return !needle || group.toLowerCase().indexOf(needle) !== -1
                })
                .map((group) => {
                    const enabled = muted.indexOf(group) === -1
                    total++
                    if (enabled) selected++
                    return { name: group, count: counts[group], enabled, listId: list.id }
                })
            if (groups.length) sections.push({ list, groups })
        })

        return { sections, total, selected }
    }

    function toggleCategory(listId, group) {
        const muted = (state.catDraft[listId] || []).slice()
        const index = muted.indexOf(group)
        if (index === -1) muted.push(group)
        else muted.splice(index, 1)
        state.catDraft[listId] = muted
        emit()
    }

    function setAllCategories(enabled) {
        const draft = {}
        state.lists.forEach((list) => {
            draft[list.id] = enabled ? [] : groupsOf(list.id).slice()
        })
        set({ catDraft: draft })
    }

    function saveCategories() {
        state.lists = state.lists.map((list) => {
            const muted = state.catDraft[list.id]
            if (!muted) return list
            const copy = {}
            for (const key in list) {
                if (Object.prototype.hasOwnProperty.call(list, key)) copy[key] = list[key]
            }
            if (muted.length) copy.muted = muted.slice()
            else delete copy.muted
            return copy
        })
        write(KEYS.lists, state.lists)
        invalidate()
        state.catDraft = null
        set({ screen: "tv" })
        notify("Categories saved")
        focus("tvSearch")
    }

    function setCatSearch(value) {
        set({ catSearch: value })
    }

    function goHome() {
        if (App.player) App.player.stop()
        set({ screen: "home", selectedMovie: null, globalSearchOpen: false })
        focus("homeCards", 0, 0)
    }

    function authenticatePin(pin, action) {
        const code = String(pin || "").trim()
        if (!/^\d{4}$/.test(code)) {
            state.pinError = "Saisissez les 4 chiffres de votre code PIN."
            emit()
            return Promise.reject(new Error(state.pinError))
        }
        if (state.pinLoading || state.pinSubmitted) return Promise.resolve()
        state.pinLoading = true
        state.pinSubmitted = true
        state.pinError = ""
        state.screen = "pin"
        showNotice("Connexion sécurisée", "Vérification du code PIN")
        emit()

        if (code === "0000") {
            const demoId = "demo-source-1"
            const demoChannels = [
                { id: "demo-1", num: 1, name: "TF1 HD", group: "Généraliste", logo: "", mediaType: "live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
                { id: "demo-2", num: 2, name: "France 2 HD", group: "Généraliste", logo: "", mediaType: "live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
                { id: "demo-3", num: 3, name: "beIN Sports 1 HD", group: "Sport", logo: "", mediaType: "live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
                { id: "demo-4", num: 4, name: "Canal+ Sport", group: "Sport", logo: "", mediaType: "live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4" },
                { id: "demo-5", num: 5, name: "Interstellar (4K)", group: "Science-Fiction", logo: "", mediaType: "movie", year: "2014", rating: "8.7", plot: "Une équipe d'explorateurs voyage à travers un trou de ver dans l'espace pour assurer la survie de l'humanité.", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
                { id: "demo-6", num: 6, name: "Inception (HD)", group: "Thriller", logo: "", mediaType: "movie", year: "2010", rating: "8.8", plot: "Un voleur qui s'approprie des secrets d'entreprise grâce à une technologie de partage de rêves se voit confier la tâche inverse.", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
                { id: "demo-7", num: 7, name: "Cosmos : L'Odyssée", group: "Documentaire", logo: "", mediaType: "series", year: "2024", rating: "9.1", plot: "Exploration fascinante des mystères de l'univers et de l'espace-temps à travers plusieurs saisons.", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
            ]
            const demoSource = {
                id: demoId,
                name: "Mode Démo (Family Stream)",
                type: "m3u",
                demo: true,
                liveCount: 4,
                movieCount: 2,
                seriesCount: 1,
            }
            state.firebaseUser = { id: "demo", name: "Mode Démo VIP", status: "active" }
            state.firebaseServers = [{ id: "srv-demo", name: "Serveur Démo Premium", url: "demo://local", mac: "00:1A:79:00:00:00" }]
            state.activeServerId = "srv-demo"
            state.lists = [demoSource]
            state.channels[demoId] = demoChannels
            state.groups[demoId] = ["Généraliste", "Sport", "Science-Fiction", "Thriller", "Documentaire"]
            state.categories[demoId] = {
                live: [
                    { id: "cat-1", name: "Généraliste", count: 2 },
                    { id: "cat-2", name: "Sport", count: 2 },
                ],
                movie: [
                    { id: "cat-3", name: "Science-Fiction", count: 1 },
                    { id: "cat-4", name: "Thriller", count: 1 },
                ],
                series: [
                    { id: "cat-5", name: "Documentaire", count: 1 },
                ],
            }
            markMediaLoaded(demoId)
            markMediaLoaded(demoId, "live")
            markMediaLoaded(demoId, "movie")
            markMediaLoaded(demoId, "series")
            invalidate()
            hideNotice()
            state.pinLoading = false
            state.pinSubmitted = false
            goHome()
            notify("Connecté en Mode Démo · TV, Films & Séries prêts")
            emit()
            return Promise.resolve()
        }
        return App.firebase
            .signIn(code)
            .then((session) => {
                state.firebaseUser = session.user
                state.firebaseServers = session.servers
                state.activeServerId = session.selected.id || ""
                if (action === "servers") {
                    hideNotice()
                    state.pinLoading = false
                    set({ screen: "servers" })
                    focus("servers")
                    return { serversOnly: true }
                }
                const sourceFields = {
                    origin: session.selected.url,
                    mac: session.selected.mac,
                    name: session.selected.name || "Family Premium",
                }
                const current = state.lists.filter((list) => list.firebaseManaged)[0]
                if (current) {
                    sourceFields.id = current.id
                    return updateList(
                        current.id,
                        Object.assign({ type: "stalker" }, sourceFields),
                        "live",
                    )
                }
                const built = buildSource("stalker", sourceFields)
                if (built.error) throw new Error(built.error)
                built.list.firebaseManaged = true
                return addList(built.list, "live")
            })
            .then((result) => {
                hideNotice()
                state.pinLoading = false
                state.pinSubmitted = false
                if (result && result.serversOnly) return result
                goHome()
                const managed = state.lists.find((list) => list.firebaseManaged)
                const catCount =
                    managed && state.categories[managed.id] && state.categories[managed.id].live
                        ? state.categories[managed.id].live.length
                        : 0
                notify(
                    `Connecté avec succès · ${catCount ? formatCount(catCount) + " catégories prêtes" : "Playlist prête"}`,
                )
                emit()
                if (managed) preloadCatalog(managed.id)
                return result
            })
            .catch((error) => {
                hideNotice()
                state.pinLoading = false
                state.pinSubmitted = false
                state.pinEntry = ""
                if (state.firebaseUser) state.pinError = error.message
                else state.pinError = error.message || "Connexion impossible. Réessayez."
                emit()
                throw error
            })
    }

    function setPinEntry(value) {
        if (state.pinLoading) return
        const next = String(value || "")
            .replace(/\D/g, "")
            .slice(0, 4)
        if (next === state.pinEntry) return
        state.pinEntry = next
        if (state.pinError) state.pinError = ""
        state.pinSubmitted = false
        if (next.length === 4) focus("pinActions")
        emit()
    }

    function appendPinDigit(digit) {
        if (state.pinLoading) return
        setPinEntry(state.pinEntry + String(digit))
    }

    function backspacePin() {
        if (state.pinLoading) return
        if (state.pinEntry && state.pinEntry.length > 0) {
            setPinEntry(state.pinEntry.slice(0, -1))
        }
    }

    function clearPin() {
        if (state.pinLoading) return
        setPinEntry("")
    }

    function openServers() {
        if (!state.firebaseUser) return
        set({ screen: "servers" })
        focus("servers")
    }

    function switchServer(serverId) {
        const server = state.firebaseServers.filter((item) => item.id === serverId)[0]
        if (!server || !state.firebaseUser) return Promise.reject(new Error("Serveur introuvable"))

        // 1. Terminate current stream and stop player
        if (App.player) App.player.stop()
        state.preview = null
        state.previewRequested = false
        state.playing = null
        state.playStatus = "idle"
        state.playError = null

        // 2. Clear API link cache and Stalker session
        if (App.api && App.api.clearStalkerCache) App.api.clearStalkerCache()

        showNotice("Changement de serveur", `Connexion à ${server.name}…`)
        emit()

        const current = state.lists.filter((list) => list.firebaseManaged)[0]
        if (current) {
            delete current.token
            delete current.endpoint
            delete current.random
            delete state.categories[current.id]
            delete state.loadedCategories[current.id]
            delete state.loadedMedia[current.id]
            state.channels[current.id] = []
            state.groups[current.id] = []
            state.flat = null
            state.catName = ""
        }

        const update = server.id
            ? App.firebase
                .assignServer(
                    state.firebaseUser.id,
                    server.id,
                    state.activeServerId,
                    state.firebaseUser.name,
                )
                .catch((err) => {
                    console.warn("Could not sync server assignment to Firestore:", err)
                })
            : Promise.resolve()

        return update
            .then(() => {
                state.activeServerId = server.id
                const fields = {
                    type: "stalker",
                    origin: server.url,
                    mac: server.mac,
                    name: server.name,
                }
                const built = buildSource("stalker", fields)
                if (built.error) throw new Error(built.error)
                const draft = Object.assign({}, current || {}, built.list)
                draft.id = current ? current.id : generateId()
                draft.firebaseManaged = true
                delete draft.token
                delete draft.endpoint
                delete draft.random

                return App.api
                    .checkServer(draft)
                    .then(() => {
                        showNotice("Catégories", `Chargement des catégories pour ${draft.name}…`)
                        emit()
                        return App.api.loadCategories(draft, "live")
                    })
                    .then((categories) => {
                        draft.imported = true
                        state.categories[draft.id] = { live: categories }
                        state.channels[draft.id] = []
                        state.groups[draft.id] = categories.map((c) => c.name)
                        state.loadedCategories[draft.id] = {}
                        state.loadedMedia[draft.id] = {}
                        markMediaLoaded(draft.id, "live")
                        deleteCachedCatalogs(draft.id).catch(warnCatalogCache)

                        if (current) {
                            state.lists = state.lists.map((item) => (item.id === current.id ? draft : item))
                        } else {
                            state.lists = state.lists.concat(draft)
                        }
                        write(KEYS.lists, state.lists)
                        write("ts.categories", state.categories)

                        const firstCat = "⚽ beIN SPORTS"
                        state.mediaType = "live"
                        state.catName = firstCat
                        state.tvSource = draft.id
                        state.screen = "home"
                        hideNotice()
                        notify(`Serveur actif : ${server.name}`)
                        emit()

                        ensureCategoryLoaded(firstCat)
                        focus("homeCards", 0, 0)
                        preloadCatalog(draft.id)
                        return categories
                    })
            })
            .catch((error) => {
                hideNotice()
                notify(`Échec du changement de serveur : ${error.message}`)
                throw error
            })
    }

    function openSeries(channel) {
        const list = listById(channel.listId) || state.lists[0]
        if (!list) return
        state.viewLimit = PAGE_SIZE
        set({ screen: "episodes", currentSeries: channel, seriesEpisodes: [], selectedMovie: null, globalSearchOpen: false })
        showNotice("Chargement de la série", channel.name)
        emit()
        App.api
            .getSeriesEpisodes(list, channel)
            .then((episodes) => {
                hideNotice()
                state.seriesEpisodes = episodes
                emit()
                focus("seriesSeasons")
            })
            .catch((error) => {
                hideNotice()
                state.screen = "tv"
                notify(error.message)
                emit()
            })
    }

    function closeSeries() {
        set({ screen: "tv", currentSeries: null, seriesEpisodes: [] })
        focus("tvChannels")
    }

    function openMovieDetail(channel) {
        if (!channel) return
        set({ selectedMovie: channel })
        focus("movieDetail", 0, 0)
    }

    function closeMovieDetail() {
        set({ selectedMovie: null })
        focus("tvChannels")
    }

    function playSeriesEpisode(episode) {
        const series = state.currentSeries
        if (!series) return
        const list = listById(series.listId) || state.lists[0]
        if (!list) return
        const playEpisode = (url) => {
            const channel = Object.assign({}, series, episode, {
                name: episode.title,
                url,
                cmd: "",
                mediaType: "series-episode",
                resumeId: `${series.seriesId || series.streamId || series.name}:${episode.season || 1}:${episode.number || episode.episodeNum || episode.title}`,
            })
            play(channel, series.listId || list.id, [channel])
        }
        if (episode.url) return playEpisode(episode.url)
        showNotice("Ouverture de l’épisode", episode.title)
        emit()
        App.api
            .resolveStalkerEpisode(list, episode)
            .then((url) => {
                hideNotice()
                playEpisode(url)
            })
            .catch((error) => {
                hideNotice()
                notify(error.message)
            })
    }

    function openTv() {
        state.viewLimit = PAGE_SIZE
        set({
            screen: "tv",
            tvSource: null,
            preview: null,
            selectedMovie: null,
            mediaType: "live",
            categoryManual: false,
        })
        focus("tvCats")
        const list = state.lists[0]
        if (list) {
            const isRemote = listKind(list) === "stalker" || listKind(list) === "xtream"
            if (isRemote) {
                ensureCategories(list.id, "live").then(() => {
                    const rows = tvCategories().rows
                    const target =
                        state.catName && rows.some((r) => r.name === state.catName)
                            ? state.catName
                            : "⚽ beIN SPORTS"
                    openTvCategory(target)
                })
                return
            }
            const todo = state.lists
                .filter((l) => !(state.loadedMedia[l.id] || {}).live)
                .map((l) => l.id)
            const chooseCategory = () => {
                if (state.screen !== "tv" || state.mediaType !== "live") return
                const rows = tvCategories().rows
                const target =
                    state.catName && rows.some((r) => r.name === state.catName)
                        ? state.catName
                        : "⚽ beIN SPORTS"
                openTvCategory(target)
                emit()
            }
            if (todo.length) {
                loadWithNotice(todo, todo.length === 1 ? listById(todo[0]).name : "your sources").then(chooseCategory)
            } else {
                chooseCategory()
            }
        }
    }

    function openMedia(type) {
        state.viewLimit = PAGE_SIZE
        set({
            screen: "tv",
            tvSource: null,
            preview: null,
            selectedMovie: null,
            mediaType: type,
            catName: "",
            categoryManual: false,
        })
        focus("tvCats")
        const list = state.lists[0]
        if (list) {
            const isRemote = listKind(list) === "stalker" || listKind(list) === "xtream"
            if (isRemote) {
                ensureCategories(list.id, type).then(() => {
                    const rows = tvCategories().rows
                    const regularRows = rows.filter((r) => !r.special)
                    const fallback = (regularRows[0] && regularRows[0].name) || (rows[0] && rows[0].name) || ""
                    if (fallback) {
                        openTvCategory(fallback)
                    }
                })
                return
            }
            const todo = state.lists
                .filter((l) => !(state.loadedMedia[l.id] || {})[type])
                .map((l) => l.id)
            const chooseCategory = () => {
                if (state.screen !== "tv" || state.mediaType !== type) return
                const rows = tvCategories().rows
                const regularRows = rows.filter((r) => !r.special)
                const fallback = (regularRows[0] && regularRows[0].name) || (rows[0] && rows[0].name) || ""
                const selected = rows.findIndex((row) => row.name === state.catName)
                if (selected === -1) state.catName = fallback
                focus(
                    rows.length ? "tvChannels" : "tvCats",
                    0,
                    0,
                )
                emit()
            }
            if (todo.length) {
                loadWithNotice(
                    todo,
                    type === "movie" ? "Films" : "Séries",
                    type,
                ).then(chooseCategory)
            } else chooseCategory()
        }
    }

    function openSource(listId) {
        if (!listById(listId)) return
        state.viewLimit = PAGE_SIZE
        set({
            screen: "tv",
            tvSource: listId,
            preview: null,
            selectedMovie: null,
            mediaType: "live",
            categoryManual: false,
        })
        focus("tvSearch")
        if (!(state.loadedMedia[listId] || {}).live) {
            loadWithNotice([listId], listById(listId).name)
        }
    }

    function backToTv() {
        let catIndex = 0
        const rows = tvCategories().rows
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].name === state.catName) {
                catIndex = i
                break
            }
        }
        set({ screen: "tv", selectedMovie: null })
        const items = visibleTvCategory().items
        let channelRow = 0
        if (items && items.length && state.preview) {
            const idx = items.findIndex((item) => sameChannel(item, state.preview))
            if (idx !== -1) channelRow = idx
        }
        focus("tvChannels", channelRow, 0)
    }

    function openTvCategory(name) {
        state.categoryManual = true
        state.viewLimit = PAGE_SIZE
        set({ catName: name, selectedMovie: null })
        focus("tvChannels", 0, 0)
        ensureCategoryLoaded(name).then(() => {
            if (state.screen === "tv" && state.mediaType === "live" && !state.preview) {
                const chans = visibleTvCategory().items
                if (chans && chans.length > 0) {
                    selectPreview(chans[0])
                }
            }
        })
    }

    function selectPreview(channel) {
        if (!channel) return
        if (channel.mediaType === "series") {
            set({ preview: channel, previewRequested: false })
            openSeries(channel)
            return
        }
        if (channel.mediaType === "movie") {
            set({ preview: channel, previewRequested: false })
            openMovieDetail(channel)
            return
        }
        if (state.preview && sameChannel(state.preview, channel)) {
            if (state.preview.url) {
                play(state.preview, channel.listId, visibleTvCategory().items)
                return
            }
            state.previewRequested = true
            return
        }
        set({ preview: channel, previewRequested: false })
        if (channel.isPermanent && !channel.url && !channel.cmd) {
            const list = listById(channel.listId) || state.lists[0]
            const norm = normalizeChannelName(channel.name)
            const matched = allChannels().find(
                (c) =>
                    matchesMedia(c, "live") &&
                    isBeinChannel(c) &&
                    normalizeChannelName(c.name) === norm &&
                    (c.url || c.cmd),
            )
            if (matched) {
                const merged = Object.assign({}, channel, matched, { isPermanent: false })
                set({ preview: merged })
                if (merged.url) return
                if (listKind(list) === "stalker" && merged.cmd) {
                    App.api
                        .resolveStalkerUrl(list, merged)
                        .then((url) => {
                            if (state.preview !== merged) return
                            const resolved = Object.assign({}, merged, { url })
                            set({ preview: resolved })
                        })
                        .catch(() => {})
                }
                return
            }
        }
        if (channel.url) return
        const list = listById(channel.listId) || state.lists[0]
        if (!list || listKind(list) !== "stalker" || !channel.cmd) return
        const selected = channel
        App.api
            .resolveStalkerUrl(list, channel)
            .then((url) => {
                if (state.preview !== selected) return
                const resolved = Object.assign({}, selected, { url })
                set({ preview: resolved })
                if (state.previewRequested) {
                    state.previewRequested = false
                    play(resolved, resolved.listId, visibleTvCategory().items)
                }
            })
            .catch((error) => {
                if (state.preview === selected) notify(error.message)
            })
    }

    function openRecents() {
        set({ screen: "recents" })
        focus("recentsSearch")
    }

    function openFavorites() {
        state.search.favorites = read(`${KEYS.search}favorites`, "") || ""
        set({ screen: "favs" })
        focus("favsSearch")
    }

    function openAdd() {
        set({ screen: "add", addType: null })
        focus("addTypes")
    }

    function chooseType(type) {
        set({ addType: type })
        focus("fields")
    }

    function openEdit(listId) {
        const list = listById(listId)
        if (!list) return
        set({ screen: "edit", editId: listId })
        focus("fields")
    }

    function setSearch(scope, value) {
        state.search[scope] = value
        state.viewLimit = PAGE_SIZE
        write(KEYS.search + scope, value)
        emit()
    }

    function loadMore() {
        state.viewLimit += PAGE_SIZE
        emit()
    }

    function searchOf(scope) {
        return state.search[scope] || ""
    }

    function pushDigit(digit) {
        state.numBuffer = (state.numBuffer + digit).slice(0, 4)
        emit()
        if (digitsTimer) clearTimeout(digitsTimer)
        digitsTimer = setTimeout(() => {
            state.numBuffer = ""
            emit()
        }, DIGITS_MS)
    }

    function clearDigits() {
        if (!state.numBuffer) return false
        state.numBuffer = ""
        if (digitsTimer) clearTimeout(digitsTimer)
        emit()
        return true
    }

    function jumpTo(number) {
        const view = currentView()
        const index = parseInt(number, 10) - 1
        state.numBuffer = ""
        if (digitsTimer) clearTimeout(digitsTimer)
        if (!view || !view.items[index]) {
            notify(`No channel ${number} on this screen`)
            emit()
            return
        }
        emit()
        focus(view.zone, index, 0)
    }

    function commitDigits() {
        if (!state.numBuffer) return false
        jumpTo(state.numBuffer)
        return true
    }

    function channelKey(target) {
        if (!target) return ""
        if (typeof target === "object") {
            return target.url || `${target.streamId || target.cmd || target.name || target.id || ""}`
        }
        return String(target)
    }

    function favoriteIndex(listId, channelOrUrl) {
        const key = channelKey(channelOrUrl)
        if (!key) return -1
        for (let i = 0; i < state.favorites.length; i++) {
            const favorite = state.favorites[i]
            if (favorite.listId === listId) {
                if (channelKey(favorite) === key) return i
                if (favorite.url && favorite.url === key) return i
            }
        }
        return -1
    }

    function isFavorite(listId, channelOrUrl) {
        return favoriteIndex(listId, channelOrUrl) !== -1
    }

    function asSaved(channel, listId) {
        return {
            id: channel.id,
            listId,
            url: channel.url || "",
            cmd: channel.cmd || "",
            streamId: channel.streamId || "",
            mediaType: channel.mediaType || "live",
            categoryId: channel.categoryId || "",
            num: channel.num,
            name: channel.name,
            group: channel.group,
            logo: channel.logo,
        }
    }

    function toggleFavorite(channel, listId) {
        const index = favoriteIndex(listId, channel)
        if (index === -1) {
            state.favorites = state.favorites.concat([asSaved(channel, listId)])
            write(KEYS.favorites, state.favorites)
            emit()
            return true
        }
        state.favorites = state.favorites.slice(0, index).concat(state.favorites.slice(index + 1))
        write(KEYS.favorites, state.favorites)
        emit()
        return false
    }

    function pushRecent(channel, listId) {
        const key = channelKey(channel)
        state.recent = [asSaved(channel, listId)]
            .concat(
                state.recent.filter((item) => {
                    return channelKey(item) !== key
                }),
            )
            .slice(0, MAX_RECENT)
        write(KEYS.recent, state.recent)
    }

    function programOf(channel) {
        const entry = channel && channel.url ? state.programs[channel.url] : null
        return entry && entry.list && entry.list.length ? entry.list[0] : null
    }

    function nextOf(channel) {
        const entry = channel && channel.url ? state.programs[channel.url] : null
        return entry && entry.list && entry.list.length > 1 ? entry.list[1] : null
    }

    function loadProgramFor(channel) {
        if (!channel || !channel.url || !App.api.loadNowPlaying) return
        if (!App.api.parseLiveUrl(channel.url)) return

        const cached = state.programs[channel.url]
        if (cached && Date.now() - cached.at < PROGRAM_MS) return

        state.programs[channel.url] = { list: [], at: Date.now() }
        App.api
            .loadNowPlaying(channel.url)
            .then((list) => {
                state.programs[channel.url] = { list: list || [], at: Date.now() }
                if (state.playing && state.playing.channel.url === channel.url) {
                    state.nowProgram = programOf(channel)
                    state.nextProgram = nextOf(channel)
                    emit()
                } else if (state.preview && state.preview.url === channel.url) {
                    emit()
                }
            })
            .catch(() => { })
    }

    function programProgress(program) {
        if (!program || !program.start || !program.end) return null
        const start = Date.parse(String(program.start).replace(" ", "T"))
        const end = Date.parse(String(program.end).replace(" ", "T"))
        if (isNaN(start) || isNaN(end) || end <= start) return null
        const ratio = (Date.now() - start) / (end - start)
        return Math.max(0, Math.min(100, Math.round(ratio * 100)))
    }

    function refreshProgram() {
        if (!state.playing) return
        state.nowProgram = programOf(state.playing.channel)
        state.nextProgram = nextOf(state.playing.channel)
        const cached = state.programs[state.playing.channel.url]
        if (!cached || Date.now() - cached.at > PROGRAM_MS) loadProgramFor(state.playing.channel)
        emit()
    }

    function focusChanged(element) {
        if (!element || !element.dataset || !element.dataset.url) return
        const channel = channelByUrl(element.dataset.url, element.dataset.list)
        if (!channel) return
        loadProgramFor(channel)
    }

    function play(channel, listId, list) {
        const request = ++playbackRequest
        if (!listId && channel.listId) listId = channel.listId
        if (channel.isPermanent && !channel.url && !channel.cmd) {
            const norm = normalizeChannelName(channel.name)
            const matched = allChannels().find(
                (c) =>
                    matchesMedia(c, "live") &&
                    isBeinChannel(c) &&
                    normalizeChannelName(c.name) === norm &&
                    (c.url || c.cmd),
            )
            if (matched) {
                channel = Object.assign({}, channel, matched, { isPermanent: false })
                if (matched.listId) listId = matched.listId
            }
        }
        const list_ = listById(listId)
        const origin =
            state.screen === "player" && state.playing
                ? state.playing.origin
                : {
                    screen: state.screen,
                    zone: state.screen === "tv" ? "tvChannels" : zoneFor(state.screen),
                    row: list
                        ? Math.max(
                            0,
                            list.findIndex((item) => sameChannel(item, channel)),
                        )
                        : 0,
                    category: state.catName,
                    mediaType: state.mediaType,
                    tvSource: state.tvSource,
                }

        state.previewRequested = false
        state.playing = { channel, listId, origin, resumeAt: savedPlayback(channel, listId) }
        state.playStatus = "opening"
        state.playError = null
        state.playbackInfo = null
        state.lastProgressWrite = 0
        state.zapping = list && list.length ? list : [channel]
        state.zapIndex = Math.max(
            0,
            state.zapping.findIndex((item) => sameChannel(item, channel)),
        )
        state.nowProgram = programOf(channel)
        state.nextProgram = nextOf(channel)
        state.preview = channel
        pushRecent(channel, listId)

        if (!channel.url && channel.mediaType === "series" && listKind(list_) === "stalker") {
            set({ screen: "player" })
            focus("playerIdle")
            App.api
                .resolveStalkerSeriesUrl(list_, channel)
                .then((url) => {
                    if (
                        request !== playbackRequest ||
                        state.screen !== "player" ||
                        !state.playing ||
                        state.playing.channel !== channel
                    )
                        return
                    channel.url = url
                    play(channel, listId, list)
                })
                .catch((error) => {
                    if (request === playbackRequest) playFailed(error.message)
                })
            return
        }

        if (!channel.url && channel.cmd && listKind(list_) === "stalker") {
            set({ screen: "player" })
            focus("playerIdle")
            App.api
                .resolveStalkerUrl(list_, channel)
                .then((url) => {
                    if (
                        request !== playbackRequest ||
                        state.screen !== "player" ||
                        !state.playing ||
                        state.playing.channel !== channel
                    )
                        return
                    channel.url = url
                    play(channel, listId, list)
                })
                .catch((error) => {
                    if (request === playbackRequest) playFailed(error.message)
                })
            return
        }

        set({ screen: "player" })
        focus("playerIdle")
        if (channel.mediaType === "series" && !channel.url && listKind(list_) === "xtream") {
            App.api
                .resolveSeries(list_, channel)
                .then((url) => {
                    if (
                        request !== playbackRequest ||
                        state.screen !== "player" ||
                        !state.playing ||
                        state.playing.channel !== channel
                    )
                        return
                    channel.url = url
                    play(channel, listId, list)
                })
                .catch((error) => {
                    if (request === playbackRequest) playFailed(error.message)
                })
            return
        }
        loadProgramFor(channel)
    }

    function playStarted() {
        if (state.playStatus === "opening") set({ playStatus: "playing" })
    }

    function playFailed(message) {
        if (state.screen !== "player") return
        set({
            playStatus: "error",
            menuFocus: false,
            playError: { message: message || "Could not open the channel" },
        })
        focus("playError")
    }

    function retryPlay() {
        if (!state.playing) return
        const playing = state.playing
        set({ playStatus: "opening", playError: null })
        focus("playerIdle")
        state.playing = {
            channel: playing.channel,
            listId: playing.listId,
            origin: playing.origin,
            resumeAt: playing.resumeAt || 0,
        }
        emit()
    }

    function setMenuFocus(on) {
        if (state.menuFocus === on) return
        set({ menuFocus: on })
    }

    function openZap() {
        const rows = zapCategories()
        const playing = state.playing && state.playing.channel ? state.playing.channel.group : ""
        const current = playing || state.zapCategory || state.catName
        let exists = false
        for (let i = 0; i < rows.length; i++) if (rows[i].name === current) exists = true
        state.zapCategory = exists ? current : rows[0] ? rows[0].name : ""
        set({ zapOpen: true, menuFocus: false })
        focus("zapChannels", zapChannelIndex(), 0)
    }

    function closeZap() {
        set({ zapOpen: false, menuFocus: false })
        focus("playerIdle")
    }

    function zapCategories() {
        const activeList =
            (state.playing && state.playing.listId ? listById(state.playing.listId) : null) ||
            state.lists[0]
        const listCats =
            activeList && state.categories[activeList.id] && state.categories[activeList.id].live
        const playing =
            state.playing && state.playing.channel ? state.playing.channel.group || "Otros" : ""
        const isPlayingBein = isBeinChannel(state.playing && state.playing.channel)

        const beinList = getBeinChannelsList(activeList ? activeList.id : null)
        const beinRow = {
            name: "⚽ beIN SPORTS",
            count: beinList.length,
            selected: state.zapCategory === "⚽ beIN SPORTS",
            playing: isPlayingBein,
        }

        if (listCats && listCats.length) {
            const sorted = listCats
                .slice()
                .filter((cat) => cat.name !== "⚽ beIN SPORTS")
                .sort((a, b) => compareCategories(a.name, b.name))
            const rows = sorted.map((cat) => ({
                name: cat.name,
                count: cat.count || 0,
                selected: cat.name === state.zapCategory,
                playing: !isPlayingBein && cat.name === playing,
            }))
            return [beinRow].concat(rows)
        }

        const count = {}
        allChannels()
            .filter((channel) => matchesMedia(channel, "live"))
            .forEach((channel) => {
                const group = channel.group || "Otros"
                if (group !== "⚽ beIN SPORTS") {
                    count[group] = (count[group] || 0) + 1
                }
            })
        const rows = Object.keys(count)
            .sort(compareCategories)
            .map((name) => {
                return {
                    name,
                    count: count[name],
                    selected: name === state.zapCategory,
                    playing: !isPlayingBein && name === playing,
                }
            })
        return [beinRow].concat(rows)
    }

    function zapChannels() {
        if (state.zapCategory === "⚽ beIN SPORTS" || state.zapCategory === "__bein__") {
            const activeId = state.playing && state.playing.listId ? state.playing.listId : state.tvSource
            return getBeinChannelsList(activeId)
        }
        return allChannels().filter((channel) => {
            if (!matchesMedia(channel, "live")) return false
            return (channel.group || "Otros") === state.zapCategory
        })
    }

    function zapChannelIndex() {
        const list = zapChannels()
        const current = state.playing && state.playing.channel
        for (let i = 0; i < list.length; i++) {
            if (sameChannel(list[i], current)) return i
        }
        return 0
    }

    function setZapCategory(name) {
        state.zapCategory = name
        if (state.playing && state.playing.channel) state.catName = name
        ensureCategoryLoaded(name)
        emit()
        focus("zapChannels", 0, 0)
    }

    function rememberLiveOrigin(channel, includeAllSources) {
        const origin = state.playing && state.playing.origin
        if (!origin || origin.screen !== "tv") return
        const category = channel.group || "Otros"
        const source = includeAllSources ? null : origin.tvSource
        const rows = allChannels().filter((item) => {
            return (
                matchesMedia(item, "live") &&
                (!source || item.listId === source) &&
                (item.group || "Otros") === category
            )
        })
        const needle = searchOf("tvchannels").trim()
        const visible = needle ? App.api.match(rows, needle) : rows
        const row = visible.findIndex((item) => sameChannel(item, channel))
        origin.category = category
        origin.mediaType = "live"
        origin.tvSource = source
        origin.row = Math.max(0, row)
        if (row >= 0)
            state.viewLimit = Math.max(
                state.viewLimit,
                Math.ceil((row + 1) / PAGE_SIZE) * PAGE_SIZE,
            )
    }

    function zapTo(channel) {
        if (!channel || (!channel.url && !channel.cmd)) return
        if (state.screen !== "player") return
        if (sameChannel(state.playing && state.playing.channel, channel)) {
            closeZap()
            return
        }
        rememberLiveOrigin(channel, true)
        play(channel, channel.listId || state.playing.listId, zapChannels())
        closeZap()
    }

    function sameChannel(first, second) {
        if (!first || !second) return false
        if (first.listId !== second.listId) return false
        if (first.streamId && second.streamId) return first.streamId === second.streamId
        if (first.id && second.id) return first.id === second.id
        if (first.cmd && second.cmd) return first.cmd === second.cmd
        if (first.url && second.url) return first.url === second.url
        return first.name === second.name
    }

    function isPlayingChannel(channel) {
        return !!(state.playing && sameChannel(state.playing.channel, channel))
    }

    let zapDebounceTimer = null

    function zap(delta) {
        if (!state.playing || state.zapping.length < 2) return
        state.zapIndex = (state.zapIndex + delta + state.zapping.length) % state.zapping.length
        const channel = state.zapping[state.zapIndex]
        state.nowProgram = programOf(channel)
        state.nextProgram = nextOf(channel)
        state.preview = channel
        state.playing = {
            channel,
            listId: channel.listId || state.playing.listId,
            origin: state.playing.origin,
            resumeAt: 0,
        }
        state.playStatus = "opening"
        state.playError = null
        emit()

        if (zapDebounceTimer) clearTimeout(zapDebounceTimer)
        zapDebounceTimer = setTimeout(() => {
            zapDebounceTimer = null
            if (state.playing && sameChannel(state.playing.channel, channel)) {
                rememberLiveOrigin(channel, false)
                play(channel, channel.listId || state.playing.listId, state.zapping)
            }
        }, 280)
    }

    function exitPlayer() {
        // Keep the installed PWA in true fullscreen when leaving the player.
        const isPwa = typeof App !== "undefined" && App.isStandalonePwa && App.isStandalonePwa()
        if (!isPwa && typeof App !== "undefined" && App.exitFullscreen) {
            App.exitFullscreen()
        }
        if (zapDebounceTimer) {
            clearTimeout(zapDebounceTimer)
            zapDebounceTimer = null
        }
        playbackRequest++
        const origin = state.playing ? state.playing.origin : null
        const currentChannel = state.playing ? state.playing.channel : null
        if (state.playing && isVod(state.playing.channel) && state.playbackInfo)
            recordPlayback(state.playbackInfo, true)
        state.playing = null
        state.playbackInfo = null
        state.nowProgram = null
        state.nextProgram = null
        state.playStatus = "idle"
        state.playError = null
        state.zapOpen = false
        state.menuFocus = false

        if (origin && origin.screen === "tv" && currentChannel) {
            const validSource =
                origin.tvSource && listById(origin.tvSource) ? origin.tvSource : null
            const targetCat = currentChannel.group || origin.category || state.catName
            set({
                screen: "tv",
                mediaType: origin.mediaType || "live",
                catName: targetCat,
                tvSource: validSource,
                preview: currentChannel,
                previewRequested: false,
            })
            const items = visibleTvCategory().items
            let channelRow = origin.row || 0
            if (items && items.length) {
                const idx = items.findIndex((item) => sameChannel(item, currentChannel))
                if (idx !== -1) channelRow = idx
            }
            focus(origin.zone || "tvChannels", channelRow, 0)
            return
        }

        if (App.player) App.player.stop()

        if (origin && origin.screen) {
            const validSource =
                origin.tvSource && listById(origin.tvSource) ? origin.tvSource : null
            set({
                screen: origin.screen,
                mediaType: origin.mediaType || state.mediaType || "live",
                catName: origin.category || state.catName,
                tvSource: validSource,
                previewRequested: false,
            })
            focus(origin.zone, origin.row || 0, 0)
            return
        }
        goHome()
    }

    function notify(message, duration) {
        toastSeq++
        state.toast = { message, id: toastSeq }
        emit()
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
            state.toast = null
            emit()
        }, duration || TOAST_MS)
    }

    function setLoading(visible, label) {
        if (visible) showNotice("Opening", label || "the channel")
        else hideNotice()
        emit()
    }

    function askConfirm(message, onAccept) {
        set({ confirm: { message, onAccept, returnScreen: state.screen } })
        focus("confirm", 0, 0)
    }

    function closeConfirm() {
        const screen = state.confirm ? state.confirm.returnScreen : null
        set({ confirm: null })
        if (screen === "edit") focus("fields")
        else goHome()
    }

    function view(source, scope, options) {
        options = options || {}
        const needle = searchOf(scope).trim()
        const filtered = needle ? App.api.match(source, needle) : source
        const total = filtered.length
        let label = options.label || ""

        if (needle)
            label = `${formatCount(total) + (total === 1 ? " result" : " results")} for “${needle}”`
        if (total > state.viewLimit)
            label += ` · showing ${formatCount(state.viewLimit)} of ${formatCount(total)}`

        return {
            items: filtered.slice(0, state.viewLimit),
            total,
            hasMore: total > state.viewLimit,
            count: needle ? formatCount(total) : "",
            label,
            collapsed: !!needle,
            zone: options.zone,
            showGroup: !!options.showGroup,
            empty: options.empty || "",
        }
    }

    function isAdultCategoryName(name) {
        if (!name) return false
        return /\b(adult|adults|xxx|18\+|porn|erotic|x-rated|for adults)\b/i.test(String(name))
    }

    function tvCategories() {
        const scope = state.tvSource
        const activeList = (scope ? listById(scope) : null) || state.lists[0]
        const mediaType = state.mediaType || "live"
        const favCount = state.favorites.filter((c) => matchesMedia(c, mediaType)).length
        const recCount = state.recent.filter((c) => matchesMedia(c, mediaType)).length
        const specialRows = [
            { name: "⭐ Favoris", id: "__favs__", special: "favs", count: favCount, sources: 1 },
            { name: "🕒 Récents", id: "__recents__", special: "recents", count: recCount, sources: 1 },
        ]

        if (mediaType === "live") {
            const beinList = getBeinChannelsList(activeList ? activeList.id : null)
            const beinCount = (beinList && beinList.length) || 26
            specialRows.unshift({
                name: "⚽ beIN SPORTS (Yacine TV)",
                id: "__bein__",
                special: "bein",
                count: beinCount,
                sources: 1,
            })
        }

        const catList =
            activeList &&
            state.categories[activeList.id] &&
            (state.categories[activeList.id][mediaType] || state.categories[activeList.id].live)
        if (activeList && catList && catList.length) {
            const channelCounts = {}
            const channels = allChannels()
            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i]
                if (matchesMedia(ch, mediaType)) {
                    const grp = ch.group || "Otros"
                    channelCounts[grp] = (channelCounts[grp] || 0) + 1
                }
            }
            const needle = searchOf("tv").trim().toLowerCase()
            const filteredCats = (state.parentalLocked
                ? catList.filter((cat) => !isAdultCategoryName(cat.name))
                : catList.slice()
            ).filter((cat) => cat.id !== "__bein__" && !String(cat.name || "").includes("beIN SPORTS"))
            const sortedCatList = filteredCats.sort((a, b) => compareCategories(a.name, b.name))
            const regularRows = sortedCatList.map((cat) => ({
                name: cat.name,
                id: cat.id,
                count: channelCounts[cat.name] || cat.count || 0,
                sources: 1,
            }))
            const rows = specialRows.concat(regularRows)
            const visible = needle
                ? rows.filter((row) => row.name.toLowerCase().indexOf(needle) !== -1)
                : rows
            return {
                rows: visible,
                total: regularRows.length,
                count: needle ? formatCount(visible.length) : "",
                label: `${(activeList ? `${activeList.name} · ` : "") +
                    formatCount(regularRows.length) +
                    (regularRows.length === 1 ? " catégorie" : " catégories")}`,
            }
        }

        const counts = {},
            lists = {}
        allChannels().forEach((channel) => {
            if (scope && channel.listId !== scope) return
            if (!matchesMedia(channel, state.mediaType)) return
            const group = channel.group || "Otros"
            if (state.parentalLocked && isAdultCategoryName(group)) return
            counts[group] = (counts[group] || 0) + 1
            lists[group] = lists[group] || {}
            lists[group][channel.listId] = 1
        })

        const needle = searchOf("tv").trim().toLowerCase()
        const names = Object.keys(counts)
            .filter((name) => !String(name || "").includes("beIN SPORTS"))
            .sort(compareCategories)
        const regularRows = names.map((name) => {
            return { name, count: counts[name], sources: Object.keys(lists[name]).length }
        })
        const rows = specialRows.concat(regularRows)
        const visible = needle
            ? rows.filter((row) => {
                  return row.name.toLowerCase().indexOf(needle) !== -1
              })
            : rows
        let channels = 0
        allChannels().forEach((channel) => {
            if ((!scope || channel.listId === scope) && matchesMedia(channel, state.mediaType))
                channels++
        })
        const list = scope ? listById(scope) : null
        return {
            rows: visible,
            total: regularRows.length,
            count: needle ? formatCount(visible.length) : "",
            label: `${(list ? `${list.name} · ` : "") +
                formatCount(regularRows.length) +
                (regularRows.length === 1 ? " catégorie" : " catégories")
                } · ${formatCount(channels)} contenus`,
        }
    }

    function extractYear(channel) {
        if (!channel) return 0
        if (channel.year && /^\d{4}$/.test(String(channel.year).trim())) {
            return parseInt(String(channel.year).trim(), 10)
        }
        if (channel.releaseDate) {
            const m = String(channel.releaseDate).match(/\b(19\d{2}|20\d{2})\b/)
            if (m) return parseInt(m[1], 10)
        }
        const mTitle = String(channel.name || "").match(/[\(\[\s](19\d{2}|20\d{2})[\)\]\s]?/)
        return mTitle ? parseInt(mTitle[1], 10) : 0
    }

    function extractRating(channel) {
        if (!channel) return 0
        const val = parseFloat(channel.rating || channel.rating_5based || 0)
        return isFinite(val) ? val : 0
    }

    function sortVodChannels(channels) {
        const mode = state.vodSort || "default"
        if (mode === "default" || state.mediaType === "live") return channels
        const copy = channels.slice()
        if (mode === "az") {
            copy.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" }))
        } else if (mode === "year") {
            copy.sort((a, b) => extractYear(b) - extractYear(a))
        } else if (mode === "rating") {
            copy.sort((a, b) => extractRating(b) - extractRating(a))
        }
        return copy
    }

    function cycleVodSort() {
        const modes = ["default", "az", "year", "rating"]
        const labels = {
            default: "Tri : Par défaut",
            az: "Tri : Alphabétique (A-Z)",
            year: "Tri : Année (Plus récents)",
            rating: "Tri : Note (★)",
        }
        const next = modes[(modes.indexOf(state.vodSort || "default") + 1) % modes.length]
        state.vodSort = next
        notify(labels[next] || "Tri modifié")
        emit()
    }

    function visibleTvCategory() {
        const scope = state.tvSource
        const globalNeedle = searchOf("tvchannels").trim()
        let pool = []

        if (state.catName === "⭐ Favoris") {
            pool = state.favorites.filter((c) => matchesMedia(c, state.mediaType))
        } else if (state.catName === "🕒 Récents") {
            pool = state.recent.filter((c) => matchesMedia(c, state.mediaType))
        } else if (
            state.catName === "⚽ beIN SPORTS (Yacine TV)" ||
            state.catName === "⚽ beIN SPORTS" ||
            state.catName === "beIN SPORTS" ||
            state.catName === "__bein__" ||
            /bein\s*sports/i.test(state.catName)
        ) {
            pool = getBeinChannelsList(scope)
        } else if (globalNeedle && state.mediaType === "live") {
            // In Android ZapActivity, the top search bar searches across ALL loaded channels or current category
            pool = allChannels().filter((channel) => {
                if (scope && channel.listId !== scope) return false
                if (!matchesMedia(channel, state.mediaType)) return false
                return true
            })
            if (!pool.length) {
                pool = allChannels().filter((channel) => {
                    if (scope && channel.listId !== scope) return false
                    if (!matchesMedia(channel, state.mediaType)) return false
                    return (channel.group || "Otros") === state.catName
                })
            }
        } else {
            pool = allChannels().filter((channel) => {
                if (scope && channel.listId !== scope) return false
                if (!matchesMedia(channel, state.mediaType)) return false
                return (channel.group || "Otros") === state.catName
            })
        }

        const sorted = sortVodChannels(pool)
        const isLoading = state.categoryLoading === state.catName
        const result = view(sorted, "tvchannels", {
            zone: "tvChannels",
            empty: isLoading
                ? "Chargement des flux beIN Sports…"
                : state.catName === "⚽ beIN SPORTS"
                    ? "Aucun flux beIN Sports disponible pour le moment."
                    : state.catName === "⭐ Favoris"
                        ? "Aucun favori enregistré dans cette section."
                        : state.catName === "🕒 Récents"
                            ? "Aucun historique récent dans cette section."
                            : "Cette catégorie ne contient aucun contenu.",
        })
        result.loading = isLoading
        result.label = `${formatCount(result.total)} ${result.total === 1 ? "élément" : "éléments"}`
        return result
    }

    function visibleRecents() {
        const result = view(state.recent, "recents", { zone: "recentsList", showGroup: true })
        if (!result.count) {
            result.label =
                state.recent.length === 1
                    ? "1 channel"
                    : `${formatCount(state.recent.length)} channels`
        }
        return result
    }

    function visibleFavorites() {
        const result = view(state.favorites, "favorites", { zone: "favsList", showGroup: true })
        if (!result.count) {
            result.label =
                state.favorites.length === 1
                    ? "1 saved channel"
                    : `${formatCount(state.favorites.length)} saved channels`
        }
        return result
    }

    function currentView() {
        if (state.screen === "tv") return visibleTvCategory()
        if (state.screen === "recents") return visibleRecents()
        if (state.screen === "favs") return visibleFavorites()
        return null
    }

    function matchesMedia(channel, type) {
        const media = channel.mediaType || "live"
        return type === "series" ? media === "series" || media === "series-episode" : media === type
    }

    function stats() {
        const lists = state.lists.length
        let channels = 0
        state.lists.forEach((list) => {
            if (state.channels[list.id]) channels += state.channels[list.id].length
        })
        let counts = lists === 0 ? "No sources" : lists === 1 ? "1 source" : `${lists} sources`
        if (channels) counts += `, ${formatCount(channels)} channels`
        return { counts, favorites: state.favorites.length, recent: state.recent.length }
    }

    let seekDebounceTimer = null
    let virtualSeekTarget = null

    function toggleAspectRatio() {
        const modes = ["fill", "contain", "cover"]
        const current = state.aspectRatio || "fill"
        const nextIndex = (modes.indexOf(current) + 1) % modes.length
        const nextMode = modes[nextIndex]
        state.aspectRatio = nextMode
        write("ts.aspectRatio", nextMode)
        if (App.player && App.player.setAspectRatio) App.player.setAspectRatio(nextMode)
        emit()
        const labels = {
            fill: "Format : Plein écran 16:9 (Étiré)",
            contain: "Format : Original (Adapter)",
            cover: "Format : Zoom (Remplir)",
        }
        notify(labels[nextMode] || nextMode)
    }

    function togglePlay() {
        if (!App.player) return
        const newState = App.player.toggle()
        state.playStatus = newState ? newState.toLowerCase() : "playing"
        emit()
    }

    function pause() {
        if (!App.player) return
        const newState = App.player.pause()
        state.playStatus = newState ? newState.toLowerCase() : "paused"
        emit()
    }

    function resume() {
        if (!App.player) return
        const newState = App.player.resume()
        state.playStatus = newState ? newState.toLowerCase() : "playing"
        emit()
    }

    function smartSeek(deltaSeconds) {
        if (!state.playing) return false
        if (!isVod(state.playing.channel)) {
            notify("Le direct ne supporte pas l'avance rapide")
            return false
        }
        const ch = state.playing.channel
        const info =
            state.playbackInfo ||
            (App.player && App.player.playbackInfo()) || { position: 0, duration: 0 }
        const chDur = ch ? parseDuration(ch.durationSecs || ch.duration_secs || ch.duration) : 0
        const duration = (isFinite(info.duration) && info.duration > 0) ? info.duration : chDur

        const currentPos =
            virtualSeekTarget !== null
                ? virtualSeekTarget
                : (Number(info.position) || (App.player && App.player.currentTime && App.player.currentTime()) || 0)

        let target = currentPos + deltaSeconds
        if (duration > 0) {
            target = Math.max(0, Math.min(duration, target))
        } else {
            target = Math.max(0, target)
        }
        virtualSeekTarget = target
        state.virtualSeekPosition = target

        const currentEl = document.getElementById("vodTimeCurrent")
        const seekEl = document.getElementById("vodSeek")
        if (currentEl) currentEl.textContent = formatPosition(virtualSeekTarget)
        if (seekEl) {
            if (duration > 0) {
                seekEl.max = Math.max(1, Math.floor(duration))
                seekEl.value = Math.floor(virtualSeekTarget)
                const progress = Math.min(100, (virtualSeekTarget / duration) * 100)
                seekEl.style.setProperty("--seek-progress", `${progress}%`)
            } else {
                seekEl.value = Math.floor(virtualSeekTarget)
            }
        }

        const sign = deltaSeconds > 0 ? "+" : ""
        const diff = Math.round(virtualSeekTarget - (info.position || 0))
        notify(`${sign}${diff} s · ${formatPosition(virtualSeekTarget)}`)

        if (seekDebounceTimer) clearTimeout(seekDebounceTimer)
        seekDebounceTimer = setTimeout(() => {
            if (virtualSeekTarget !== null && App.player) {
                App.player.seekTo(virtualSeekTarget, () => {
                    refreshPlayback(true)
                })
            }
            virtualSeekTarget = null
            state.virtualSeekPosition = null
        }, 280)

        return true
    }

    function seekTo(seconds) {
        if (!state.playing || !isVod(state.playing.channel)) return false
        if (!App.player) return false
        if (seekDebounceTimer) clearTimeout(seekDebounceTimer)
        virtualSeekTarget = null
        state.virtualSeekPosition = null
        return App.player.seekTo(seconds, () => {
            refreshPlayback(true)
        })
    }

    function selectPlaybackTrack(type, index) {
        return App.player ? App.player.selectTrack(type, index) : false
    }

    function setCanInstallPwa(val) {
        state.canInstallPwa = !!val
        emit()
    }

    function refreshMediaCatalog(mediaType) {
        const list = state.lists[0]
        if (!list) {
            notify("Aucun serveur connecté")
            return Promise.resolve()
        }
        const label = mediaType === "movie" ? "Films" : mediaType === "series" ? "Séries" : "TV en Direct"
        if (state.categories[list.id]) {
            delete state.categories[list.id][mediaType]
        }
        if (state.loadedCategories[list.id]) {
            Object.keys(state.loadedCategories[list.id]).forEach((k) => {
                if (k.startsWith(mediaType + ":")) delete state.loadedCategories[list.id][k]
            })
        }
        notify(`Actualisation du catalogue ${label}…`)
        return ensureCategories(list.id, mediaType)
            .then((cats) => {
                notify(`Catalogue ${label} actualisé (${cats ? cats.length : 0} catégories)`)
            })
            .catch((err) => {
                notify(`Erreur : ${err.message}`)
            })
    }

    function cycleDns() {
        const options = ["1.1.1.1 (Cloudflare)", "8.8.8.8 (Google)", "Système (Défaut)"]
        const idx = options.indexOf(state.dnsPref)
        const next = options[(idx + 1) % options.length]
        state.dnsPref = next
        notify(`DNS configuré sur : ${next}`)
        emit()
    }

    function toggleVpn() {
        state.vpnEnabled = !state.vpnEnabled
        notify(
            state.vpnEnabled
                ? "🛡️ Cloudflare WARP (Anti-Bridage) : ACTIVÉ"
                : "🛡️ Cloudflare WARP : DÉSACTIVÉ",
        )
        emit()
    }

    function toggleParental() {
        state.parentalLocked = !state.parentalLocked
        notify(
            state.parentalLocked
                ? "🔒 Contrôle parental : ACTIVÉ (Catégories 18+ masquées)"
                : "🔓 Contrôle parental : DÉSACTIVÉ",
        )
        emit()
    }

    function toggleStats() {
        state.statsVisible = !state.statsVisible
        emit()
    }

    function openGlobalSearch() {
        set({ globalSearchOpen: true, globalSearchQuery: "" })
        focus("globalSearchInput", 0, 0)
    }

    function closeGlobalSearch() {
        set({ globalSearchOpen: false, globalSearchQuery: "" })
        if (state.screen === "home") focus("homeCards", 0, 0)
    }

    function setGlobalSearchQuery(q) {
        set({ globalSearchQuery: String(q || "") })
    }

    function globalSearchResults() {
        const q = (state.globalSearchQuery || "").trim()
        if (!q || q.length < 2) return []
        const pool = allChannels()
        return App.api.match(pool, q).slice(0, 60)
    }

    function changeAccountPin() {
        if (App.player) App.player.stop()
        set({
            screen: "pin",
            pinEntry: "",
            pinError: "",
            pinLoading: false,
            pinSubmitted: false,
            selectedMovie: null,
            globalSearchOpen: false,
        })
        focus("pinGrid", 0, 0)
    }

    return {
        state,
        setCanInstallPwa,
        subscribe,
        init,
        takeFocus,
        focus,
        focusChanged,
        listById,
        listKind,
        listLabel,
        channelsOf,
        groupsOf,
        groupNames,
        allChannels,
        sources,
        setFilter,
        ensureChannels,
        buildSource,
        addList,
        updateList,
        removeList,
        goHome,
        authenticatePin,
        setPinEntry,
        appendPinDigit,
        backspacePin,
        clearPin,
        openServers,
        switchServer,
        openSeries,
        closeSeries,
        openMovieDetail,
        closeMovieDetail,
        playSeriesEpisode,
        openTv,
        openMedia,
        openRecents,
        openFavorites,
        openAdd,
        chooseType,
        openEdit,
        openCategories,
        categoriesView,
        toggleCategory,
        setAllCategories,
        saveCategories,
        setCatSearch,
        setSearch,
        searchOf,
        isFavorite,
        toggleFavorite,
        programOf,
        programProgress,
        refreshProgram,
        nextOf,
        loadProgramFor,
        play,
        isVod,
        isPlayingChannel,
        savedPlayback,
        refreshPlayback,
        finishPlayback,
        seekTo,
        smartSeek,
        toggleAspectRatio,
        togglePlay,
        pause,
        resume,
        selectPlaybackTrack,
        zap,
        openZap,
        closeZap,
        setMenuFocus,
        zapCategories,
        zapChannels,
        setZapCategory,
        zapTo,
        exitPlayer,
        notify,
        setLoading,
        playStarted,
        playFailed,
        retryPlay,
        askConfirm,
        closeConfirm,
        pushDigit,
        clearDigits,
        commitDigits,
        jumpTo,
        formatCount,
        tvCategories,
        visibleTvCategory,
        openTvCategory,
        selectPreview,
        loadMore,
        openSource,
        backToTv,
        loadingRows,
        elapsedOf,
        ensureCategories,
        ensureCategoryLoaded,
        visibleRecents,
        visibleFavorites,
        stats,
        parseDuration,
        categoryPriority,
        cycleVodSort,
        refreshMediaCatalog,
        cycleDns,
        toggleVpn,
        toggleParental,
        toggleStats,
        openGlobalSearch,
        closeGlobalSearch,
        setGlobalSearchQuery,
        globalSearchResults,
        changeAccountPin,
    }
})()
