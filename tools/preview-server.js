const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { exec } = require("child_process")

function getLocalIp() {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal && (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") || iface.address.startsWith("172."))) {
                return iface.address
            }
        }
    }
    return "127.0.0.1"
}

const ROOT = path.dirname(__dirname)
const PORT = Number(process.env.PORT) || 8090

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".xml": "application/xml",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".mp4": "video/mp4",
    ".ts": "video/mp2t",
    ".mkv": "video/x-matroska",
    ".m3u8": "application/vnd.apple.mpegurl",
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, keepAliveMsecs: 60000 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, keepAliveMsecs: 60000 })

const clientLiveStreams = new Map()

function getClientKey(req) {
    const remote = (req.socket && req.socket.remoteAddress) || "local"
    const ua = req.headers["user-agent"] || ""
    return `${remote}:${ua}`
}

function killActiveLiveStream(clientKey) {
    if (clientKey) {
        const stream = clientLiveStreams.get(clientKey)
        if (stream) {
            try {
                if (stream.req) stream.req.destroy()
            } catch (e) {}
            try {
                if (stream.res) stream.res.destroy()
            } catch (e) {}
            clientLiveStreams.delete(clientKey)
        }
    } else {
        for (const stream of clientLiveStreams.values()) {
            try {
                if (stream.req) stream.req.destroy()
            } catch (e) {}
            try {
                if (stream.res) stream.res.destroy()
            } catch (e) {}
        }
        clientLiveStreams.clear()
    }
}

