var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html
    const BrandLogo = kit.BrandLogo

    function PinScreenClassic() {
        const state = store.state
        const pin = state.pinEntry || ""
        const rows = store.loadingRows()
        const progressPercent = rows.length ? rows[0].percent || 25 : state.pinLoading ? 35 : 0
        const activeServer =
            (state.firebaseServers || []).find((s) => s.id === state.activeServerId) ||
            (state.lists && state.lists[0]) ||
            null

        const submit = function (event) {
            if (event && event.preventDefault) event.preventDefault()
            if (pin.length === 4 && !state.pinLoading) {
                store.authenticatePin(pin, "connect").catch(() => {})
            }
        }

        const slots = [0, 1, 2, 3].map((idx) => {
            const hasDigit = idx < pin.length
            const isCurrent = idx === pin.length && !state.pinLoading
            let cls = "fs-pin-digit"
            if (hasDigit) cls += " filled"
            if (isCurrent) cls += " active"
            return html`<div class=${cls} key=${idx}>
                <span>${hasDigit ? "●" : "•"}</span>
            </div>`
        })

        return html`<section class="fs-pin-screen" id="pinScreen">
            <div class="fs-pin-layout">
                <!-- Left Column: Brand + PIN Display + Account Status + DNS & VPN -->
                <div class="fs-pin-left">
                    <${BrandLogo} />

                    <h1 class="fs-pin-title">Connectez-vous à votre espace</h1>
                    <p class="fs-pin-subtitle">Entrez votre code PIN à 4 chiffres</p>

                    <div class="fs-pin-input-row">
                        <div class="fs-pin-boxes" id="pinBoxes">${slots}</div>
                        <button
                            type="button"
                            class=${`fs-pin-ok-btn${pin.length === 4 && !state.pinLoading ? " ready" : ""}`}
                            id="pinSubmit"
                            tabindex="-1"
                            disabled=${state.pinLoading}
                            onClick=${submit}
                        >
                            OK
                        </button>
                    </div>

                    ${state.pinError
                        ? html`<div class="fs-pin-error" role="alert">⚠️ ${state.pinError}</div>`
                        : html`<div class="fs-pin-hint">
                              Saisissez votre code PIN à 4 chiffres puis appuyez sur OK
                          </div>`}

                    ${state.firebaseUser
                        ? html`<div class="fs-user-status-card">
                              <div class="fs-user-status-top">
                                  <span class="fs-user-name"
                                      >👤 ${state.firebaseUser.name || "Compte vérifié"}</span
                                  >
                                  <span class="fs-user-exp">🟢 Actif</span>
                              </div>
                              <div class="fs-user-server">
                                  Serveur actuel :
                                  <strong> ${activeServer ? activeServer.name : "Auto"}</strong>
                              </div>
                          </div>`
                        : null}

                    <div class="fs-pin-tools" id="pinTools">
                        <button
                            type="button"
                            class="fs-dns-pill"
                            id="btnDnsToggle"
                            tabindex="-1"
                            onClick=${() => store.cycleDns()}
                        >
                            🌐 DNS: ${state.dnsPref}
                        </button>

                        <button
                            type="button"
                            class=${`fs-vpn-card${state.vpnEnabled ? " on" : ""}`}
                            id="btnVpnToggle"
                            tabindex="-1"
                            onClick=${() => store.toggleVpn()}
                        >
                            <div class="fs-vpn-info">
                                <span class="fs-vpn-title">🛡️ VPN Gratuit • Anti-Bridage</span>
                                <span class="fs-vpn-sub">Cloudflare WARP (Fast Stream)</span>
                            </div>
                            <span class=${`fs-vpn-badge${state.vpnEnabled ? " on" : ""}`}>
                                ${state.vpnEnabled ? "ON" : "OFF"}
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        class="fs-pin-style-switch"
                        id="btnPinStyleSwitch"
                        tabindex="-1"
                        onClick=${() => store.togglePinDesign()}
                        title="Tester le nouveau design"
                    >
                        ✨ Tester le nouveau design moderne
                    </button>
                </div>

                <!-- Right Column: Numeric Keypad + Server Actions -->
                <div class="fs-pin-right">
                    <div class="fs-keypad-card">
                        <p class="fs-keypad-label">PAVÉ NUMÉRIQUE</p>
                        <div class="fs-keypad-grid" id="pinKeypad">
                            ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
                                (d) => html`<button
                                    type="button"
                                    class="btn pin-key fs-key-btn"
                                    data-key=${d}
                                    tabindex="-1"
                                    onClick=${() => store.appendPinDigit(d)}
                                >
                                    ${d}
                                </button>`,
                            )}
                            <button
                                type="button"
                                class="btn pin-key fs-key-btn fs-key-fn"
                                data-key="back"
                                tabindex="-1"
                                title="Effacer un chiffre"
                                onClick=${() => store.backspacePin()}
                            >
                                ⌫
                            </button>
                            <button
                                type="button"
                                class="btn pin-key fs-key-btn"
                                data-key="0"
                                tabindex="-1"
                                onClick=${() => store.appendPinDigit("0")}
                            >
                                0
                            </button>
                            <button
                                type="button"
                                class="btn pin-key fs-key-btn fs-key-fn"
                                data-key="clear"
                                tabindex="-1"
                                title="Vider"
                                onClick=${() => store.clearPin()}
                            >
                                C
                            </button>
                        </div>
                    </div>

                    <div class="fs-pin-actions" id="pinActions">
                        <button
                            type="button"
                            class="fs-btn-primary pin-action"
                            id="pinConnect"
                            tabindex="-1"
                            disabled=${state.pinLoading || (pin.length < 4 && !state.lists.length)}
                            onClick=${function () {
                                if (pin.length === 4) {
                                    submit()
                                } else if (state.lists.length) {
                                    store.goHome()
                                }
                            }}
                        >
                            ⚡ ${pin.length < 4 && state.lists.length ? "RETOUR À L'ACCUEIL" : "CONNECTER AU SERVEUR"}
                        </button>
                        <button
                            type="button"
                            class="fs-btn-secondary pin-action"
                            id="pinChangeServer"
                            tabindex="-1"
                            disabled=${state.pinLoading || (pin.length < 4 && !state.firebaseUser)}
                            onClick=${function () {
                                if (pin.length === 4) {
                                    store.authenticatePin(pin, "servers").catch(() => {})
                                } else if (state.firebaseUser) {
                                    store.openServers()
                                }
                            }}
                        >
                            🔄 Changer de serveur
                        </button>
                    </div>
                </div>
            </div>

            <!-- Android Full-Screen Circular Progress Overlay (#progress_container) -->
            ${state.pinLoading
                ? html`<div class="fs-progress-overlay" id="progressContainer" aria-live="polite">
                      <div class="fs-progress-circle-wrap">
                          <svg class="fs-progress-ring" viewBox="0 0 140 140">
                              <circle
                                  class="fs-progress-ring-bg"
                                  cx="70"
                                  cy="70"
                                  r="58"
                                  fill="none"
                                  stroke="rgba(148, 163, 184, 0.16)"
                                  stroke-width="8"
                              />
                              <circle
                                  class="fs-progress-ring-fg"
                                  cx="70"
                                  cy="70"
                                  r="58"
                                  fill="none"
                                  stroke="#9A6BFF"
                                  stroke-width="8"
                                  stroke-linecap="round"
                                  stroke-dasharray="364"
                                  stroke-dashoffset=${Math.round(364 - (364 * progressPercent) / 100)}
                              />
                          </svg>
                          <span class="fs-progress-percent">${progressPercent}%</span>
                      </div>
                      <h2 class="fs-progress-wait">Please Wait…</h2>
                      <p class="fs-progress-step">
                          ${state.loading
                              ? state.loading.title
                              : "Connexion au serveur pour récupérer les chaînes, films et séries…"}
                      </p>
                  </div>`
                : null}
        </section>`
    }

    function PinScreenModern() {
        const state = store.state
        const pin = state.pinEntry || ""
        const rows = store.loadingRows()
        const progressPercent = rows.length ? rows[0].percent || 25 : state.pinLoading ? 35 : 0
        const activeServer =
            (state.firebaseServers || []).find((s) => s.id === state.activeServerId) ||
            (state.lists && state.lists[0]) ||
            null

        const submit = function (event) {
            if (event && event.preventDefault) event.preventDefault()
            if (pin.length === 4 && !state.pinLoading) {
                store.authenticatePin(pin, "connect").catch(() => {})
            }
        }

        const modernSlots = [0, 1, 2, 3].map((idx) => {
            const hasDigit = idx < pin.length
            const isCurrent = idx === pin.length && !state.pinLoading
            let cls = "fs-pin-modern-slot"
            if (hasDigit) cls += " filled"
            if (isCurrent) cls += " active"
            return html`<div class=${cls} key=${idx}>
                <span class="dot"></span>
            </div>`
        })

        const dnsName = (state.dnsPref || "1.1.1.1").split(" ")[0]

        return html`<section class="fs-pin-screen modern-mode" id="pinScreen">
            <div class="fs-pin-modern-card">
                <!-- Left Column: Brand, Title, Futuristic Slots, Status Badges -->
                <div class="fs-pin-modern-left">
                    <div class="fs-pin-modern-brand">
                        <div class="fs-pin-modern-brand-icon">▶</div>
                        <div class="fs-pin-modern-brand-text">
                            <span class="fs-pin-modern-brand-name">FAMILY <span>STREAM</span></span>
                        </div>
                    </div>

                    <h1 class="fs-pin-modern-title">Connectez-vous à votre espace</h1>
                    <p class="fs-pin-modern-subtitle">Entrez votre code PIN à 4 chiffres</p>

                    <div class="fs-pin-modern-slots" id="pinBoxes">
                        ${modernSlots}
                    </div>

                    ${state.pinError
                        ? html`<div class="fs-pin-modern-error" role="alert">⚠️ ${state.pinError}</div>`
                        : null}

                    <div class="fs-pin-modern-badges" id="pinTools">
                        <div class="fs-pin-badge-pill">
                            <span class="fs-pin-status-dot"></span>
                            <span>${state.firebaseUser && state.firebaseUser.name ? state.firebaseUser.name : "Compte Premium"} • Actif</span>
                        </div>

                        <button
                            type="button"
                            class="fs-pin-badge-pill clickable"
                            id="btnDnsToggle"
                            tabindex="-1"
                            onClick=${() => store.cycleDns()}
                            title="Changer de DNS"
                        >
                            <span class="fs-pin-status-dot"></span>
                            <span>🌐 DNS Sécurisé (${dnsName})</span>
                        </button>

                        <button
                            type="button"
                            class="fs-pin-badge-pill clickable"
                            id="btnVpnToggle"
                            tabindex="-1"
                            onClick=${() => store.toggleVpn()}
                            title="Activer/Désactiver le VPN Anti-Bridage"
                        >
                            <span class=${`fs-pin-status-dot${state.vpnEnabled ? "" : " off"}`}></span>
                            <span>🛡️ VPN Anti-Bridage [${state.vpnEnabled ? "ON" : "OFF"}]</span>
                        </button>
                    </div>

                    <button
                        type="button"
                        class="fs-pin-style-switch"
                        id="btnPinStyleSwitch"
                        tabindex="-1"
                        onClick=${() => store.togglePinDesign()}
                        title="Revenir à l'ancienne version"
                    >
                        🎨 Version : Nouveau Design · <u>Basculer vers l'ancien</u>
                    </button>
                </div>

                <!-- Right Column: Glass Numeric Keypad & Actions -->
                <div class="fs-pin-modern-right">
                    <div class="fs-pin-modern-keypad-card">
                        <div class="fs-pin-modern-grid" id="pinKeypad">
                            ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
                                (d) => html`<button
                                    type="button"
                                    class="btn pin-key fs-pin-modern-key"
                                    data-key=${d}
                                    tabindex="-1"
                                    onClick=${() => store.appendPinDigit(d)}
                                >
                                    ${d}
                                </button>`,
                            )}
                            <button
                                type="button"
                                class="btn pin-key fs-pin-modern-key fn"
                                data-key="back"
                                tabindex="-1"
                                title="Effacer un chiffre"
                                onClick=${() => store.backspacePin()}
                            >
                                ⌫
                            </button>
                            <button
                                type="button"
                                class="btn pin-key fs-pin-modern-key"
                                data-key="0"
                                tabindex="-1"
                                onClick=${() => store.appendPinDigit("0")}
                            >
                                0
                            </button>
                            <button
                                type="button"
                                class="btn pin-key fs-pin-modern-key fn"
                                data-key="clear"
                                tabindex="-1"
                                title="Vider"
                                onClick=${() => store.clearPin()}
                            >
                                C
                            </button>
                        </div>
                    </div>

                    <div class="fs-pin-modern-actions" id="pinActions">
                        <button
                            type="button"
                            class="fs-pin-modern-btn-primary pin-action"
                            id="pinConnect"
                            tabindex="-1"
                            disabled=${state.pinLoading || (pin.length < 4 && !state.lists.length)}
                            onClick=${function () {
                                if (pin.length === 4) {
                                    submit()
                                } else if (state.lists.length) {
                                    store.goHome()
                                }
                            }}
                        >
                            ⚡ ${pin.length < 4 && state.lists.length ? "RETOUR À L'ACCUEIL" : "CONNECTER AU SERVEUR"}
                        </button>
                        <button
                            type="button"
                            class="fs-pin-modern-btn-secondary pin-action"
                            id="pinChangeServer"
                            tabindex="-1"
                            disabled=${state.pinLoading || (pin.length < 4 && !state.firebaseUser)}
                            onClick=${function () {
                                if (pin.length === 4) {
                                    store.authenticatePin(pin, "servers").catch(() => {})
                                } else if (state.firebaseUser) {
                                    store.openServers()
                                }
                            }}
                        >
                            🔄 Changer de serveur
                        </button>
                    </div>
                </div>
            </div>

            <!-- Android Full-Screen Circular Progress Overlay (#progress_container) -->
            ${state.pinLoading
                ? html`<div class="fs-progress-overlay" id="progressContainer" aria-live="polite">
                      <div class="fs-progress-circle-wrap">
                          <svg class="fs-progress-ring" viewBox="0 0 140 140">
                              <circle
                                  class="fs-progress-ring-bg"
                                  cx="70"
                                  cy="70"
                                  r="58"
                                  fill="none"
                                  stroke="rgba(148, 163, 184, 0.16)"
                                  stroke-width="8"
                              />
                              <circle
                                  class="fs-progress-ring-fg"
                                  cx="70"
                                  cy="70"
                                  r="58"
                                  fill="none"
                                  stroke="#9A6BFF"
                                  stroke-width="8"
                                  stroke-linecap="round"
                                  stroke-dasharray="364"
                                  stroke-dashoffset=${Math.round(364 - (364 * progressPercent) / 100)}
                              />
                          </svg>
                          <span class="fs-progress-percent">${progressPercent}%</span>
                      </div>
                      <h2 class="fs-progress-wait">Please Wait…</h2>
                      <p class="fs-progress-step">
                          ${state.loading
                              ? state.loading.title
                              : "Connexion au serveur pour récupérer les chaînes, films et séries…"}
                      </p>
                  </div>`
                : null}
        </section>`
    }

    function PinScreen() {
        const state = store.state
        if (state.pinDesign === "classic") {
            return PinScreenClassic()
        }
        return PinScreenModern()
    }

    function ServersScreen() {
        const servers = store.state.firebaseServers || []
        return html`<section class="fs-servers-screen" id="screen-servers">
            <div class="fs-servers-card">
                <header class="fs-servers-header">
                    <button
                        type="button"
                        class="fs-btn-back-pill"
                        id="serversBack"
                        tabindex="-1"
                        onClick=${function () {
                            if (store.state.lists && store.state.lists.length) store.goHome()
                            else store.changeAccountPin()
                        }}
                    >
                        ← RETOUR
                    </button>
                    <${BrandLogo} compact=${true} />
                </header>

                <div class="fs-servers-intro">
                    <h1>Serveurs disponibles</h1>
                    <p>
                        Compte :
                        <strong>
                            ${store.state.firebaseUser ? store.state.firebaseUser.name : "Vérifié"}
                        </strong>
                        · Sélectionnez le portail MAC à utiliser.
                    </p>
                </div>

                <div class="fs-server-list" id="serverList">
                    ${servers.map(
                        (server, index) => html`<button
                            type="button"
                            class=${`fs-server-item server-card${server.id === store.state.activeServerId ? " selected" : ""}`}
                            tabindex="-1"
                            data-server=${server.id}
                            key=${server.id}
                            onClick=${() => store.switchServer(server.id).catch(() => {})}
                        >
                            <span class="fs-server-idx">${String(index + 1).padStart(2, "0")}</span>
                            <span class="fs-server-details">
                                <strong>${server.name}</strong>
                                <small>${server.url}</small>
                                <small class="fs-server-mac">MAC : ${server.mac}</small>
                            </span>
                            <span class="fs-server-status">
                                ${server.id === store.state.activeServerId ? "🟢 ACTIF" : "CHOISIR ›"}
                            </span>
                        </button>`,
                    )}
                </div>
                ${servers.length
                    ? null
                    : html`<p class="empty">Aucun serveur disponible pour ce compte.</p>`}
            </div>
        </section>`
    }

    App.uiScreens.pin = PinScreen
    App.uiScreens.servers = ServersScreen
})()
