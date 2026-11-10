const CACHE_NAME = "fws-shell-v5"

const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon.png",
    "./icon-192.png",
    "./brand.png",
    "./img/bg_luxury_violet.jpg",
    "./img/bg_card_live_art.jpg",
    "./img/bg_card_movies_art.jpg",
    "./img/bg_card_series_art.jpg",
    "./img/family_premium_logo.png",
    "./img/tv_default.png",
    "./css/tokens.css",
    "./css/base.css",
    "./css/lists.css",
    "./css/forms.css",
    "./css/player.css",
    "./css/overlays.css",
    "./css/media.css",
    "./css/access.css",
    "./css/android-theme.css",
    "./vendor/preact.umd.js",
    "./vendor/hooks.umd.js",
    "./vendor/htm.umd.js",
    "./vendor/mpegts.js",
    "./js/api.js",
    "./js/firebase.js",
    "./js/player.js",
    "./js/tv.js",
    "./js/store.js",
    "./js/ui/kit.js",
    "./js/ui/screens/home.js",
    "./js/ui/screens/access.js",
    "./js/ui/screens/series.js",
    "./js/ui/screens/tv.js",
    "./js/ui/screens/recents.js",
    "./js/ui/screens/favs.js",
    "./js/ui/screens/cats.js",
    "./js/ui/screens/add.js",
    "./js/ui/screens/player.js",
    "./js/ui/screens/zap.js",
    "./js/ui/screens/overlays.js",
    "./js/ui.js",
    "./js/app.js"
]

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const asset of STATIC_ASSETS) {
                try {
                    await cache.add(asset)
                } catch (e) {
                    // Non-critical if individual asset fails
                }
            }
        }).then(() => self.skipWaiting())
    )
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key)
                    }
                })
            )
        }).then(() => self.clients.claim())
    )
})

self.addEventListener("fetch", (event) => {
    const req = event.request
    if (req.method !== "GET") return

    let url
    try {
        url = new URL(req.url)
    } catch {
        return
    }

    // Bypass cache completely for all stream endpoints, video files, ranges, and proxy calls
    if (
        url.pathname.startsWith("/proxy") ||
        url.pathname.startsWith("/kill-stream") ||
        url.pathname.startsWith("/stalker") ||
        url.search.includes("stream=1") ||
        url.search.includes("url=") ||
        url.pathname.endsWith(".m3u8") ||
        url.pathname.endsWith(".ts") ||
        url.pathname.endsWith(".mp4") ||
        url.pathname.endsWith(".mkv") ||
        req.headers.has("range") ||
        url.origin !== self.location.origin
    ) {
        return
    }

    event.respondWith(
        fetch(req)
            .then((networkRes) => {
                if (networkRes && networkRes.status === 200 && networkRes.type === "basic") {
                    const resClone = networkRes.clone()
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone))
                }
                return networkRes
            })
            .catch(() => {
                return caches.match(req).then((cachedRes) => {
                    if (cachedRes) return cachedRes
                    if (req.mode === "navigate") {
                        return caches.match("./index.html") || caches.match("./")
                    }
                })
            })
    )
})