function proxyRequest(req, res, targetUrl) {
    let parsed
    try {
        parsed = new URL(targetUrl)
    } catch {
        res.writeHead(400, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" })
        res.end("Invalid URL")
        return
    }

    const isVodReq =
        req.url.indexOf("stream=0") !== -1 ||
        !!req.headers["range"] ||
        /\.(mp4|mkv|avi|mov|webm)(\?|$)/i.test(targetUrl) ||
        /\/movie\//i.test(targetUrl) ||
        /\/series\//i.test(targetUrl)

    // Only continuous infinite streams (like raw MPEG-TS direct feeds) kill previous stream on channel switch.
    // HLS playlists (.m3u8), segments (.ts, .php), and VOD range requests MUST NEVER kill active connections!
    const isChunkOrPlaylist =
        /\.m3u8(\?|$)/i.test(targetUrl) ||
        /\.ts(\?|$)/i.test(targetUrl) ||
        targetUrl.includes(".php") ||
        isVodReq

    const isLiveStream =
        !isVodReq &&
        !isChunkOrPlaylist &&
        (req.url.indexOf("stream=1") !== -1 || req.headers["x-stream-request"] === "1")

    const clientKey = getClientKey(req)
    if (isLiveStream && !req._isRedirect) {
        killActiveLiveStream(clientKey)
    }

    // Disable socket timeouts and enable TCP NoDelay for continuous video streaming
    if (req.socket) {
        req.socket.setTimeout(0)
        req.socket.setNoDelay(true)
        req.socket.setKeepAlive(true, 10000)
    }
    if (res.socket) {
        res.socket.setTimeout(0)
        res.socket.setNoDelay(true)
    }

    const client = parsed.protocol === "https:" ? https : http

    const isModernWebStream =
        targetUrl.includes("yacine") ||
        targetUrl.includes("redirect") ||
        targetUrl.includes("cloudarven") ||
        targetUrl.includes("dami") ||
        targetUrl.includes("wedd48c") ||
        targetUrl.includes("dembed")

    const headers = {
        "User-Agent":
            req.headers["x-target-user-agent"] ||
            (isModernWebStream
                ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                : "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3"),
        "Accept": "*/*",
    }
    if (req.headers["range"]) {
        headers["Range"] = req.headers["range"]
    }
    if (req.headers["x-target-cookie"]) {
        headers["Cookie"] = req.headers["x-target-cookie"]
    }
    if (req.headers["x-target-referer"]) {
        headers["Referer"] = req.headers["x-target-referer"]
    } else if (isModernWebStream && !headers["Referer"]) {
        headers["Referer"] = "https://yacine.website/"
    }
    if (req.headers["authorization"]) {
        headers["Authorization"] = req.headers["authorization"]
    }
    if (req.headers["content-type"]) {
        headers["Content-Type"] = req.headers["content-type"]
    }

    const options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers: headers,
        agent: parsed.protocol === "https:" ? httpsAgent : httpAgent,
        timeout: 0, // No timeout for live streams
    }

    let activeProxyRes = null

    const proxyReq = client.request(options, (proxyRes) => {
        activeProxyRes = proxyRes
        if (isLiveStream) {
            const streamObj = clientLiveStreams.get(clientKey) || {}
            streamObj.res = proxyRes
            clientLiveStreams.set(clientKey, streamObj)
        }

        if (proxyRes.statusCode === 429 && (!req._retries || req._retries < 3)) {
            req._retries = (req._retries || 0) + 1
            setTimeout(() => {
                proxyRequest(req, res, targetUrl)
            }, 1000)
            return
        }

        // Handle stream redirects (301, 302, 307, 308)
        if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
            let nextUrl = proxyRes.headers.location
            if (!/^https?:\/\//i.test(nextUrl)) {
                nextUrl = new URL(nextUrl, targetUrl).toString()
            }
            req._isRedirect = true
            proxyRequest(req, res, nextUrl)
            return
        }

        const outHeaders = Object.assign({}, proxyRes.headers)
        outHeaders["access-control-allow-origin"] = "*"
        outHeaders["access-control-allow-methods"] = "GET, POST, OPTIONS, HEAD"
        outHeaders["access-control-allow-headers"] = "*"
        outHeaders["access-control-expose-headers"] =
            "Content-Length, Content-Range, Accept-Ranges, Content-Type"
        outHeaders["cache-control"] = "no-cache, no-store, must-revalidate"
        outHeaders["pragma"] = "no-cache"

        if (!outHeaders["accept-ranges"]) {
            outHeaders["accept-ranges"] = "bytes"
        }

        res.writeHead(proxyRes.statusCode, outHeaders)

        proxyRes.on("error", (err) => {
            console.warn("[Upstream Stream Error]:", err.message)
            try {
                res.end()
            } catch {}
        })

        proxyRes.pipe(res)
    })

    if (isLiveStream) {
        const streamObj = clientLiveStreams.get(clientKey) || {}
        streamObj.req = proxyReq
        clientLiveStreams.set(clientKey, streamObj)
    }

    proxyReq.on("socket", (sock) => {
        sock.setNoDelay(true)
        sock.setTimeout(0)
        sock.setKeepAlive(true, 10000)
    })

    res.on("close", () => {
        try {
            proxyReq.destroy()
        } catch {}
        try {
            if (activeProxyRes) activeProxyRes.destroy()
        } catch {}
        if (isLiveStream) {
            const current = clientLiveStreams.get(clientKey)
            if (current && (current.req === proxyReq || current.res === activeProxyRes)) {
                clientLiveStreams.delete(clientKey)
            }
        }
    })

    proxyReq.on("error", (err) => {
        if (res.headersSent) return
        console.error("[Proxy Error]", targetUrl, err.message)
        res.writeHead(502, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        })
        res.end(JSON.stringify({ error: err.message }))
    })

    req.pipe(proxyReq)
}

const yacineStreamCache = new Map()
const yacineLastValidPlaylist = new Map()

function fetchYacineUrl(targetUrl, referer = "https://yacine.website/") {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl)
        const client = parsed.protocol === "https:" ? https : http
        const req = client.get(
            targetUrl,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    Referer: referer,
                    Accept: "*/*",
                },
                timeout: 15000,
            },
            (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    let loc = res.headers.location
                    if (!/^https?:\/\//i.test(loc)) loc = new URL(loc, targetUrl).toString()
                    return fetchYacineUrl(loc, referer).then(resolve).catch(reject)
                }
                let data = ""
                res.on("data", (chunk) => (data += chunk))
                res.on("end", () => {
                    if (res.statusCode >= 200 && res.statusCode < 400) {
                        resolve({ statusCode: res.statusCode, body: data, headers: res.headers })
                    } else {
                        reject(new Error("HTTP " + res.statusCode))
                    }
                })
            }
        )
        req.on("error", reject)
        req.on("timeout", () => {
            req.destroy()
            reject(new Error("Request timeout"))
        })
    })
}

