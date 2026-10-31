var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.uiScreens = App.uiScreens || {}
;(function () {
    const kit = App.uiKit
    const store = App.store
    const html = kit.html

    function PinScreen() {
        const state = store.state
        const pin = state.pinEntry || ""
        const submit = function (event) {
            if (event && event.preventDefault) event.preventDefault()
            if (pin.length === 4 && !state.pinLoading) {
                store.authenticatePin(pin, "connect").catch(() => {})
            }
        }

        const slots = [0, 1, 2, 3].map((idx) => {
            const hasDigit = idx < pin.length
            const isCurrent = idx === pin.length && !state.pinLoading
            let cls = "pin-slot"
            if (hasDigit) cls += " filled"
            if (isCurrent) cls += " active"
            return html`<div class=${cls} key=${idx}>
                <span class="pin-slot-char">${hasDigit ? "●" : ""}</span>
            </div>`
        })

        return html`<section class="access-screen" id="pinScreen">
            <div class="access-orb access-orb-a"></div>
            <div class="access-orb access-orb-b"></div>
            <div class="access-grid"></div>
            <div class="access-card">
                <div class="access-intro">
                    <div class="access-brand">
                        <span class="access-mark">F</span>
                        <div><strong>FAMILY</strong><span>PREMIUM</span></div>
                    </div>
                    <p class="access-kicker">VOTRE ESPACE DE DIVERTISSEMENT</p>
                    <h1>Bienvenue chez vous.</h1>
                    <p class="access-copy">
                        Connectez-vous pour retrouver vos chaînes, vos films et vos séries.
                    </p>
                    <div class="access-secure">
                        <span></span> Accès privé · Synchronisation sécurisée
                    </div>
                    <p class="access-foot">
                        Utilisez les flèches et la touche OK de votre télécommande.
                    </p>
                </div>
                <div class="access-pin-panel">
                    <p class="access-label">VOTRE CODE PIN · 4 CHIFFRES</p>

                    <div class="pin-display">${slots}</div>

                    ${
                        state.pinLoading
                            ? html`<div class="pin-status loading">
                                      <span class="pin-spinner"></span>
                                      ${state.loading ? state.loading.title : "Connexion sécurisée…"}
                                  </div>
                                  ${
                                      store.loadingRows().length
                                          ? html`<div class="pin-progress" aria-live="polite">
                                                <div class="pin-progress-track">
                                                    <span
                                                        style=${`width:${store.loadingRows()[0].percent}%`}
                                                    ></span>
                                                </div>
                                                <span
                                                    >${store.loadingRows()[0].label}${store.loadingRows()[0].count !== undefined ? ` · ${store.formatCount(store.loadingRows()[0].count)} éléments` : ""}</span
                                                >
                                            </div>`
                                          : null
                                  }`
                            : state.pinError
                              ? html`<div class="pin-status error">
                                    <span class="pin-error-icon">⚠️</span> ${state.pinError}
                                </div>`
                              : html`<div class="pin-status tip">
                                    Entrez votre code à 4 chiffres (ou 0000 pour tester)
                                </div>`
                    }

                    <div class="pin-keypad" id="pinKeypad">
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="1"
                            onClick=${() => store.appendPinDigit("1")}
                            tabindex="-1"
                        >
                            1
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="2"
                            onClick=${() => store.appendPinDigit("2")}
                            tabindex="-1"
                        >
                            2
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="3"
                            onClick=${() => store.appendPinDigit("3")}
                            tabindex="-1"
                        >
                            3
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="4"
                            onClick=${() => store.appendPinDigit("4")}
                            tabindex="-1"
                        >
                            4
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="5"
                            onClick=${() => store.appendPinDigit("5")}
                            tabindex="-1"
                        >
                            5
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="6"
                            onClick=${() => store.appendPinDigit("6")}
                            tabindex="-1"
                        >
                            6
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="7"
                            onClick=${() => store.appendPinDigit("7")}
                            tabindex="-1"
                        >
                            7
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="8"
                            onClick=${() => store.appendPinDigit("8")}
                            tabindex="-1"
                        >
                            8
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="9"
                            onClick=${() => store.appendPinDigit("9")}
                            tabindex="-1"
                        >
                            9
                        </button>
                        <button
                            type="button"
                            class="btn pin-key pin-key-back"
                            data-key="back"
                            onClick=${() => store.backspacePin()}
                            tabindex="-1"
                            title="Effacer"
                        >
                            <span class="pin-key-icon">⌫</span>
                        </button>
                        <button
                            type="button"
                            class="btn pin-key"
                            data-key="0"
                            onClick=${() => store.appendPinDigit("0")}
                            tabindex="-1"
                        >
                            0
                        </button>
                        <button
                            type="button"
                            class=${`btn pin-key pin-key-submit${pin.length === 4 && !state.pinLoading ? " ready" : ""}`}
                            id="pinSubmit"
                            data-key="submit"
                            onClick=${submit}
                            tabindex="-1"
                            title="Valider"
                        >
                            <span class="pin-key-icon">✓</span>
                        </button>
                    </div>

                    ${
                        pin.length === 4
                            ? html`<div class="pin-actions" id="pinActions">
                                  <button
                                      type="button"
                                      class="btn primary pin-action"
                                      id="pinConnect"
                                      tabindex="-1"
                                      disabled=${state.pinLoading}
                                      onClick=${submit}
                                  >
                                      Connecter
                                  </button>
                                  <button
                                      type="button"
                                      class="btn pin-action"
                                      id="pinChangeServer"
                                      tabindex="-1"
                                      disabled=${state.pinLoading}
                                      onClick=${function () {
                                          store.authenticatePin(pin, "servers").catch(() => {})
                                      }}
                                  >
                                      Changer de serveur
                                  </button>
                              </div>`
                            : null
                    }
                    <p class="pin-help">
                        ${
                            pin.length === 4
                                ? "Choisissez une action pour continuer"
                                : "Télécommande : Flèches + OK ou touches 0-9"
                        }
                    </p>
                </div>
            </div>
        </section>`
    }

    function ServersScreen() {
        const servers = store.state.firebaseServers
        return html`<section class="screen access-servers" id="screen-servers">
            <header class="bar">
                <div>
                    <p class="eyebrow">
                        FAMILY PREMIUM · COMPTE
                        ${store.state.firebaseUser ? store.state.firebaseUser.name : ""}
                    </p>
                    <h1>Choisir un serveur</h1>
                </div>
                <button class="btn" id="serversBack" onClick=${store.goHome}>Retour</button>
            </header>
            <p class="access-copy">
                Sélectionnez le portail MAC à utiliser. Votre playlist sera resynchronisée dès
                confirmation.
            </p>
            <div class="server-grid" id="serverList">
                ${servers.map(
                    (server, index) =>
                        html`<button
                            class=${`server-card${server.id === store.state.activeServerId ? " selected" : ""}`}
                            tabindex="-1"
                            data-server=${server.id}
                            key=${server.id}
                            onClick=${() => store.switchServer(server.id).catch(() => {})}
                        >
                            <span class="server-card-index"
                                >${String(index + 1).padStart(2, "0")}</span
                            ><span class="server-card-copy"
                                ><strong>${server.name}</strong><small>${server.url}</small
                                ><small>MAC ${server.mac}</small></span
                            ><span class="server-card-arrow"
                                >${server.id === store.state.activeServerId ? "ACTIF" : "›"}</span
                            >
                        </button>`,
                )}
            </div>
            ${servers.length ? null : html`<p class="empty">Aucun serveur MAC Portal disponible pour ce compte.</p>`}
        </section>`
    }

    App.uiScreens.pin = PinScreen
    App.uiScreens.servers = ServersScreen
})()
