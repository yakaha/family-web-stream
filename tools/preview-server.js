const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { exec } = require("child_process")
const { EventEmitter } = require("events")

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
    // Also immediately destroy any shared stream with 0 active clients
    for (const [url, shared] of sharedLiveStreams.entries()) {
        if (!shared.clients || shared.clients.size === 0) {
            shared.destroy()
        }
    }
}

// Shared upstream live broadcaster: distributes 1 single upstream connection to N clients
const sharedLiveStreams = new Map()

class SharedLiveStream {
    constructor(targetUrl, options, client) {
        this.targetUrl = targetUrl
        this.options = options
        this.client = client
        this.clients = new Set()
        this.proxyReq = null
        this.proxyRes = null
        this.headers = null
        this.statusCode = 200
        this.patPmtPackets = null
        this.recentChunks = []
        this.recentBytes = 0
        this.destroyTimer = null
        this.isDestroyed = false
        this.start()
    }

    start() {
        this.proxyReq = this.client.request(this.options, (proxyRes) => {
            this.proxyRes = proxyRes
            this.statusCode = proxyRes.statusCode

            if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                let nextUrl = proxyRes.headers.location
                if (!/^https?:\/\//i.test(nextUrl)) {
                    nextUrl = new URL(nextUrl, this.targetUrl).toString()
                }
                this.targetUrl = nextUrl
                try {
                    const nextParsed = new URL(nextUrl)
                    this.options.hostname = nextParsed.hostname
                    this.options.port = nextParsed.port || (nextParsed.protocol === "https:" ? 443 : 80)
                    this.options.path = nextParsed.pathname + nextParsed.search
                    this.client = nextParsed.protocol === "https:" ? https : http
                    this.start()
                } catch (e) {
                    console.error("[Shared Stream Redirect Error]:", e.message)
                }
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
            this.headers = outHeaders

            for (const clientRes of this.clients) {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(this.statusCode, this.headers)
                }
            }

            proxyRes.on("data", (chunk) => {
                if (this.isDestroyed) return

                // Extract PAT/PMT packets to send to any new client joining the stream
                if (!this.patPmtPackets && chunk.length >= 376) {
                    for (let i = 0; i <= chunk.length - 188; i += 188) {
                        if (chunk[i] === 0x47) {
                            const pid = ((chunk[i + 1] & 0x1f) << 8) | chunk[i + 2]
                            if (pid === 0) {
                                this.patPmtPackets = Buffer.from(chunk.subarray(i, Math.min(chunk.length, i + 188 * 3)))
                                break
                            }
                        }
                    }
                }

                // Keep rolling buffer of recent ~256KB
                this.recentChunks.push(chunk)
                this.recentBytes += chunk.length
                while (this.recentBytes > 256 * 1024 && this.recentChunks.length > 1) {
                    const dropped = this.recentChunks.shift()
                    this.recentBytes -= dropped.length
                }

                for (const clientRes of this.clients) {
                    try {
                        clientRes.write(chunk)
                    } catch (e) {
                        this.removeClient(clientRes)
                    }
                }
            })

            proxyRes.on("end", () => {
                this.destroy()
            })

            proxyRes.on("error", (err) => {
                console.warn("[Shared Stream Error]:", err.message)
                this.destroy()
            })
        })

        this.proxyReq.on("socket", (sock) => {
            sock.setNoDelay(true)
            sock.setTimeout(0)
            sock.setKeepAlive(true, 10000)
        })

        this.proxyReq.on("error", (err) => {
            console.error("[Shared Stream ProxyReq Error]:", err.message)
            this.destroy()
        })