async function handleYacineStream(req, res) {
    try {
        const u = new URL(req.url, "http://127.0.0.1")
        const id = u.searchParams.get("id") || "6217599430189993723"
        const qualityPref = (u.searchParams.get("q") || "1080p").toLowerCase()
        const now = Date.now()

        let meta = yacineStreamCache.get(id)
        if (!meta || now - meta.time > 180000) {
            const apiRes = await fetchYacineUrl(`https://yacine.website/?get_channel_stream=${encodeURIComponent(id)}`)
            const parsed = JSON.parse(apiRes.body)
            if (parsed.status !== "success") {
                throw new Error("Yacine API status not success")
            }
            meta = { parsed, time: now }
            yacineStreamCache.set(id, meta)
        }

        const qualities = meta.parsed.qualities || []
        let chosenUrl = ""
        for (const q of qualities) {
            const qLower = (q.name || "").toLowerCase()
            if (qLower.includes(qualityPref)) {
                chosenUrl = q.url
                break
            }
        }
        if (!chosenUrl && qualities.length > 0) {
            chosenUrl = qualities[0].url
        }
        if (!chosenUrl) {
            chosenUrl = meta.parsed.url || ""
        }
        if (!chosenUrl) {
            throw new Error("No stream URL found in Yacine metadata")
        }

        const fullPlayUrl = chosenUrl.startsWith("http")
            ? chosenUrl
            : `https://yacine.website${chosenUrl.startsWith("/") ? "" : "/"}${chosenUrl}`

        let m3u8Res
        try {
            m3u8Res = await fetchYacineUrl(fullPlayUrl, "https://yacine.website/")
        } catch (fetchErr) {
            yacineStreamCache.delete(id)
            const retryApi = await fetchYacineUrl(`https://yacine.website/?get_channel_stream=${encodeURIComponent(id)}`)
            const retryParsed = JSON.parse(retryApi.body)
            const freshUrl =
                (retryParsed.qualities && retryParsed.qualities[0] && retryParsed.qualities[0].url) || retryParsed.url
            if (freshUrl) {
                const freshFull = freshUrl.startsWith("http")
                    ? freshUrl
                    : `https://yacine.website${freshUrl.startsWith("/") ? "" : "/"}${freshUrl}`
                m3u8Res = await fetchYacineUrl(freshFull, "https://yacine.website/")
            } else {
                throw fetchErr
            }
        }

        const rawM3u8 = m3u8Res.body || ""
        if (!rawM3u8.includes("#EXTM3U") && !rawM3u8.includes("#EXTINF")) {
            const fallback = yacineLastValidPlaylist.get(id)
            if (fallback) {
                res.writeHead(200, {
                    "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                })
                res.end(fallback)
                return
            }
            throw new Error("Invalid M3U8 content received from Yacine")
        }

        const lines = rawM3u8.split("\n")
        const rewritten = []
        for (let line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            if (trimmed.startsWith("#")) {
                rewritten.push(line)
            } else {
                let chunkUrl = trimmed
                if (trimmed.startsWith("/")) {
                    chunkUrl = `https://yacine.website${trimmed}`
                } else if (!trimmed.startsWith("http")) {
                    chunkUrl = `https://yacine.website/${trimmed}`
                }
                const proxiedChunk = `/proxy?stream=1&ref=${encodeURIComponent("https://yacine.website/")}&url=${encodeURIComponent(chunkUrl)}`
                rewritten.push(proxiedChunk)
            }
        }

        const finalPlaylist = rewritten.join("\n")
        yacineLastValidPlaylist.set(id, finalPlaylist)

        res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        })
        res.end(finalPlaylist)
    } catch (err) {
        console.warn("[Yacine Stream Error]:", err.message)
        const fallback = yacineLastValidPlaylist.get(req.url)
        if (fallback) {
            res.writeHead(200, {
                "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
            })
            res.end(fallback)
            return
        }
        res.writeHead(502, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        })
        res.end(JSON.stringify({ error: "Flux Yacine temporairement indisponible", details: err.message }))
    }
}

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
    res.setHeader("Access-Control-Allow-Headers", "*")

    if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
    }

    if (req.url === "/kill-stream" || req.url.startsWith("/kill-stream")) {
        const clientKey = getClientKey(req)
        killActiveLiveStream(clientKey)
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        })
        res.end(JSON.stringify({ ok: true, message: "Stream stopped" }))
        return
    }

    if (req.url.startsWith("/yacine/play.m3u8") || req.url.startsWith("/yacine/live")) {
        handleYacineStream(req, res)
        return
    }

    if (req.url.startsWith("/proxy")) {
        let targetUrl = ""
        let refParam = ""
        try {
            const u = new URL(req.url, "http://127.0.0.1")
            refParam = u.searchParams.get("ref") || ""
            targetUrl = u.searchParams.get("url") || ""
        } catch {}
        if (!targetUrl) {
            const urlParamIdx = req.url.indexOf("url=")
            if (urlParamIdx !== -1) {
                targetUrl = decodeURIComponent(req.url.slice(urlParamIdx + 4))
            }
        }
        if (!targetUrl) {
            res.writeHead(400, { "Content-Type": "text/plain" })
            res.end("Missing target url")
            return
        }
        if (refParam) {
            req.headers["x-target-referer"] = refParam
        }
        proxyRequest(req, res, targetUrl)
        return
    }

    let reqPath = decodeURIComponent(req.url.split("?")[0])
    if (reqPath === "/" || reqPath === "") reqPath = "/index.html"

    const filePath = path.resolve(ROOT, reqPath.replace(/^\/+/, ""))
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { "Content-Type": "text/plain" })
        res.end("403 Forbidden")
        return
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("404 Not Found")
            return
        }

        const ext = path.extname(filePath).toLowerCase()
        const contentType = MIME[ext] || "application/octet-stream"

        res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stats.size,
            "Cache-Control": "no-cache",
        })
        fs.createReadStream(filePath).pipe(res)
    })
})

