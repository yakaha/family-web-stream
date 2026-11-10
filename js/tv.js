var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.tv = (function () {
    const KEY = {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        BACK: 10009,
        BACK_WEBOS: 461,
        BACK_ESC: 27,
        BACK_BS: 8,
        BACK_ANDROID: 4,
        RED: 403,
        CH_UP: 427,
        CH_DOWN: 428,
        PAGE_UP: 33,
        PAGE_DOWN: 34,
        PLAY: 415,
        PAUSE: 19,
        PLAY_PAUSE: 10252,
        STOP: 413,
        FAST_FORWARD: 417,
        REWIND: 412,
        SPACE: 32,
    }

    let hasRequestedFullscreen = false
    function isFullscreen() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        )
    }

    function exitFullscreen() {
        try {
            if (isFullscreen()) {
                const exit =
                    document.exitFullscreen ||
                    document.webkitExitFullscreen ||
                    document.mozCancelFullScreen ||
                    document.msExitFullscreen
                if (exit) return exit.call(document)
            }
        } catch {}
    }

    function isStandalonePwa() {
        try {
            return (
                (window.matchMedia &&
                    (window.matchMedia("(display-mode: fullscreen)").matches ||
                        window.matchMedia("(display-mode: standalone)").matches ||
                        window.matchMedia("(display-mode: minimal-ui)").matches)) ||
                window.navigator.standalone === true
            )
        } catch {
            return false
        }
    }

    function enterFullscreen() {
        try {
            const el = document.documentElement
            const rfs =
                el.requestFullscreen ||
                el.webkitRequestFullscreen ||
                el.msRequestFullscreen ||
                el.mozRequestFullScreen
            if (!rfs || isFullscreen()) return
            // navigationUI "hide" asks Android to hide its system navigation bar too.
            const result = rfs.call(el, { navigationUI: "hide" })
            if (result && result.catch) result.catch(() => {})
        } catch {}
    }

    let userLeftFullscreen = false

    function toggleFullscreen() {
        try {
            if (isFullscreen()) {
                userLeftFullscreen = true
                return exitFullscreen()
            }
            userLeftFullscreen = false
            return enterFullscreen()
        } catch {}
    }

    App.isFullscreen = isFullscreen
    App.exitFullscreen = exitFullscreen
    App.toggleFullscreen = toggleFullscreen
    App.isStandalonePwa = isStandalonePwa

    function requestFullscreenOnce() {
        // Installed PWA: always go truly fullscreen (hide status + navigation bars)
        // on the first touch, and again after the app comes back from background,
        // unless the user chose "Réduire" himself.
        if (isStandalonePwa()) {
            if (!isFullscreen() && !userLeftFullscreen) enterFullscreen()
            return
        }
        if (hasRequestedFullscreen) return
        hasRequestedFullscreen = true
        try {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            // In a mobile browser tab, let the user trigger fullscreen via the dedicated button
            if (isMobile) return
            enterFullscreen()
        } catch {}
    }

    const zones = {}
    let current = null
    let row = 0
    let col = 0
    let onKey = function () {}
    let onFocus = null
    let cachedGrid = null
    let cachedZone = null
    let focusDebounceTimer = null

    function invalidate() {
        cachedGrid = null
        cachedZone = null
    }

    function rows(elements) {
        if (!elements || !elements.length) return []
        if (elements.length === 1) return [[elements[0]]]

        // Fast-path: single column vertical list (common for TV channel lists & menus)
        const first = elements[0]
        const second = elements[1]
        if (
            first &&
            second &&
            first.offsetLeft !== undefined &&
            first.offsetLeft === second.offsetLeft &&
            first.offsetTop !== second.offsetTop
        ) {
            const out = new Array(elements.length)
            for (let i = 0; i < elements.length; i++) {
                out[i] = [elements[i]]
            }
            return out
        }

        const out = []
        let top = null
        for (let i = 0; i < elements.length; i++) {
            const elementTop = elements[i].offsetTop
            if (top === null || Math.abs(elementTop - top) > 8) {
                out.push([])
                top = elementTop
            }
            out[out.length - 1].push(elements[i])
        }
        return out
    }

    function define(name, items, options) {
        zones[name] = { items, onEdge: options && options.onEdge }
        if (current === name) invalidate()
    }

    // Rows are grouped by offsetTop: what a TV layout needs, and what jsdom lacks.
    function matrix() {
        const zone = zones[current]
        if (!zone) return []
        if (cachedGrid && cachedZone === current) {
            if (cachedGrid[0] && cachedGrid[0][0] && cachedGrid[0][0].isConnected !== false) {
                return cachedGrid
            }
        }
        const items = typeof zone.items === "function" ? zone.items() : zone.items
        cachedGrid = items || []
        cachedZone = current
        return cachedGrid
    }

    function apply(existingGrid) {
        const previous = document.querySelector(".focused")
        if (previous) previous.classList.remove("focused")

        const grid = existingGrid || matrix()
        if (!grid.length) return
        if (row >= grid.length) row = grid.length - 1
        if (row < 0) row = 0
        const line = grid[row] || []
        if (!line.length) return
        if (col >= line.length) col = line.length - 1
        if (col < 0) col = 0

        const element = line[col]
        if (!element) return
        element.classList.add("focused")
        reveal(element)
        if (!element.hasAttribute("tabindex")) {
            element.setAttribute("tabindex", "0")
        }
        try {
            if (typeof element.focus === "function") {
                element.focus({ preventScroll: true })
            }
        } catch {}
        if (onFocus) {
            if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
            focusDebounceTimer = setTimeout(() => {
                focusDebounceTimer = null
                onFocus(element)
            }, 160)
        }
    }

    // Scroll only the container that overflows: fast detection via closest
    function reveal(element) {
        if (!element) return
        const box = element.closest
            ? element.closest(
                  ".rows, .browse-cats, .browse-channels, #serverList, #seriesEpisodes, #sourceList, #typeList, .rail-items, .screen",
              )
            : null
        if (box) {
            const itemTop = element.offsetTop
            const itemBottom = itemTop + element.offsetHeight
            const boxTop = box.scrollTop
            const boxBottom = boxTop + box.clientHeight
            if (itemTop < boxTop) {
                box.scrollTop = Math.max(0, itemTop - 12)
            } else if (itemBottom > boxBottom) {
                box.scrollTop = itemBottom - box.clientHeight + 12
            }
            return
        }
        if (element.scrollIntoViewIfNeeded) {
            element.scrollIntoViewIfNeeded(false)
        } else if (element.scrollIntoView) {
            element.scrollIntoView({ block: "nearest" })
        }
    }

    function set(name, r, c) {
        if (current !== name) invalidate()
        current = name
        row = r || 0
        col = c || 0
        apply()
    }

    function refresh() {
        invalidate()
        const previous = document.querySelector(".focused")
        if (previous && previous.isConnected) {
            return
        }
        apply()
    }

    function edge(direction) {
        const zone = zones[current]
        if (zone && zone.onEdge) zone.onEdge(direction)
    }

    function move(direction) {
        if (!zones[current]) return
        const grid = matrix()
        if (!grid.length) return
        const line = grid[row] || []

        if (direction === "up") {
            if (row > 0) row--
            else return edge("up")
        } else if (direction === "down") {
            if (row < grid.length - 1) row++
            else return edge("down")
        } else if (direction === "left") {
            if (col > 0) col--
            else return edge("left")
        } else if (direction === "right") {
            if (col < line.length - 1) col++
            else return edge("right")
        }
        apply(grid)
    }

    function focusedElement() {
        return document.querySelector(".focused")
    }

    function syncGridWithElement(element) {
        if (!element) return
        const currentGrid = matrix()
        for (let r = 0; r < currentGrid.length; r++) {
            const line = currentGrid[r] || []
            for (let c = 0; c < line.length; c++) {
                const item = line[c]
                if (item === element || (item && item.contains && item.contains(element))) {
                    row = r
                    col = c
                    return
                }
            }
        }
        for (const zoneName in zones) {
            if (zoneName === current) continue
            const z = zones[zoneName]
            const items = typeof z.items === "function" ? z.items() : z.items
            if (!items || !items.length) continue
            for (let r = 0; r < items.length; r++) {
                const line = items[r] || []
                for (let c = 0; c < line.length; c++) {
                    const item = line[c]
                    if (item === element || (item && item.contains && item.contains(element))) {
                        current = zoneName
                        row = r
                        col = c
                        cachedGrid = items
                        cachedZone = zoneName
                        return
                    }
                }
            }
        }
    }

    // Focusing a field from inside the key handler is what summons the TV's IME.
    function select() {
        const element = focusedElement()
        if (!element) return
        if (element.tagName === "INPUT" && element.type === "file") element.click()
        else if (field(element)) element.focus()
        else element.click()
    }

    // Keys belong to the focused text field, textarea included.
    function field(element) {
        if (!element) return false
        if (element.tagName === "TEXTAREA") return true
        if (element.tagName === "INPUT") {
            const t = (element.type || "text").toLowerCase()
            return (
                t === "text" ||
                t === "password" ||
                t === "search" ||
                t === "email" ||
                t === "url" ||
                t === "number" ||
                t === "tel"
            )
        }
        return false
    }

    function typing() {
        return field(document.activeElement)
    }

    function handle(event) {
        requestFullscreenOnce()

        // Touche pressée sur la télécommande : cacher immédiatement le curseur
        if (document.body) document.body.classList.remove("mouse-active")

        if (typing()) {
            const field = document.activeElement
            if (App.store && App.store.state && App.store.state.screen === "pin") {
                field.blur()
            } else if (
                event.keyCode === KEY.UP ||
                event.keyCode === KEY.DOWN ||
                event.keyCode === KEY.BACK ||
                event.keyCode === 8 ||
                event.keyCode === 46 ||
                event.keyCode === 27 ||
                event.keyCode === 461 ||
                event.key === "Back" ||
                event.key === "BrowserBack" ||
                event.key === "GoBack" ||
                event.key === "Escape"
            ) {
                field.blur()
            } else {
                return
            }
        }

        if (onKey(event.keyCode, event)) {
            if (event.preventDefault) event.preventDefault()
            return
        }

        const key = event.key || ""
        const isUp = event.keyCode === KEY.UP || key === "ArrowUp" || key === "Up"
        const isDown = event.keyCode === KEY.DOWN || key === "ArrowDown" || key === "Down"
        const isLeft = event.keyCode === KEY.LEFT || key === "ArrowLeft" || key === "Left"
        const isRight = event.keyCode === KEY.RIGHT || key === "ArrowRight" || key === "Right"
        const isEnter = event.keyCode === KEY.ENTER || key === "Enter" || key === "Select" || key === "Ok"

        if (isUp) {
            move("up")
            if (event.preventDefault) event.preventDefault()
        } else if (isDown) {
            move("down")
            if (event.preventDefault) event.preventDefault()
        } else if (isLeft) {
            move("left")
            if (event.preventDefault) event.preventDefault()
        } else if (isRight) {
            move("right")
            if (event.preventDefault) event.preventDefault()
        } else if (isEnter) {
            select()
            if (event.preventDefault) event.preventDefault()
        }
    }

    // Some firmwares only deliver the non-arrow keys if they are registered first.
    let lastPointerX = 0
    let lastPointerY = 0
    function listen(handler, options) {
        onKey = handler
        onFocus = (options && options.onFocus) || null
        document.addEventListener("keydown", handle)
        window.addEventListener(
            "pointermove",
            (e) => {
                if (Math.abs(e.clientX - lastPointerX) > 8 || Math.abs(e.clientY - lastPointerY) > 8) {
                    lastPointerX = e.clientX
                    lastPointerY = e.clientY
                    if (document.body) document.body.classList.add("mouse-active")
                }
            },
            { passive: true },
        )

        const interactiveSelector =
            ".row, .pin-key, .pin-action, .btn, .server-card, .season-btn, .rail-btn, .rail-src, .type, .cat, .channel, .action, .zapcat, .zapch, input, button, select, [tabindex]"

        document.addEventListener(
            "pointerover",
            (e) => {
                const target = e.target
                if (!target || !target.closest) return
                const focusable = target.closest(interactiveSelector)
                if (focusable && !focusable.classList.contains("focused")) {
                    const prev = document.querySelector(".focused")
                    if (prev && prev !== focusable) prev.classList.remove("focused")
                    focusable.classList.add("focused")
                    try {
                        if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true })
                    } catch {}
                    syncGridWithElement(focusable)
                    if (onFocus) {
                        if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
                        focusDebounceTimer = setTimeout(() => {
                            focusDebounceTimer = null
                            onFocus(focusable)
                        }, 160)
                    }
                }
            },
            { passive: true },
        )

        document.addEventListener(
            "pointerdown",
            (e) => {
                const target = e.target
                if (!target || !target.closest) return
                const focusable = target.closest(interactiveSelector)
                if (focusable) {
                    const prev = document.querySelector(".focused")
                    if (prev && prev !== focusable) prev.classList.remove("focused")
                    focusable.classList.add("focused")
                    try {
                        if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true })
                    } catch {}
                    syncGridWithElement(focusable)
                }
            },
            { passive: true },
        )

        document.addEventListener(
            "focusin",
            (e) => {
                const target = e.target
                if (!target || !target.closest) return
                const focusable = target.closest(interactiveSelector)
                if (focusable && !focusable.classList.contains("focused")) {
                    const prev = document.querySelector(".focused")
                    if (prev && prev !== focusable) prev.classList.remove("focused")
                    focusable.classList.add("focused")
                    reveal(focusable)
                    syncGridWithElement(focusable)
                }
            },
            true,
        )

        try {
            if (typeof tizen !== "undefined" && tizen.tvinputdevice) {
                const keys = [
                    "0",
                    "1",
                    "2",
                    "3",
                    "4",
                    "5",
                    "6",
                    "7",
                    "8",
                    "9",
                    "ColorF0Red",
                    "ChannelUp",
                    "ChannelDown",
                    "MediaPlay",
                    "MediaPause",
                    "MediaPlayPause",
                    "MediaStop",
                    "MediaFastForward",
                    "MediaRewind",
                ]
                if (typeof tizen.tvinputdevice.registerKeyBatch === "function") {
                    tizen.tvinputdevice.registerKeyBatch(keys)
                } else if (typeof tizen.tvinputdevice.registerKey === "function") {
                    for (let i = 0; i < keys.length; i++) {
                        try {
                            tizen.tvinputdevice.registerKey(keys[i])
                        } catch {}
                    }
                }
            }
        } catch {}
    }

    return {
        KEY,
        define,
        set,
        refresh,
        invalidate,
        move,
        select,
        rows,
        listen,
        focusedElement,
        syncGridWithElement,
        isFullscreen,
        exitFullscreen,
        toggleFullscreen,
    }
})()
