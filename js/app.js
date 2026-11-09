var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

;(function () {
    const store = App.store
    const tv = App.tv
    const player = App.player
    const ui = App.ui

    function zone(name, selector, options) {
        tv.define(
            name,
            () => {
                return tv.rows(ui.qsa(selector))
            },
            options,
        )
    }

    function defineZones() {
        zone("pinGrid", ".pin-key", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("pinActions", 0, 0)
                else if (dir === "left") tv.set("pinTools", 0, 0)
            },
        })
        zone("pinEntry", ".pin-key")
        zone("pinTools", "#pinSubmit, #btnDnsToggle, #btnVpnToggle", {
            onEdge: function (dir) {
                if (dir === "right") tv.set("pinGrid", 0, 0)
                else if (dir === "down") tv.set("pinActions", 0, 0)
            },
        })
        zone("pinActions", "#pinActions .pin-action", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("pinGrid", 3, 1)
                else if (dir === "left") tv.set("pinTools", 0, 0)
            },
        })
        zone("servers", "#serverList .server-card, #serversBack")

        // Home Dashboard (activity_premium_home.xml)
        zone("homeTop", "#homeTopBtns .fs-top-pill", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("homeCards", 0, 0)
            },
        })
        zone("homeCards", "#homeCards .fs-premium-card", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("homeTop", 0, 0)
            },
        })
        zone("globalSearchInput", "#globalSearchBack, #globalSearchInput", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("globalSearchResults", 0, 0)
            },
        })
        zone("globalSearchResults", "#globalSearchResults .search-result-item", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("globalSearchInput", 0, 0)
            },
        })

        // Series Detail (activity_series_detail.xml)
        zone("seriesTop", "#seriesBack, #seriesFavBtn", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("seriesSeasons", 0, 0)
            },
        })
        zone("seriesSeasons", "#seriesSeasons .season-btn", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("seriesTop", 0, 0)
                else if (dir === "down" || dir === "right") tv.set("seriesEpisodes", 0, 0)
            },
        })
        zone("seriesEpisodes", "#seriesEpisodes .row", {
            onEdge: function (dir) {
                if (dir === "up" || dir === "left") tv.set("seriesSeasons", 0, 0)
            },
        })

        // Movie Detail Overlay (activity_media_info.xml)
        zone("movieDetail", "#movieDetailActions button, #movieDetailBack")

        // Live TV (ZapActivity) & VOD Browser (VodBrowserActivity)
        zone("tvTop", "#zapBackBtn, #vodBackBtn, #tvChannelSearch, #btnVodSort", {
            onEdge: function (dir) {
                if (dir === "down") tv.set("tvCats", 0, 0)
            },
        })

        zone("tvSearch", "#tvSearch", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("tvTop", 0, 0)
                else if (dir === "down") tv.set("tvCats", 0, 0)
                else if (dir === "right") tv.set("tvChannels", 0, 0)
            },
        })

        zone("tvCats", "#tvCats .tvcat", {
            onEdge: function (dir) {
                if (dir === "up") tv.set("tvSearch", 0, 0)
                else if (dir === "right") {
                    const focused = document.querySelector("#tvCats .tvcat.focused")
                    if (
                        focused &&
                        focused.dataset &&
                        focused.dataset.group &&
                        focused.dataset.group !== store.state.catName
                    ) {
                        store.openTvCategory(focused.dataset.group)
                    }
                    const items = store.visibleTvCategory().items
                    let chIdx = 0
                    if (items && items.length && store.state.preview) {
                        const found = items.findIndex(
                            (c) =>
                                (c.id && c.id === store.state.preview.id) ||
                                (c.url && c.url === store.state.preview.url) ||
                                c.name === store.state.preview.name,
                        )
                        if (found !== -1) chIdx = found
                    }
                    tv.set("tvChannels", chIdx, 0)
                }
            },
        })

        zone("tvChannels", "#tvChannels .channel", {
            onEdge: function (dir) {
                if (dir === "left") {
                    const rows = store.tvCategories().rows
                    let catIdx = 0
                    if (rows && rows.length && store.state.catName) {
                        const found = rows.findIndex((r) => r.name === store.state.catName)
                        if (found !== -1) catIdx = found
                    }
                    tv.set("tvCats", catIdx, 0)
                } else if (dir === "right") {
                    if (store.state.mediaType === "live") {
                        tv.set("tvPreview", 0, 0)
                    }
                } else if (dir === "up") {
                    tv.set("tvTop", 0, 0)
                }
            },
        })

        zone("tvPreview", "#tvPreview, #zapPreviewActions button", {
            onEdge: function (dir) {
                if (dir === "left") {
                    const items = store.visibleTvCategory().items
                    let chIdx = 0
                    if (items && items.length && store.state.preview) {
                        const found = items.findIndex(
                            (c) =>
                                (c.id && c.id === store.state.preview.id) ||
                                (c.url && c.url === store.state.preview.url) ||
                                c.name === store.state.preview.name,
                        )
                        if (found !== -1) chIdx = found
                    }
                    tv.set("tvChannels", chIdx, 0)
                } else if (dir === "up") {
                    tv.set("tvTop", 0, 0)
                }
            },
        })

        tv.define("playerIdle", () => {
            return []
        })

        zone("overlay", "#ovActions .btn", {
            onEdge: function (dir) {
                if (dir === "up") {
                    store.setMenuFocus(false)
                    tv.set("playerIdle", 0, 0)
                }
            },
        })

        zone("vodControls", "#vodControls button, #vodSeek", {
            onEdge: function (dir) {
                if (dir === "up") {
                    store.setMenuFocus(false)
                    tv.set("playerIdle", 0, 0)
                }
            },
        })

        zone("zapCats", "#zapCats .zapcat", {
            onEdge: function (dir) {
                if (dir === "right") tv.set("zapChannels", 0, 0)
            },
        })

        zone("zapChannels", "#zapChannels .zapch", {
            onEdge: function (dir) {
                if (dir === "left") tv.set("zapCats", 0, 0)
            },
        })

        zone("playError", "#playError .btn")

        zone("confirm", "#confirm .btn")
    }

    function back() {
        if (store.state.globalSearchOpen) {
            store.closeGlobalSearch()
            return true
        }
        if (store.state.selectedMovie) {
            store.closeMovieDetail()
            return true
        }
        if (store.state.screen === "pin") return true
        if (store.state.screen === "servers") {
            if (store.state.lists && store.state.lists.length) store.goHome()
            else store.changeAccountPin()
            return true
        }
        if (store.state.screen === "episodes") {
            store.closeSeries()
            return true
        }
        if (store.state.confirm) {
            store.closeConfirm()
            return true
        }
        if (store.state.zapOpen) {
            store.closeZap()
            return true
        }
        if (store.state.screen === "player") {
            if (store.state.menuFocus) {
                store.setMenuFocus(false)
                tv.set("playerIdle", 0, 0)
                return true
            }
            store.exitPlayer()
            return true
        }
        if (store.state.screen === "tv") {
            const focused = document.querySelector(".focused")
            if (
                focused &&
                (focused.closest("#tvChannels") ||
                    focused.closest("#zapPreviewActions") ||
                    focused.closest("#tvPreview"))
            ) {
                const rows = store.tvCategories().rows
                let catIdx = 0
                if (rows && rows.length && store.state.catName) {
                    const found = rows.findIndex((r) => r.name === store.state.catName)
                    if (found !== -1) catIdx = found
                }
                tv.set("tvCats", catIdx, 0)
                return true
            }
            store.goHome()
            return true
        }
        if (store.state.screen !== "home") {
            store.goHome()
            return true
        }
        try {
            tizen.application.getCurrentApplication().exit()
        } catch {}
        return true
    }

    function isBackKey(code, event) {
        const key = event && event.key
        return (
            code === tv.KEY.BACK ||
            code === 8 ||
            code === 27 ||
            code === 46 ||
            code === 461 ||
            key === "Back" ||
            key === "BrowserBack" ||
            key === "GoBack" ||
            key === "Escape" ||
            key === "Backspace"
        )
    }

    function red() {
        const element = tv.focusedElement()
        const state = store.state

        if (state.screen === "player" && state.playing) {
            const added = store.toggleFavorite(state.playing.channel, state.playing.listId)
            store.notify(added ? "Added to favorites" : "Removed from favorites")
            return
        }

        if (!element) return

        if (state.screen === "home") {
            const list = element.dataset.list ? store.listById(element.dataset.list) : null
            if (!list) return
            store.askConfirm(`Delete “${list.name}”? Favorites are kept.`, () => {
                store.removeList(list.id)
                store.notify("Source deleted")
                store.goHome()
            })
            return
        }

        const url = element.dataset.url
        const listId = element.dataset.list
        if (!url) return
        const channel = store.channelByUrl(url, listId)
        if (!channel) return
        const saved = store.toggleFavorite(channel, listId)
        store.notify(saved ? "Added to favorites" : "Removed from favorites")
    }

    function onKey(code, event) {
        if (App.player && App.player.unmute) App.player.unmute()
        if (store.state.screen === "pin") {
            if ([tv.KEY.UP, tv.KEY.DOWN, tv.KEY.LEFT, tv.KEY.RIGHT].indexOf(code) !== -1)
                return false
            const key = event && (event.key || event.code)
            const digit =
                key && /^\d$/.test(key)
                    ? key
                    : key && /^Numpad\d$/.test(key)
                      ? key.slice(-1)
                      : code >= 48 && code <= 57
                        ? String(code - 48)
                        : code >= 96 && code <= 105
                          ? String(code - 96)
                          : ""
            if (digit) {
                if (store.state.pinEntry.length < 4 && !store.state.pinLoading) {
                    store.appendPinDigit(digit)
                }
                return true
            }
            if (isBackKey(code, event)) {
                if (store.state.pinEntry && store.state.pinEntry.length > 0) {
                    store.backspacePin()
                    return true
                }
                return true
            }
            if (code === tv.KEY.ENTER || key === "Enter") {
                const focused = tv.focusedElement()
                if (
                    focused &&
                    (focused.classList.contains("pin-key") ||
                        focused.classList.contains("pin-action"))
                )
                    return false
                if (store.state.pinEntry.length === 4 && !store.state.pinLoading) {
                    store.authenticatePin(store.state.pinEntry, "connect").catch(() => {})
                    return true
                }
                return true
            }
            return false
        }
        if (code >= 48 && code <= 57) {
            store.pushDigit(String(code - 48))
            return true
        }
        if (code >= 96 && code <= 105) {
            store.pushDigit(String(code - 96))
            return true
        }
        if (isBackKey(code, event)) return store.clearDigits() ? true : back()
        if (code === tv.KEY.RED || (event && (event.key === "r" || event.key === "R"))) {
            red()
            return true
        }
        if (code === tv.KEY.ENTER && store.commitDigits()) return true
        if (store.state.screen !== "player") return false

        const isChUp = code === tv.KEY.CH_UP || (event && (event.key === "PageUp" || event.key === "+"))
        const isChDown = code === tv.KEY.CH_DOWN || (event && (event.key === "PageDown" || event.key === "-"))

        if (store.isVod(store.state.playing && store.state.playing.channel)) {
            if (isChUp || isChDown) return true
        } else if (isChUp) {
            store.zap(1)
            return true
        } else if (isChDown) {
            store.zap(-1)
            return true
        }

        if (store.state.zapOpen) return false

        if (store.state.playError) {
            if (code === tv.KEY.UP || code === tv.KEY.DOWN) {
                const buttons = ui.qsa("#playError .btn")
                const index = buttons.indexOf(document.querySelector(".focused"))
                tv.set("playError", index === 0 ? 1 : 0, 0)
                return true
            }
            return false
        }

        // Media Keys (Play, Pause, Play/Pause, Stop, FastForward, Rewind)
        if (
            code === tv.KEY.PLAY ||
            (event && (event.key === "MediaPlay" || event.code === "MediaPlay"))
        ) {
            store.resume()
            return true
        }
        if (
            code === tv.KEY.PAUSE ||
            (event && (event.key === "MediaPause" || event.code === "MediaPause"))
        ) {
            store.pause()
            return true
        }
        if (
            code === tv.KEY.PLAY_PAUSE ||
            (event &&
                (event.code === "Space" ||
                    event.key === " " ||
                    event.key === "MediaPlayPause"))
        ) {
            store.togglePlay()
            return true
        }
        if (
            code === tv.KEY.FAST_FORWARD ||
            (event && (event.key === "MediaFastForward" || event.key === "FastForward"))
        ) {
            store.smartSeek(20)
            return true
        }
        if (
            code === tv.KEY.REWIND ||
            (event && (event.key === "MediaRewind" || event.key === "Rewind"))
        ) {
            store.smartSeek(-20)
            return true
        }
        if (
            code === tv.KEY.STOP ||
            (event && (event.key === "MediaStop" || event.key === "Stop"))
        ) {
            store.exitPlayer()
            return true
        }

        if (store.state.menuFocus) {
            const focused = document.querySelector(".focused")
            if (focused && focused.id === "vodSeek") {
                if (code === tv.KEY.LEFT || code === tv.KEY.RIGHT) {
                    const delta = code === tv.KEY.LEFT ? -10 : 10
                    store.smartSeek(delta)
                    return true
                }
                if (code === tv.KEY.ENTER) {
                    store.togglePlay()
                    return true
                }
                if (code === tv.KEY.UP) {
                    store.setMenuFocus(false)
                    tv.set("playerIdle", 0, 0)
                    return true
                }
                if (code === tv.KEY.DOWN) {
                    const playBtn = document.querySelector("#vodControls .vod-play") || document.querySelector("#vodControls button")
                    if (playBtn) {
                        const items = Array.from(document.querySelectorAll("#vodControls button, #vodSeek"))
                        const idx = items.indexOf(playBtn)
                        if (idx !== -1) tv.set("vodControls", idx, 0)
                    }
                    return true
                }
            } else if (focused && focused.closest && focused.closest("#vodControls")) {
                if (code === tv.KEY.UP) {
                    const seek = document.getElementById("vodSeek")
                    if (seek) {
                        const items = Array.from(document.querySelectorAll("#vodControls button, #vodSeek"))
                        const idx = items.indexOf(seek)
                        if (idx !== -1) tv.set("vodControls", idx, 0)
                    } else {
                        store.setMenuFocus(false)
                        tv.set("playerIdle", 0, 0)
                    }
                    return true
                }
                if (code === tv.KEY.DOWN) {
                    store.setMenuFocus(false)
                    tv.set("playerIdle", 0, 0)
                    return true
                }
            } else if (code === tv.KEY.UP) {
                store.setMenuFocus(false)
                tv.set("playerIdle", 0, 0)
                return true
            }
            return false
        }

        if (code === tv.KEY.LEFT) {
            if (store.isVod(store.state.playing && store.state.playing.channel)) {
                store.smartSeek(-10)
                return true
            }
            store.openZap()
            return true
        }

        if (code === tv.KEY.RIGHT) {
            if (!store.isVod(store.state.playing && store.state.playing.channel)) {
                store.zap(1)
                return true
            }
            store.smartSeek(10)
            return true
        }

        if (code === tv.KEY.DOWN) {
            store.setMenuFocus(true)
            tv.set(
                store.isVod(store.state.playing && store.state.playing.channel)
                    ? "vodControls"
                    : "overlay",
                0,
                0,
            )
            return true
        }
        if (code === tv.KEY.UP) {
            store.setMenuFocus(false)
            tv.set("playerIdle", 0, 0)
            return true
        }
        if (code === tv.KEY.ENTER) {
            if (store.isVod(store.state.playing && store.state.playing.channel)) {
                if (!store.state.menuFocus) {
                    store.togglePlay()
                    return true
                }
                return false
            }
            store.openZap()
            return true
        }
        return false
    }

    function start() {
        const videoEl = document.getElementById("videoPlayer")
        if (player && player.init && videoEl) {
            player.init(videoEl, {
                onStart: function () {
                    store.playStarted()
                },
                onError: function (message) {
                    if (store.state.screen === "player") {
                        store.playFailed(message)
                    } else if (store.state.screen === "tv") {
                        store.notify(`Aperçu impossible · ${message}`)
                    }
                },
                onResumeError: function () {
                    store.notify("The saved position could not be restored")
                },
                onEnd: function () {
                    store.finishPlayback()
                },
            })
        }
        store.init()
        defineZones()
        tv.listen(onKey, { onFocus: store.focusChanged })
        window.addEventListener("pointerdown", () => {
            if (App.player && App.player.unmute) App.player.unmute()
        }, { passive: true })
        ui.render()
        store.focus("pinGrid")
        tv.set("pinGrid", 0, 0)

        const isSamsungTV = /Tizen|SMART-TV|SamsungBrowser/i.test(navigator.userAgent)
        if (isSamsungTV) {
            try {
                if (!sessionStorage.getItem("fws_samsung_tip_seen")) {
                    sessionStorage.setItem("fws_samsung_tip_seen", "1")
                    setTimeout(() => {
                        store.notify(
                            "💡 Samsung TV : Pour naviguer avec les flèches sans curseur, cliquez sur l'icône [Pointeur / Flèches] tout en haut du navigateur Samsung.",
                            10000,
                        )
                    }, 1200)
                }
            } catch {}
        }
    }

    document.addEventListener("DOMContentLoaded", start)

    let deferredPrompt = null
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault()
        deferredPrompt = e
        if (store && store.setCanInstallPwa) {
            store.setCanInstallPwa(true)
        }
    })

    window.addEventListener("appinstalled", () => {
        deferredPrompt = null
        if (store && store.setCanInstallPwa) {
            store.setCanInstallPwa(false)
        }
        if (store && store.notify) {
            store.notify("Application installée avec succès ! 🎉", 4000)
        }
    })

    App.installPwa = function () {
        if (deferredPrompt) {
            deferredPrompt.prompt()
            deferredPrompt.userChoice.then((choice) => {
                if (choice.outcome === "accepted" && store && store.setCanInstallPwa) {
                    store.setCanInstallPwa(false)
                }
                deferredPrompt = null
            })
        } else {
            const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
            const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true
            if (isStandalone) {
                if (store && store.notify) store.notify("L'application est déjà installée sur cet appareil !")
            } else if (isIos) {
                if (store && store.notify) store.notify("📲 Pour installer sur iPhone : appuyez sur le bouton Partager ⎋ dans Safari puis 'Sur l'écran d'accueil' ➕", 8000)
            } else {
                if (store && store.notify) store.notify("📲 Pour installer : ouvrez le menu du navigateur (⋮) puis cliquez sur 'Installer l'application' ou 'Ajouter à l'écran d'accueil'", 8000)
            }
        }
    }

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./sw.js").catch(() => {})
        })
    }
})()