// Disable default Node.js 2-minute server timeout for continuous streaming
server.timeout = 0
server.keepAliveTimeout = 60000

server.listen(PORT, "0.0.0.0", () => {
    const localIp = getLocalIp()
    const url = `http://localhost:${PORT}`
    const tvUrl = `http://${localIp}:${PORT}`
    console.log(`\n==================================================`)
    console.log(`[OK] Family Web Stream - Serveur demarre avec succes !`)
    console.log(`[PC Local]    ${url}`)
    console.log(`[Smart TV]    ${tvUrl}   <-- Ouvrez cette adresse sur votre TV !`)
    console.log(`==================================================`)
    console.log(`Navigation 100% Compatible Telecommande & Clavier PC :`)
    console.log(`  - Fleches Directionnelles : Deplacement fluide`)
    console.log(`  - Entree (Enter)          : Touche OK (Valider)`)
    console.log(`  - Echap (Esc) / Retour    : Touche Retour TV (Back)`)
    console.log(`  - Espace (Space)          : Pause / Lecture`)
    console.log(`  - Touche 'R'              : Bouton Rouge TV (Favoris)`)
    console.log(`  - PageUp / PageDown       : Chaine + / Chaine -`)
    console.log(`  - Chiffres 0-9            : Saisie Code PIN / Chaines`)
    console.log(`==================================================\n`)

    if (process.platform === "win32" && !process.env.RENDER && !process.env.PORT) {
        const browserUserData = path.join(process.env.TEMP || "C:\\Temp", "family_web_stream_dev")
        const flags = `--app="${url}" --window-size=1280,720 --disable-web-security --user-data-dir="${browserUserData}"`

        exec(`start msedge ${flags}`, (err) => {
            if (err) {
                exec(`start chrome ${flags}`, (err2) => {
                    if (err2) exec(`start "" "${url}"`)
                })
            }
        })
    }
})
