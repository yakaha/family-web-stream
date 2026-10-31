var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.api = (function () {
    const TIMEOUT_MS = 60000
    const STALKER_UA =
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3"

    function enc(value) {
        return encodeURIComponent(value)
    }

    function originOf(url) {
        const match = (url || "").match(/^https?:\/\/[^\/?#]+/i)
        return match ? match[0] : null
    }

    function hostOf(url) {
        const match = (url || "").match(/^https?:\/\/([^\/?#]+)/i)
        return match ? match[1] : "Lista"
    }

    function lineFeeder(emit) {
        let pending = null
        const attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g
        return function (line) {
            line = line.trim()
            if (!line) return
            if (line.indexOf("#EXTINF") === 0) {
                const map = {}
                let match
                attrRe.lastIndex = 0
                while ((match = attrRe.exec(line)) !== null) map[match[1].toLowerCase()] = match[2]
                const name = line.match(/,(.*)$/)
                pending = {
                    name: name ? name[1].trim() : "Canal",
                    group: map["group-title"] || "Otros",
                    logo: map["tvg-logo"] || "",
                }
                return
            }
            if (line.charAt(0) === "#" || !pending) return
            pending.url = line
            const group = pending.group || ""
            if (/\/series\//i.test(line) || /series|s[ée]ries|shows?/i.test(group))
                pending.mediaType = "series-episode"
            else if (/\/movie\//i.test(line) || /movies?|films?|vod|pel[ií]culas?/i.test(group))
                pending.mediaType = "movie"
            else pending.mediaType = "live"
            emit(pending)
            pending = null
        }
    }

    function parseM3u(text) {
        const channels = []
        const feed = lineFeeder((channel) => {
            channels.push(channel)
        })
        if (!text) return channels
        let start = 0
        const len = text.length
        while (start < len) {
            let next = text.indexOf("\n", start)
            if (next === -1) next = len
            feed(text.slice(start, next))
            start = next + 1
        }
        return channels
    }

    function withTimeout(promise, message, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false
            const timer = setTimeout(() => {
                if (settled) return
                settled = true
                reject(new Error(message))
            }, timeoutMs || TIMEOUT_MS)
            promise.then(
                (value) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    resolve(value)
                },
                (error) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    reject(error)
                },
            )
        })
    }

    function proxify(url, headers) {
        if (typeof window !== "undefined" && window.location) {
            const host = window.location.hostname
            const port = window.location.port
            const isLocal =
                host === "localhost" ||
                host === "127.0.0.1" ||
                /^192\.168\./.test(host) ||
                /^10\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
                port === "8090"
            if (isLocal && /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
                const proxyUrl = `${window.location.origin}/proxy?url=${encodeURIComponent(url)}`
                if (headers) {
                    if (headers.Cookie) {
                        headers["X-Target-Cookie"] = headers.Cookie
                        delete headers.Cookie
                    }
                    if (headers["User-Agent"]) {
                        headers["X-Target-User-Agent"] = headers["User-Agent"]
                        delete headers["User-Agent"]
                    }
                    if (headers.Referer) {
                        headers["X-Target-Referer"] = headers.Referer
                        delete headers.Referer
                    }
                }
                return proxyUrl
            }
        }
        return url
    }

    function fetchJson(url, headers, attempt) {
        attempt = attempt || 0
        const reqHeaders = Object.assign({}, headers || {})
        const targetUrl = proxify(url, reqHeaders)

        return fetch(
            targetUrl,
            Object.keys(reqHeaders).length ? { headers: reqHeaders } : undefined,
        ).then((res) => {
            if (res.status === 429 && attempt < 4) {
                const backoff = 1200 * (attempt + 1) + Math.floor(Math.random() * 400)
                return new Promise((resolve) =>
                    setTimeout(resolve, backoff),
                ).then(() => fetchJson(url, headers, attempt + 1))
            }
            if (!res.ok) {
                if (res.status === 429) {
                    throw new Error("Serveur IPTV saturé (trop de requêtes). Réessayez dans un instant.")
                }
                throw new Error(`HTTP ${res.status}`)
            }
            return res.text().then((body) => {
                if (!body || !body.trim()) {
                    if (attempt < 2) {
                        return new Promise((resolve) =>
                            setTimeout(resolve, 300 * (attempt + 1)),
                        ).then(() => fetchJson(url, headers, attempt + 1))
                    }
                    throw new Error("The portal returned an empty or invalid JSON response")
                }
                try {
                    return JSON.parse(body)
                } catch {
                    const cleaned = body
                        .replace(/^\/\*.*?\*\//s, "")
                        .replace(/^var\s+[^=]+=\s*/, "")
                        .replace(/;\s*$/, "")
                        .trim()
                    try {
                        return JSON.parse(cleaned)
                    } catch {
                        if (attempt < 2) {
                            return new Promise((resolve) =>
                                setTimeout(resolve, 300 * (attempt + 1)),
                            ).then(() => fetchJson(url, headers, attempt + 1))
                        }
                        throw new Error("The portal returned an empty or invalid JSON response")
                    }
                }
            })
        })
    }

    // Xtream VOD catalogs can contain tens of thousands of entries. Parse the root
    // array as network chunks arrive so the UI can show the first films immediately.
    function fetchJsonBatches(url, onBatch, batchSize) {
        return fetch(url).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const size = batchSize || 160
            const all = []
            let batch = []
            let buffer = ""
            let arrayResponse = null
            function add(item) {
                all.push(item)
                batch.push(item)
                if (batch.length >= size) {
                    onBatch(batch)
                    batch = []
                }
            }
            function flushBatch() {
                if (batch.length) onBatch(batch)
                batch = []
            }
            function consume(final) {
                if (arrayResponse === null) {
                    const first = buffer.search(/\S/)
                    if (first < 0) return
                    arrayResponse = buffer[first] === "["
                    if (!arrayResponse) return
                    buffer = buffer.slice(first + 1)
                }
                let offset = 0
                while (offset < buffer.length) {
                    while (offset < buffer.length && /[\s,]/.test(buffer[offset])) offset++
                    if (buffer[offset] === "]") {
                        offset++
                        break
                    }
                    if (offset >= buffer.length) break
                    if (buffer[offset] !== "{") {
                        if (!final) break
                        throw new Error("The panel returned an invalid catalog")
                    }
                    const start = offset
                    let depth = 0
                    let quoted = false
                    let escaped = false
                    for (; offset < buffer.length; offset++) {
                        const char = buffer[offset]
                        if (quoted) {
                            if (escaped) escaped = false
                            else if (char === "\\") escaped = true
                            else if (char === '"') quoted = false
                            continue
                        }
                        if (char === '"') quoted = true
                        else if (char === "{" || char === "[") depth++
                        else if (char === "}" || char === "]") {
                            depth--
                            if (depth === 0) {
                                offset++
                                try {
                                    add(JSON.parse(buffer.slice(start, offset)))
                                } catch (err) {
                                    console.warn("Skipping invalid catalog row:", err)
                                }
                                break
                            }
                        }
                    }
                    if (depth !== 0) {
                        offset = start
                        break
                    }
                }
                buffer = buffer.slice(offset)
            }
            const reader =
                res.body && res.body.getReader && typeof TextDecoder !== "undefined"
                    ? res.body.getReader()
                    : null
            if (!reader) {
                return res.text().then((body) => {
                    const parsed = JSON.parse(body || "[]")
                    if (!Array.isArray(parsed)) return parsed
                    for (let i = 0; i < parsed.length; i++) add(parsed[i])
                    flushBatch()
                    return all
                })
            }
            const decoder = new TextDecoder()
            function read() {
                return reader.read().then((result) => {
                    if (result.done) {
                        buffer += decoder.decode()
                        consume(true)
                        flushBatch()
                        return arrayResponse ? all : JSON.parse(buffer || "[]")
                    }
                    buffer += decoder.decode(result.value, { stream: true })
                    consume(false)
                    return read()
                })
            }
            return read()
        })
    }

    function readStream(res, onProgress) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        const channels = []
        let tail = ""
        const feed = lineFeeder((channel) => {
            channels.push(channel)
        })

        function step() {
            return reader.read().then((result) => {
                if (result.done) {
                    if (tail) feed(tail)
                    return channels
                }
                const chunk = tail + decoder.decode(result.value, { stream: true })
                const lines = chunk.split("\n")
                tail = lines.pop()
                for (let i = 0; i < lines.length; i++) feed(lines[i])
                if (onProgress) onProgress({ label: "Downloading", count: channels.length })
                return step()
            })
        }
        return step()
    }

    function loadM3uUrl(url, onProgress) {
        if (onProgress) onProgress({ label: "Connecting" })
        return withTimeout(fetch(url), "The playlist is not responding").then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)

            const canStream = res.body && res.body.getReader && typeof TextDecoder !== "undefined"
            if (canStream) return readStream(res, onProgress)

            return res.text().then(parseM3u)
        })
    }

    function loadM3uText(text, onProgress) {
        if (onProgress) onProgress({ label: "Reading" })
        const channels = parseM3u(text)
        if (!channels.length) throw new Error("That text has no channels (missing #EXTM3U?)")
        return Promise.resolve(channels)
    }

    function parseXtreamUrl(url) {
        if (!url || !/^https?:\/\/[^\/?#]+\/(?:get|player_api|panel_api)\.php/i.test(url))
            return null
        const origin = originOf(url)
        const user = url.match(/[?&]username=([^&]*)/i)
        const pass = url.match(/[?&]password=([^&]*)/i)
        if (!origin || !user || !pass || !user[1] || !pass[1]) return null
        return {
            origin,
            user: decodeURIComponent(user[1]),
            pass: decodeURIComponent(pass[1]),
        }
    }

    function parsePortal(url, user, pass) {
        const parsed = parseXtreamUrl(url)
        if (parsed) return parsed
        const origin = originOf(url)
        if (!origin || !user || !pass) return null
        return { origin, user, pass }
    }

    function loadXtream(portal, onProgress, mediaType) {
        const base = `${portal.origin}/player_api.php?username=${enc(portal.user)}&password=${enc(
            portal.pass,
        )}`
        const groups = {}
        if (onProgress) onProgress({ label: "Fetching categories" })
        const media = [
            { type: "live", categories: "get_live_categories", action: "get_live_streams" },
            { type: "movie", categories: "get_vod_categories", action: "get_vod_streams" },
            { type: "series", categories: "get_series_categories", action: "get_series" },
        ]
        const selected = mediaType ? media.filter((item) => item.type === mediaType) : media
        if (!selected.length) return Promise.reject(new Error("Unknown media type"))
        const tasks = selected.map((item) => {
            return withTimeout(
                fetchJson(`${base}&action=${item.categories}`).then((categories) => {
                    ;(categories || []).forEach((category) => {
                        groups[`${item.type}:${category.category_id}`] = category.category_name
                    })
                    const channels = []
                    const append = (streams) => {
                        const items = streams.map((stream) => {
                            const path = item.type === "movie" ? "movie" : "live"
                            const suffix =
                                item.type === "movie" ? stream.container_extension || "mp4" : "ts"
                            const streamId = stream.stream_id || stream.series_id
                            return {
                                name: stream.name || "Canal",
                                group: groups[`${item.type}:${stream.category_id}`] || "Otros",
                                logo: stream.stream_icon || "",
                                streamId: String(streamId || ""),
                                seriesId: item.type === "series" ? String(streamId || "") : "",
                                mediaType: item.type,
                                url:
                                    item.type === "series"
                                        ? ""
                                        : `${portal.origin}/${path}/${enc(portal.user)}/${enc(portal.pass)}/${streamId}.${suffix}`,
                                portalOrigin: portal.origin,
                                portalUser: portal.user,
                                portalPass: portal.pass,
                            }
                        })
                        for (let j = 0; j < items.length; j++) {
                            channels.push(items[j])
                        }
                        if (onProgress) {
                            onProgress({
                                label: "Downloading",
                                count: channels.length,
                                items,
                                mediaType: item.type,
                                complete: false,
                            })
                        }
                    }
                    return fetchJsonBatches(`${base}&action=${item.action}`, (streams) =>
                        append(streams),
                    ).then((streams) => {
                        // Non-array panel responses use the regular JSON shape.
                        if (!Array.isArray(streams)) append(streams || [])
                        if (onProgress) {
                            onProgress({
                                label: "Preparing",
                                count: channels.length,
                                mediaType: item.type,
                                complete: true,
                            })
                        }
                        return channels
                    })
                }),
                "The panel is not responding",
            )
        })
        return Promise.all(tasks).then((catalogs) => {
            const channels = catalogs.reduce((all, list) => all.concat(list), [])
            if (!channels.length && !mediaType)
                throw new Error("The server returned no channels or media")
            return channels
        })
    }

    function resolveSeries(list, series) {
        const origin = series.portalOrigin || list.origin
        const user = series.portalUser || list.user
        const pass = series.portalPass || list.pass
        const id = series.seriesId
        if (!origin || !user || !pass || !id)
            return Promise.reject(new Error("Series credentials are missing"))
        const api = `${origin}/player_api.php?username=${enc(user)}&password=${enc(pass)}&action=get_series_info&series_id=${enc(id)}`
        return fetchJson(api).then((data) => {
            const seasons = data && data.episodes
            const keys = Object.keys(seasons || {}).sort((a, b) => Number(a) - Number(b))
            for (let i = 0; i < keys.length; i++) {
                const episode = (seasons[keys[i]] || [])
                    .slice()
                    .sort((a, b) => Number(a.episode_num || 0) - Number(b.episode_num || 0))[0]
                if (!episode || !episode.id) continue
                const ext = episode.container_extension || "mp4"
                series.episodeName = episode.title || `Season ${keys[i]}`
                return (
                    episode.direct_source ||
                    `${origin}/series/${enc(user)}/${enc(pass)}/${episode.id}.${ext}`
                )
            }
            throw new Error("No playable episodes were returned for this series")
        })
    }

    function parseSeasonEpisode(name, row, defaultSeason, defaultEp) {
        let s = Number(row && (row.season || row.season_no || row.series_no || row.season_num))
        let e = Number(row && (row.number || row.episode_num || row.episode_no || row.episode))

        const text = `${name || ""} ${(row && (row.cmd || row.title)) || ""}`
        // Try S01E02 / s1e2 / 1x02 / S01.E02
        const seMatch = text.match(/s(?:aison|eason|\.)?\s*(\d{1,2})\s*(?:[ex]|ep|épisode|\.)\s*(\d{1,3})/i)
        if (seMatch) {
            if (!s || isNaN(s)) s = Number(seMatch[1])
            if (!e || isNaN(e)) e = Number(seMatch[2])
        } else {
            const sMatch = text.match(/(?:saison|season|s)\s*(\d{1,2})\b/i)
            if (sMatch && (!s || isNaN(s))) s = Number(sMatch[1])

            const eMatch = text.match(/(?:épisode|episode|ep|e)\s*(\d{1,3})\b/i)
            if (eMatch && (!e || isNaN(e))) e = Number(eMatch[1])
        }

        if (!s || isNaN(s) || s < 1) s = Number(defaultSeason) || 1
        if (!e || isNaN(e) || e < 1) e = Number(defaultEp) || 1

        return { season: s, number: e }
    }

    function getSeriesEpisodes(list, series) {
        if (list.kind === "xtream" || list.user) {
            const origin = series.portalOrigin || list.origin
            const user = series.portalUser || list.user
            const pass = series.portalPass || list.pass
            const api = `${origin}/player_api.php?username=${enc(user)}&password=${enc(pass)}&action=get_series_info&series_id=${enc(series.seriesId)}`
            return fetchJson(api).then((data) => {
                const episodes = []
                const seasons = (data && data.episodes) || {}
                Object.keys(seasons)
                    .sort((a, b) => Number(a) - Number(b))
                    .forEach((season) => {
                        const sNum = Number(season) || 1
                        ;(seasons[season] || []).forEach((episode, index) => {
                            const ext = episode.container_extension || "mp4"
                            const parsed = parseSeasonEpisode(episode.title, episode, sNum, index + 1)
                            episodes.push({
                                title: episode.title || `Épisode ${parsed.number}`,
                                season: parsed.season,
                                number: parsed.number,
                                url:
                                    episode.direct_source ||
                                    `${origin}/series/${enc(user)}/${enc(pass)}/${episode.id}.${ext}`,
                                mediaType: "series-episode",
                            })
                        })
                    })
                if (!episodes.length) throw new Error("Aucun épisode disponible pour cette série")
                return episodes
            })
        }

        const endpoint = list.endpoint || `${(list.origin || "").replace(/\/+$/, "")}/portal.php`
        const id = series.seriesId || series.streamId
        const params = (idKey, page) =>
            `action=get_ordered_list&${idKey}=${enc(id)}&category=*&limit=500&p=${page}&JsHttpRequest=1-xml`
        function fetchRows(idKey) {
            let page = 1
            const all = []
            function next() {
                return stalkerCall(endpoint, list.mac, params(idKey, page), list.token, "series")
                    .then(stalkerRows)
                    .then((rows) => {
                        rows.forEach((season, index) => {
                            const rawName = season.name || season.title || ""
                            const numbers = Array.isArray(season.series) ? season.series : null
                            if (numbers && season.cmd) {
                                const parsedSeason = parseSeasonEpisode(rawName, season, index + 1, 1).season
                                numbers.forEach((episode, i) => {
                                    const epNum = Number(episode) || (i + 1)
                                    all.push({
                                        title: `Épisode ${epNum}`,
                                        season: parsedSeason,
                                        number: epNum,
                                        cmd: season.cmd,
                                        seasonCmd: season.cmd,
                                        episodeNum: epNum,
                                        mediaType: "series-episode",
                                    })
                                })
                            } else if (season.cmd || season.url || season.link) {
                                const parsed = parseSeasonEpisode(rawName, season, 1, index + 1)
                                let cleanTitle = rawName.replace(/s(?:aison|eason|\.)?\s*\d{1,2}\s*(?:[ex]|ep|épisode|\.)\s*\d{1,3}/i, "").trim()
                                cleanTitle = cleanTitle.replace(/^[-·–\s]+|[-·–\s]+$/g, "").trim()
                                if (!cleanTitle) cleanTitle = `Épisode ${parsed.number}`
                                all.push({
                                    title: cleanTitle,
                                    season: parsed.season,
                                    number: parsed.number,
                                    cmd: season.cmd || season.url || season.link,
                                    seasonCmd: season.cmd || season.url || season.link,
                                    episodeNum: parsed.number,
                                    mediaType: "series-episode",
                                })
                            }
                        })
                        page++
                        if (rows.length >= 14 && page <= 10) return next()
                        return all
                    })
            }
            return next()
        }
        return fetchRows("movie_id")
            .then((episodes) => (episodes.length ? episodes : fetchRows("series_id")))
            .then((episodes) => {
                if (!episodes.length) throw new Error("Aucun épisode disponible pour cette série")
                return episodes
            })
    }

    function resolveStalkerEpisode(list, episode) {
        const endpoint = list.endpoint || `${(list.origin || "").replace(/\/+$/, "")}/portal.php`
        const modes = ["vod", "series", "video"]
        let index = 0
        const epNum = episode.episodeNum || episode.number || 1
        const baseCmd = (episode.seasonCmd || episode.cmd || "").split("||")[0]
        function resolve() {
            if (index >= modes.length)
                return Promise.reject(new Error("Le portail n’a pas pu ouvrir cet épisode"))
            const mode = modes[index++]
            const params = `action=create_link&cmd=${enc(baseCmd)}&series=${enc(epNum)}&forced_storage=false&disable_ad=false&download=false&JsHttpRequest=1-xml`
            return stalkerCall(endpoint, list.mac, params, list.token, mode, 15000)
                .then((data) => {
                    const js = data && data.js
                    const item = Array.isArray(js) ? js[0] : js && js.data ? js.data : js
                    const url =
                        typeof item === "string"
                            ? item
                            : item && (item.cmd || item.url || item.stream_url)
                    if (!url) return resolve()
                    return url.replace(/^ffmpeg\s+/i, "").replace(/^auto\s+/i, "")
                })
                .catch(resolve)
        }
        return resolve()
    }

    function parseLiveUrl(url) {
        const match = (url || "").match(
            /^(https?:\/\/[^\/?#]+)\/live\/([^\/]+)\/([^\/]+)\/([^\/.]+)\.(?:ts|m3u8)/i,
        )
        if (!match) return null
        return {
            origin: match[1],
            user: decodeURIComponent(match[2]),
            pass: decodeURIComponent(match[3]),
            id: match[4],
        }
    }

    function loadNowPlaying(url) {
        const live = parseLiveUrl(url)
        if (!live) return Promise.resolve(null)
        const api = `${live.origin}/player_api.php?username=${enc(live.user)}&password=${enc(
            live.pass,
        )}&action=get_short_epg&stream_id=${enc(live.id)}&limit=3`
        return Promise.resolve()
            .then(() => {
                return fetchJson(api)
            })
            .then((data) => {
                const list = data && data.epg_listings
                if (!list || !list.length) return []
                return list.map((item) => {
                    return {
                        title: decodeBase64(item.title) || item.title || "",
                        description: decodeBase64(item.description) || "",
                        start: decodeBase64(item.start) || "",
                        end: decodeBase64(item.end) || "",
                    }
                })
            })
            .catch(() => {
                return []
            })
    }

    function decodeBase64(value) {
        if (!value) return ""
        try {
            return decodeURIComponent(escape(atob(value)))
        } catch {
            return ""
        }
    }

    let stalkerQueue = Promise.resolve()
    let lastStalkerCallTime = 0
    const STALKER_MIN_GAP = 350

    function stalkerCall(endpoint, mac, params, token, mode, timeoutMs) {
        const query = `type=${enc(mode || "stb")}&mac=${enc(mac)}&token=${enc(token || "")}&${params}`
        const headers = {
            "User-Agent": STALKER_UA,
            Cookie: `mac=${mac}; stb_lang=es; timezone=Europe/Madrid`,
            Referer: `${originOf(endpoint)}/c/`,
        }
        if (token) headers.Authorization = `Bearer ${token}`
        return withTimeout(
            fetchJson(`${endpoint}?${query}`, headers),
            "The Stalker portal is not responding",
            timeoutMs,
        )

        const runCall = () => {
            const now = Date.now()
            const diff = now - lastStalkerCallTime
            const delay = diff < STALKER_MIN_GAP ? STALKER_MIN_GAP - diff : 0

            return new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
                lastStalkerCallTime = Date.now()
                return withTimeout(
                    fetchJson(`${endpoint}?${query}`, headers),
                    "The Stalker portal is not responding",
                    timeoutMs,
                ).then(
                    (res) => {
                        lastStalkerCallTime = Date.now()
                        return res
                    },
                    (err) => {
                        lastStalkerCallTime = Date.now()
                        throw err
                    },
                )
            })
        }

        const task = stalkerQueue.then(runCall, runCall)
        stalkerQueue = task.catch(() => {})
        return task
    }

    const STALKER_PATHS = ["/portal.php", "/server/load.php", "/stalker_portal/server/load.php"]

    function stalkerEndpoints(portal) {
        if (/\.php$/i.test(portal)) return [portal]
        const clean = portal.replace(/\/+$/, "")
        const baseWithoutC = clean.replace(/\/c$/, "")
        const endpoints = []
        const add = (p) => {
            if (endpoints.indexOf(p) === -1) endpoints.push(p)
        }
        STALKER_PATHS.forEach((p) => add(clean + p))
        if (baseWithoutC !== clean) {
            STALKER_PATHS.forEach((p) => add(baseWithoutC + p))
        }
        return endpoints
    }

    function firstEndpoint(endpoints, run) {
        let index = 0
        function step() {
            if (index >= endpoints.length)
                return Promise.reject(new Error("The Stalker portal is not responding"))
            const endpoint = endpoints[index++]
            return run(endpoint).then((value) => {
                return { endpoint, value }
            }, step)
        }
        return step()
    }

    function ensureStalkerSession(list) {
        if (list.token && list.endpoint) return Promise.resolve(list)
        const portal = (list.origin || "").replace(/\/+$/, "")
        const mac = list.mac
        if (!portal || !mac) return Promise.reject(new Error("Portal or MAC missing"))

        return firstEndpoint(stalkerEndpoints(portal), (endpoint) => {
            return stalkerCall(endpoint, mac, "action=handshake&prehash=0")
        }).then((hello) => {
            const token = (hello.value && hello.value.js && hello.value.js.token) || ""
            if (!token) throw new Error("The portal gave no token (MAC not authorised?)")
            list.token = token
            list.endpoint = hello.endpoint
            return new Promise((resolve) => setTimeout(resolve, 350))
                .then(() => stalkerCall(hello.endpoint, mac, "action=get_profile", token).catch(() => {}))
                .then(() => new Promise((resolve) => setTimeout(resolve, 350)))
                .then(() => list)
        })
    }

    function checkServer(list) {
        if (list.kind === "stalker") {
            return ensureStalkerSession(list).then(() => true)
        }
        if (list.kind === "xtream" || list.user) {
            const origin = list.origin || originOf(list.url)
            const api = `${origin}/player_api.php?username=${enc(list.user)}&password=${enc(list.pass)}`
            return fetchJson(api).then((data) => {
                if (data && data.user_info && data.user_info.auth === 0) {
                    throw new Error("Identifiants Xtream incorrects")
                }
                return true
            })
        }
        if (list.url) {
            return withTimeout(fetch(list.url, { method: "HEAD" }), "Le serveur ne répond pas", 10000).then(() => true)
        }
        return Promise.resolve(true)
    }

    function loadStalkerCategories(list, mediaType) {
        mediaType = mediaType || "live"
        return ensureStalkerSession(list).then((session) => {
            if (mediaType === "live") {
                return stalkerCall(
                    session.endpoint,
                    session.mac,
                    "action=get_genres&JsHttpRequest=1-xml",
                    session.token,
                    "itv",
                ).then((data) => {
                    const rows = (data && data.js) || []
                    return rows
                        .filter((r) => r.id !== "*")
                        .map((genre) => ({
                            id: String(genre.id),
                            name: genre.title || genre.alias || "Canal",
                            mediaType: "live",
                            count: Number(genre.number) || 0,
                        }))
                })
            }
            const mode = mediaType === "movie" ? "vod" : "series"
            return stalkerCall(
                session.endpoint,
                session.mac,
                "action=get_categories&JsHttpRequest=1-xml",
                session.token,
                mode,
            )
                .then(stalkerRows)
                .then((rows) => {
                    return rows
                        .filter((r) => r.id !== "*" && r.category_id !== "*")
                        .map((cat) => ({
                            id: String(cat.id || cat.category_id),
                            name:
                                cat.title ||
                                cat.category_name ||
                                (mediaType === "movie" ? "Films" : "Séries"),
                            mediaType,
                            count: 0,
                        }))
                })
        })
    }

    function loadStalkerCategoryChannels(list, categoryId, mediaType, categoryName, onProgress) {
        mediaType = mediaType || "live"
        return ensureStalkerSession(list).then((session) => {
            const pageSize = 14
            const pagesPerBatch = 4
            const mode = mediaType === "movie" ? "vod" : mediaType === "series" ? "series" : "itv"

            function loadPage(page) {
                let params
                if (mode === "itv") {
                    params = `action=get_ordered_list&genre=${enc(categoryId)}&p=${page}&JsHttpRequest=1-xml`
                } else {
                    params = `action=get_ordered_list&category=${enc(categoryId)}&sortby=added&fav=0&limit=500&p=${page}&JsHttpRequest=1-xml`
                }
                return stalkerCall(session.endpoint, session.mac, params, session.token, mode).then(
                    (data) => {
                        const js = data && data.js
                        const rows = (js && js.data ? js.data : js) || []
                        const total = js && js.total_items ? Number(js.total_items) : 0
                        return { rows: Array.isArray(rows) ? rows : Object.values(rows), total }
                    },
                )
            }

            function mapRow(row) {
                const id = String(row.id || row.series_id || "")
                const cmd =
                    row.cmd ||
                    (Array.isArray(row.cmds) && row.cmds[0] && row.cmds[0].url) ||
                    row.cmds ||
                    ""
                if (mediaType === "movie") {
                    return {
                        name: row.name || row.title || "Film",
                        group: categoryName,
                        categoryId: String(categoryId),
                        logo: row.screenshot_uri || row.logo || row.cover || "",
                        cmd: typeof cmd === "string" ? cmd : "",
                        streamId: id,
                        mediaType: "movie",
                        listId: list.id,
                        url: "",
                        description: row.description || row.plot || row.desc || "",
                        year: row.year || row.releaseDate || "",
                        rating: row.rating_imdb || row.rating || "",
                        duration: row.duration || row.duration_secs || "",
                        genre: row.genres_str || row.genre || "",
                        director: row.director || "",
                        actors: row.actors || "",
                    }
                }
                if (mediaType === "series") {
                    return {
                        name: row.name || row.title || "Série",
                        group: categoryName,
                        categoryId: String(categoryId),
                        logo: row.screenshot_uri || row.logo || row.cover || "",
                        cmd: typeof cmd === "string" ? cmd : "",
                        streamId: id,
                        seriesId: id,
                        mediaType: "series",
                        listId: list.id,
                        url: "",
                        description: row.description || row.plot || row.desc || "",
                        year: row.year || row.releaseDate || "",
                        rating: row.rating_imdb || row.rating || "",
                        duration: row.duration || row.duration_secs || "",
                        genre: row.genres_str || row.genre || "",
                        director: row.director || "",
                        actors: row.actors || "",
                    }
                }
                return {
                    name: row.name || "Canal",
                    group: categoryName,
                    categoryId: String(categoryId),
                    logo: row.logo || row.tv_icon || "",
                    cmd: typeof cmd === "string" ? cmd : "",
                    streamId: id,
                    url: "",
                    mediaType: "live",
                    listId: list.id,
                }
            }

            return loadPage(1).then((firstResult) => {
                const totalItems = firstResult.total || firstResult.rows.length
                const firstBatch = firstResult.rows.map(mapRow)

                if (firstBatch.length < totalItems && firstResult.rows.length >= pageSize) {
                    const maxPreloadPages = Math.min(4, Math.ceil(totalItems / pageSize))
                    let p = 2
                    function stepBackground() {
                        if (p > maxPreloadPages) return
                        const currPage = p++
                        setTimeout(() => {
                            loadPage(currPage)
                                .then((res) => {
                                    if (res.rows && res.rows.length) {
                                        const nextBatch = res.rows.map(mapRow)
                                        if (onProgress) {
                                            onProgress({
                                                items: nextBatch,
                                                page: currPage,
                                                total: totalItems,
                                            })
                                        }
                                    }
                                    stepBackground()
                                })
                                .catch(() => {})
                        }, 120)
                    }
                    stepBackground()
                }

                return {
                    items: firstBatch,
                    total: totalItems,
                }
            })
        })
    }

    function loadXtreamCategories(portal, mediaType) {
        mediaType = mediaType || "live"
        const base = `${portal.origin}/player_api.php?username=${enc(portal.user)}&password=${enc(
            portal.pass,
        )}`
        const action =
            mediaType === "movie"
                ? "get_vod_categories"
                : mediaType === "series"
                  ? "get_series_categories"
                  : "get_live_categories"
        return fetchJson(`${base}&action=${action}`).then((categories) => {
            return (categories || []).map((c) => ({
                id: String(c.category_id),
                name: c.category_name,
                mediaType,
                count: 0,
            }))
        })
    }

    function loadXtreamCategoryChannels(portal, categoryId, mediaType, categoryName, listId) {
        mediaType = mediaType || "live"
        const base = `${portal.origin}/player_api.php?username=${enc(portal.user)}&password=${enc(
            portal.pass,
        )}`
        const action =
            mediaType === "movie"
                ? "get_vod_streams"
                : mediaType === "series"
                  ? "get_series"
                  : "get_live_streams"
        return fetchJson(`${base}&action=${action}&category_id=${enc(categoryId)}`).then(
            (streams) => {
                return (streams || []).map((stream) => {
                    const path = mediaType === "movie" ? "movie" : "live"
                    const suffix =
                        mediaType === "movie" ? stream.container_extension || "mp4" : "ts"
                    const streamId = stream.stream_id || stream.series_id
                    return {
                        name: stream.name || "Canal",
                        group: categoryName,
                        categoryId: String(categoryId),
                        logo: stream.stream_icon || "",
                        streamId: String(streamId || ""),
                        seriesId: mediaType === "series" ? String(streamId || "") : "",
                        mediaType,
                        url:
                            mediaType === "series"
                                ? ""
                                : `${portal.origin}/${path}/${enc(portal.user)}/${enc(portal.pass)}/${streamId}.${suffix}`,
                        portalOrigin: portal.origin,
                        portalUser: portal.user,
                        portalPass: portal.pass,
                        listId,
                        description: stream.plot || stream.description || stream.desc || "",
                        year: stream.year || stream.releaseDate || "",
                        rating: stream.rating || stream.rating_5based || "",
                        duration: stream.duration || stream.duration_secs || "",
                        genre: stream.genre || stream.category_name || "",
                    }
                })
            },
        )
    }

    function loadCategories(list, mediaType, onProgress) {
        if (list.kind === "stalker") {
            return loadStalkerCategories(list, mediaType)
        }
        if (list.kind === "xtream" || list.user) {
            const portal = list.origin
                ? { origin: list.origin, user: list.user, pass: list.pass }
                : parsePortal(list.url, list.user, list.pass)
            if (!portal) return Promise.reject(new Error("Server, username or password missing"))
            return loadXtreamCategories(portal, mediaType)
        }
        return Promise.resolve([])
    }

    function loadCategoryChannels(list, categoryId, mediaType, categoryName, onProgress) {
        if (list.kind === "stalker") {
            return loadStalkerCategoryChannels(
                list,
                categoryId,
                mediaType,
                categoryName,
                onProgress,
            )
        }
        if (list.kind === "xtream" || list.user) {
            const portal = list.origin
                ? { origin: list.origin, user: list.user, pass: list.pass }
                : parsePortal(list.url, list.user, list.pass)
            if (!portal) return Promise.reject(new Error("Server, username or password missing"))
            return loadXtreamCategoryChannels(
                portal,
                categoryId,
                mediaType,
                categoryName,
                list.id,
            )
        }
        return Promise.resolve([])
    }

    function loadStalker(list, onProgress, mediaType) {
        const portal = (list.origin || "").replace(/\/+$/, "")
        const mac = list.mac
        if (!portal || !mac) return Promise.reject(new Error("Portal or MAC missing"))

        if (onProgress) onProgress({ label: "Fetching categories" })
        return firstEndpoint(stalkerEndpoints(portal), (endpoint) => {
            return stalkerCall(endpoint, mac, "action=handshake&prehash=0")
        }).then((hello) => {
            const token = (hello.value && hello.value.js && hello.value.js.token) || ""
            if (!token) throw new Error("The portal gave no token (MAC not authorised?)")
            // What a real set-top box does, and strict portals refuse the content calls
            // until the session is opened here. Both the token and the endpoint that
            // answered are kept on the list: create_link needs them later.
            list.token = token
            list.endpoint = hello.endpoint
            if (onProgress) onProgress({ label: "Downloading" })
            return new Promise((resolve) => setTimeout(resolve, 350))
                .then(() => stalkerCall(hello.endpoint, mac, "action=get_profile", token).catch(() => {}))
                .then(() => new Promise((resolve) => setTimeout(resolve, 350)))
                .then(() => {
                    if (mediaType && mediaType !== "live") {
                        const mode = mediaType === "movie" ? "vod" : "series"
                        return loadStalkerMedia(
                            hello.endpoint,
                            mac,
                            token,
                            mode,
                            mediaType,
                            onProgress,
                            0,
                        )
                    }
                    const loadLive = () => {
                        return Promise.all([
                            stalkerCall(
                                hello.endpoint,
                                mac,
                                "action=get_all_channels",
                                token,
                                "itv",
                            ),
                            stalkerCall(
                                hello.endpoint,
                                mac,
                                "action=get_genres",
                                token,
                                "itv",
                            ).catch(() => ({ js: [] })),
                        ]).then((results) => {
                            const genres = {}
                            ;(results[1] && results[1].js ? results[1].js : []).forEach((genre) => {
                                genres[String(genre.id)] = genre.title
                            })
                            const data = results[0]
                            const rows =
                                data && data.js && data.js.data
                                    ? data.js.data
                                    : (data && data.js) || []
                            if (!rows.length) throw new Error("The portal returned no channels")
                            return rows.map((row) => ({
                                name: row.name || "Canal",
                                group: genres[String(row.tv_genre_id)] || "Otros",
                                logo: row.logo || row.tv_icon || "",
                                cmd: row.cmd || row.cmds || "",
                                streamId: String(row.id || ""),
                                url: "",
                                mediaType: "live",
                            }))
                        })
                    }

                    if (mediaType === "live") return loadLive()
                    return Promise.all([
                        loadLive(),
                        loadStalkerMedia(hello.endpoint, mac, token, "vod", "movie", onProgress, 0),
                        loadStalkerMedia(
                            hello.endpoint,
                            mac,
                            token,
                            "series",
                            "series",
                            onProgress,
                            0,
                        ),
                    ]).then((results) => results[0].concat(results[1], results[2]))
                })
        })
    }

    function stalkerRows(data) {
        const body = data && data.js
        const rows = body && body.data ? body.data : body
        if (Array.isArray(rows)) return rows
        return rows && typeof rows === "object" ? Object.keys(rows).map((key) => rows[key]) : []
    }

    function loadStalkerMedia(endpoint, mac, token, mode, mediaType, onProgress, initialCount) {
        const categories = {}
        const pageSize = 14
        // MAC portals commonly return only 14 rows per page even when limit=500.
        // Fetch several pages together so large movie catalogs take fewer round trips.
        const pagesPerBatch = 4
        const all = []
        const seen = Object.create(null)
        const loadCategories = stalkerCall(
            endpoint,
            mac,
            "action=get_categories&JsHttpRequest=1-xml",
            token,
            mode,
        )
            .then(stalkerRows)
            .catch(() => [])

        function loadPage(page) {
            const params = `action=get_ordered_list&category=*&sortby=added&fav=0&limit=500&p=${page}&JsHttpRequest=1-xml`
            return stalkerCall(endpoint, mac, params, token, mode).then(stalkerRows)
        }

        function addRows(batch) {
            const added = []
            batch.forEach((row) => {
                const id = String(row.id || row.series_id || "")
                const cmd = row.cmd || row.cmds || ""
                if (!id && !cmd) return
                const key = `${id}|${cmd}|${row.name || row.title || ""}`
                if (seen[key]) return
                seen[key] = true
                const item = {
                    name: row.name || row.title || (mediaType === "movie" ? "Film" : "Série"),
                    group:
                        categories[String(row.category_id || row.genre_id || "*")] ||
                        row.genre ||
                        (mediaType === "movie" ? "Films" : "Séries"),
                    logo: row.screenshot_uri || row.logo || row.cover || "",
                    cmd: typeof cmd === "string" ? cmd : "",
                    streamId: id,
                    seriesId: mediaType === "series" ? id : "",
                    mediaType,
                    url: "",
                }
                all.push(item)
                added.push(item)
            })
            if (onProgress && added.length)
                onProgress({
                    label: "Downloading",
                    count: (initialCount || 0) + all.length,
                    items: added,
                    mediaType,
                    complete: false,
                })
        }

        function pageKey(batch) {
            return batch
                .map((row) => `${row.id || row.series_id || ""}|${row.cmd || row.cmds || ""}`)
                .join("\u001f")
        }

        function next(page, previousPage) {
            const requests = []
            for (let offset = 0; offset < pagesPerBatch; offset++)
                requests.push(
                    loadPage(page + offset).then(
                        (batch) => ({ batch }),
                        (error) => ({ error }),
                    ),
                )
            return Promise.all(requests).then((results) => {
                let lastPage = previousPage
                let finished = false
                for (let index = 0; index < results.length; index++) {
                    if (results[index].error) throw results[index].error
                    const batch = results[index].batch || []
                    if (!batch.length) {
                        finished = true
                        break
                    }
                    const currentKey = pageKey(batch)
                    if (currentKey === lastPage) {
                        throw new Error(
                            `The portal repeated a ${mediaType} catalog page; the list may be incomplete`,
                        )
                    }
                    lastPage = currentKey
                    addRows(batch)
                    if (batch.length < pageSize) {
                        finished = true
                        break
                    }
                }
                if (finished) return all
                return next(page + pagesPerBatch, lastPage)
            })
        }

        return Promise.all([loadCategories, loadPage(1)]).then((results) => {
            results[0].forEach((row) => {
                const id = String(row.id || row.category_id || "*")
                categories[id] =
                    row.title || row.category_name || (mediaType === "movie" ? "Films" : "Séries")
            })
            const firstPage = results[1] || []
            if (!firstPage.length) {
                if (onProgress) onProgress({ label: "Preparing", mediaType, complete: true })
                return all
            }
            addRows(firstPage)
            const remaining =
                firstPage.length < pageSize ? Promise.resolve(all) : next(2, pageKey(firstPage))
            return remaining.then((items) => {
                if (onProgress) onProgress({ label: "Preparing", mediaType, complete: true })
                return items
            })
        })
    }

    function resolveStalkerUrl(list, channel) {
        const rawCmd = (channel.cmd || "").trim()
        const mode =
            channel.mediaType === "movie"
                ? "vod"
                : channel.mediaType === "series"
                  ? "series"
                  : "itv"
        const key = [list.endpoint || list.origin, list.mac, list.token || "", mode, rawCmd].join(
            "|",
        )
        const cached = stalkerLinkCache[key]
        if (cached && cached.expires > Date.now()) return cached.promise
        if (cached) delete stalkerLinkCache[key]
        const promise = resolveStalkerUrlRemote(list, channel)
        stalkerLinkCache[key] = { promise, expires: Date.now() + 600000 }
        promise.then(
            () => {
                if (stalkerLinkCache[key] && stalkerLinkCache[key].promise === promise)
                    stalkerLinkCache[key].expires = Date.now() + 600000
            },
            () => {
                if (stalkerLinkCache[key] && stalkerLinkCache[key].promise === promise)
                    delete stalkerLinkCache[key]
            },
        )
        return promise
    }

    const stalkerLinkCache = Object.create(null)

    function clearStalkerCache() {
        for (const k in stalkerLinkCache) {
            delete stalkerLinkCache[k]
        }
    }

    function resolveStalkerUrlRemote(list, channel) {
        const rawCmd = (channel.cmd || "").trim()
        const directMatch =
            rawCmd.match(/^ffmpeg\s+(https?:\/\/.+)$/i) || rawCmd.match(/^(https?:\/\/.+)$/i)

        if (directMatch && directMatch[1] && directMatch[1].indexOf("stream=") !== -1) {
            return Promise.resolve(directMatch[1].trim())
        }

        const endpoint = list.endpoint || `${(list.origin || "").replace(/\/+$/, "")}/portal.php`
        const mode =
            channel.mediaType === "movie"
                ? "vod"
                : channel.mediaType === "series"
                  ? "series"
                  : "itv"
        const cmdParam = directMatch
            ? channel.streamId
                ? `auto /media/${channel.streamId}.mpg`
                : rawCmd
            : rawCmd
        return stalkerCall(
            endpoint,
            list.mac,
            `action=create_link&cmd=${enc(cmdParam)}&JsHttpRequest=1-xml`,
            list.token,
            mode,
            15000,
        )
            .then((data) => {
                const js = data && data.js
                const first = Array.isArray(js) ? js[0] : js && js.data ? js.data : js
                let cmd =
                    typeof first === "string"
                        ? first
                        : first && (first.cmd || first.url || first.stream_url)
                if (!cmd && directMatch) return directMatch[1]
                if (!cmd) throw new Error("The portal returned no stream address")
                cmd = cmd.replace(/^ffmpeg\s+/i, "").replace(/^auto\s+/i, "")
                if (cmd.indexOf("stream=&") !== -1 || cmd.endsWith("stream=")) {
                    const streamParam = rawCmd.match(/stream=([0-9a-zA-Z_-]+)/)
                    if (streamParam) {
                        cmd = cmd.replace(/stream=(&|$)/, `stream=${streamParam[1]}$1`)
                    }
                }
                return cmd
            })
            .catch((err) => {
                if (directMatch) return directMatch[1]
                throw err
            })
    }

    function resolveStalkerSeriesUrl(list, series) {
        const endpoint = list.endpoint || `${(list.origin || "").replace(/\/+$/, "")}/portal.php`
        const id = series.seriesId || series.streamId
        const attempts = ["movie_id", "series_id"]
        let idx = 0
        function seasonRequest() {
            if (idx >= attempts.length)
                return Promise.reject(new Error("No episodes were returned for this series"))
            const key = attempts[idx++]
            return stalkerCall(
                endpoint,
                list.mac,
                `action=get_ordered_list&${key}=${enc(id)}&category=*&p=1&JsHttpRequest=1-xml`,
                list.token,
                "series",
            )
                .then((data) => {
                    const season = stalkerRows(data).filter(
                        (row) => row && row.cmd && Array.isArray(row.series) && row.series.length,
                    )[0]
                    if (!season) return seasonRequest()
                    const episode = season.series[0]
                    const params = `action=create_link&cmd=${enc(season.cmd)}&series=${enc(episode)}&forced_storage=false&disable_ad=false&download=false&JsHttpRequest=1-xml`
                    return stalkerCall(endpoint, list.mac, params, list.token, "vod", 15000).then(
                        (result) => {
                            const js = result && result.js
                            const item = Array.isArray(js) ? js[0] : js && js.data ? js.data : js
                            const url =
                                typeof item === "string"
                                    ? item
                                    : item && (item.cmd || item.url || item.stream_url)
                            if (!url) throw new Error("The portal did not resolve this episode")
                            return url.replace(/^ffmpeg\s+/i, "").replace(/^auto\s+/i, "")
                        },
                    )
                })
                .catch((error) => {
                    if (idx < attempts.length) return seasonRequest()
                    throw error
                })
        }
        return seasonRequest()
    }

    function parseAuto(text, name) {
        const value = (text || "").trim()
        if (!value) return { error: "Paste the address, the credentials or the playlist text" }

        if (/^#EXTM3U/i.test(value) || /#EXTINF/i.test(value)) {
            return {
                list: { kind: "m3u", source: "text", text: value, name: name || "Pasted list" },
            }
        }

        const macMatch = value.match(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/i)
        const urlMatch = value.match(/https?:\/\/[^\s"'<>]+/i)
        const userMatch = value.match(/(?:user(?:name)?|usuario)\s*[:=]\s*([^\s,;]+)/i)
        const passMatch = value.match(
            /(?:pass(?:word)?|contrase(?:n|ñ)a|clave)\s*[:=]\s*([^\s,;]+)/i,
        )

        if (macMatch && urlMatch) {
            return {
                list: {
                    kind: "stalker",
                    source: "mac",
                    mac: macMatch[0].toUpperCase(),
                    origin: originOf(urlMatch[0]) || urlMatch[0].replace(/\/+$/, ""),
                    name: name || hostOf(urlMatch[0]),
                },
            }
        }

        if (urlMatch) {
            const url = urlMatch[0]
            const inline = parseXtreamUrl(url)
            if (inline) {
                return {
                    list: {
                        kind: "xtream",
                        source: "url",
                        url,
                        name: name || hostOf(url),
                        user: inline.user,
                        pass: inline.pass,
                        origin: inline.origin,
                    },
                }
            }
            if (userMatch && passMatch) {
                const origin = originOf(url) || url
                return {
                    list: {
                        kind: "xtream",
                        source: "creds",
                        origin,
                        user: userMatch[1],
                        pass: passMatch[1],
                        name: name || hostOf(origin),
                    },
                }
            }
            return { list: { kind: "m3u", source: "url", url, name: name || hostOf(url) } }
        }

        return { error: "No playlist, portal or MAC found in that text" }
    }

    function load(list, onProgress, mediaType) {
        if (!list) return Promise.reject(new Error("Unknown source"))

        if (list.kind === "stalker") {
            return loadStalker(list, onProgress, mediaType).then((channels) => {
                return channels
            })
        }

        if (list.kind === "xtream" || list.user) {
            const portal = list.origin
                ? { origin: list.origin, user: list.user, pass: list.pass }
                : parsePortal(list.url, list.user, list.pass)
            if (!portal) return Promise.reject(new Error("Server, username or password missing"))
            return loadXtream(portal, onProgress, mediaType)
        }

        if (list.source === "text") return loadM3uText(list.text, onProgress)
        if (list.source === "url" || list.url) return loadM3uUrl(list.url, onProgress)
        return Promise.reject(new Error("I do not know how to load that source"))
    }

    function match(channels, query) {
        const needle = (query || "").trim().toLowerCase()
        if (!needle) return channels
        const found = []
        for (let i = 0; i < channels.length; i++) {
            const channel = channels[i]
            if (channel.searchKey === undefined) channel.searchKey = channel.name.toLowerCase()
            if (channel.searchKey.indexOf(needle) !== -1) found.push(channel)
        }
        return found
    }

    return {
        load,
        checkServer,
        loadCategories,
        loadCategoryChannels,
        ensureStalkerSession,
        loadStalkerCategories,
        loadStalkerCategoryChannels,
        match,
        parseM3u,
        parseXtreamUrl,
        parsePortal,
        parseLiveUrl,
        parseAuto,
        loadNowPlaying,
        resolveSeries,
        getSeriesEpisodes,
        resolveStalkerEpisode,
        resolveStalkerUrl,
        resolveStalkerSeriesUrl,
        clearStalkerCache,
        hostOf,
        originOf,
    }
})()