        this.proxyReq.end()
    }

    addClient(req, res) {
        if (this.destroyTimer) {
            clearTimeout(this.destroyTimer)
            this.destroyTimer = null
        }
        this.clients.add(res)

        if (this.headers && !res.headersSent) {
            res.writeHead(this.statusCode, this.headers)
            if (this.patPmtPackets) {
                try { res.write(this.patPmtPackets) } catch {}
            }
            for (const ch of this.recentChunks) {
                try { res.write(ch) } catch {}
            }
        }

        res.on("close", () => {
            this.removeClient(res)
        })
    }

    removeClient(res) {
        this.clients.delete(res)
        if (this.clients.size === 0) {
            if (!this.destroyTimer) {
                this.destroyTimer = setTimeout(() => {
                    this.destroy()
                }, 4000)
            }
        }
    }

    destroy() {
        this.isDestroyed = true
        if (this.destroyTimer) {
            clearTimeout(this.destroyTimer)
            this.destroyTimer = null
        }
        try { if (this.proxyRes) this.proxyRes.destroy() } catch {}
        try { if (this.proxyReq) this.proxyReq.destroy() } catch {}
        for (const c of this.clients) {
            try { c.end() } catch {}
        }
        this.clients.clear()
        this.recentChunks = []
        sharedLiveStreams.delete(this.targetUrl)
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
    if (isModernWebStream || targetUrl.includes("yacine")) {
        headers["X-Forwarded-For"] = YACINE_MENA_IP
        headers["X-Real-IP"] = YACINE_MENA_IP
        headers["CF-Connecting-IP"] = YACINE_MENA_IP
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

    // Shared upstream broadcaster: if 2 devices / tabs / previews request the same live stream,
    // they share the EXACT SAME single upstream connection. Zero multi-connection risk!
    if (isLiveStream) {
        let shared = sharedLiveStreams.get(targetUrl)
        if (!shared || shared.isDestroyed) {
            shared = new SharedLiveStream(targetUrl, options, client)
            sharedLiveStreams.set(targetUrl, shared)
        }
        shared.addClient(req, res)
        return
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
const YACINE_MENA_IP = "105.101.50.12" // IP MENA / Algérie pour débloquer les droits géographiques de diffusion

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
                    "X-Forwarded-For": YACINE_MENA_IP,
                    "X-Real-IP": YACINE_MENA_IP,
                    "CF-Connecting-IP": YACINE_MENA_IP,
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
            let parsed
            try {
                parsed = JSON.parse(apiRes.body)
            } catch (e) {
                throw new Error(`Format Yacine invalide (HTTP ${apiRes.statusCode}): ${apiRes.body.slice(0, 150)}`)
            }
            if (parsed.status !== "success") {
                throw new Error(`Yacine API: ${parsed.message || parsed.status || "Statut non supporté"}`)
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
                const proxiedChunk = `/proxy/chunk.ts?stream=1&ref=${encodeURIComponent("https://yacine.website/")}&url=${encodeURIComponent(chunkUrl)}`
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

class TsHlsSession extends EventEmitter {
    constructor(targetUrl) {
        super()
        this.targetUrl = targetUrl
        this.segments = new Map()
        this.sequence = 0
        this.currentBuffer = []
        this.currentBytes = 0
        this.patPmtPackets = null
        this.lastAccess = Date.now()
        this.isDestroyed = false
        this.req = null
        this.res = null
        this.startStream()
    }

    startStream() {
        try {
            const parsed = new URL(this.targetUrl)
            const client = parsed.protocol === "https:" ? https : http
            const options = {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
                    "Accept": "*/*",
                },
                agent: parsed.protocol === "https:" ? httpsAgent : httpAgent,
                timeout: 0,
            }

            this.req = client.request(options, (res) => {
                this.res = res

                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    let nextUrl = res.headers.location
                    if (!/^https?:\/\//i.test(nextUrl)) {
                        nextUrl = new URL(nextUrl, this.targetUrl).toString()
                    }
                    this.targetUrl = nextUrl
                    this.startStream()
                    return
                }

                let residual = null

                res.on("data", (chunk) => {
                    if (this.isDestroyed) return
                    this.lastAccess = Date.now()

                    let data = chunk
                    if (residual && residual.length > 0) {
                        data = Buffer.concat([residual, chunk])
                        residual = null
                    }

                    let offset = 0
                    while (offset < data.length && data[offset] !== 0x47) {
                        offset++
                    }

                    const packetCount = Math.floor((data.length - offset) / 188)
                    if (packetCount > 0) {
                        const alignedLength = packetCount * 188
                        const alignedBuffer = data.subarray(offset, offset + alignedLength)
                        this.processPackets(alignedBuffer)
                        offset += alignedLength
                    }

                    if (offset < data.length) {
                        residual = Buffer.from(data.subarray(offset))
                    }
                })

                res.on("end", () => {
                    if (!this.isDestroyed && this.currentBytes > 0) {
                        this.sealSegment()
                    }
                })

                res.on("error", (err) => {
                    console.warn("[TsHlsSession] Upstream error:", err.message)
                })
            })

            this.req.on("error", (err) => {
                console.warn("[TsHlsSession] Request error:", err.message)
            })

            this.req.end()
        } catch (e) {
            console.error("[TsHlsSession] Init error:", e)
        }
    }

    processPackets(buffer) {
        if (!this.patPmtPackets) {
            for (let i = 0; i <= buffer.length - 188; i += 188) {
                if (buffer[i] === 0x47) {
                    const pid = ((buffer[i + 1] & 0x1f) << 8) | buffer[i + 2]
                    if (pid === 0) {
                        this.patPmtPackets = Buffer.from(buffer.subarray(i, Math.min(buffer.length, i + 188 * 3)))
                        break
                    }
                }
            }
        }

        this.currentBuffer.push(buffer)
        this.currentBytes += buffer.length

        const threshold = this.sequence < 2 ? 400 * 1024 : 1200 * 1024
        if (this.currentBytes >= threshold) {
            this.sealSegment()
        }
    }

    sealSegment() {
        if (this.currentBuffer.length === 0) return
        const fullBuffer = Buffer.concat(this.currentBuffer)
        this.currentBuffer = []
        this.currentBytes = 0

        let finalSegment = fullBuffer
        if (this.patPmtPackets) {
            finalSegment = Buffer.concat([this.patPmtPackets, fullBuffer])
        }

        const seq = this.sequence++
        this.segments.set(seq, {
            data: finalSegment,
            duration: Math.max(1.8, Math.min(4.0, finalSegment.length / 450000)),
            created: Date.now(),
        })

        if (this.segments.size > 6) {
            const oldestSeq = Math.min(...this.segments.keys())
            this.segments.delete(oldestSeq)
        }

        this.emit("segment", seq)
    }

    waitForFirstSegment(timeoutMs = 4000) {
        if (this.segments.size > 0) return Promise.resolve()
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, timeoutMs)
            this.once("segment", () => {
                clearTimeout(timer)
                resolve()
            })
        })
    }

    getPlaylist(baseUrl, sessionId) {
        this.lastAccess = Date.now()
        const seqs = Array.from(this.segments.keys()).sort((a, b) => a - b)
        if (seqs.length === 0) {
            return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n`
        }

        const firstSeq = seqs[0]
        let m3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${firstSeq}\n`
        for (const s of seqs) {
            const seg = this.segments.get(s)
            const dur = seg && seg.duration ? seg.duration.toFixed(3) : "2.500"
            m3u8 += `#EXTINF:${dur},\n${baseUrl}/hls-live/segment.ts?session=${sessionId}&seq=${s}\n`
        }
        return m3u8
    }

    getSegment(seq) {
        this.lastAccess = Date.now()
        const seg = this.segments.get(Number(seq))
        return seg ? seg.data : null
    }

    destroy() {
        this.isDestroyed = true
        try {
            if (this.res) this.res.destroy()
        } catch {}
        try {
            if (this.req) this.req.destroy()
        } catch {}
        this.segments.clear()
        this.currentBuffer = []
    }
}

const hlsLiveSessions = new Map()

setInterval(() => {
    const now = Date.now()
    for (const [id, session] of hlsLiveSessions.entries()) {
        if (now - session.lastAccess > 25000) {
            session.destroy()
            hlsLiveSessions.delete(id)
        }
    }
}, 10000)

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

    if (req.url.startsWith("/hls-live/stream.m3u8")) {
        let targetUrl = ""
        try {
            const u = new URL(req.url, "http://127.0.0.1")
            targetUrl = u.searchParams.get("url") || ""
        } catch {}
        if (!targetUrl) {
            const urlIdx = req.url.indexOf("url=")
            if (urlIdx !== -1) {
                targetUrl = decodeURIComponent(req.url.slice(urlIdx + 4))
            }
        }
        if (!targetUrl) {
            res.writeHead(400, { "Content-Type": "text/plain" })
            res.end("Missing stream url")
            return
        }
        const sessionId = Buffer.from(targetUrl).toString("base64url").slice(0, 32)
        let session = hlsLiveSessions.get(sessionId)
        if (!session || session.isDestroyed) {
            session = new TsHlsSession(targetUrl)
            hlsLiveSessions.set(sessionId, session)
        }
        session.waitForFirstSegment(3500).then(() => {
            const host = req.headers.host ? `http://${req.headers.host}` : ""
            const playlist = session.getPlaylist(host, sessionId)
            res.writeHead(200, {
                "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            })
            res.end(playlist)
        })
        return
    }

    if (req.url.startsWith("/hls-live/segment.ts")) {
        const u = new URL(req.url, "http://127.0.0.1")
        const sessionId = u.searchParams.get("session") || ""
        const seq = u.searchParams.get("seq") || "0"
        const session = hlsLiveSessions.get(sessionId)
        if (!session) {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("Session not found")
            return
        }
        const data = session.getSegment(seq)
        if (!data) {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("Segment not ready")
            return
        }
        res.writeHead(200, {
            "Content-Type": "video/mp2t",
            "Content-Length": data.length,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=10",
        })
        res.end(data)
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
