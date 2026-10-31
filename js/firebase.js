var App = App || {} // eslint-disable-line no-var -- shared namespace, no modules

App.firebase = (function () {
    const PROJECT = "familysteam-09"
    const API_KEY = "AIzaSyAjtpSA0-FBoDGQuIT8a3cClZkNRa7C8v4"
    const ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
    let idToken = ""
    let refreshToken = ""
    let tokenExpiresAt = 0

    function proxify(url) {
        if (typeof window !== "undefined" && window.location) {
            const host = window.location.hostname
            const port = window.location.port
            const isLocal =
                host === "localhost" ||
                host === "127.0.0.1" ||
                /^192\.168\./.test(host) ||
                /^10\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
                port === "8090" ||
                host.includes("onrender.com")
            if (isLocal && /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
                return `${window.location.origin}/proxy?url=${encodeURIComponent(url)}`
            }
        }
        return url
    }

    function request(url, options) {
        options = options || {}
        options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {})
        const target = proxify(url)
        return fetch(target, options).then((response) => {
            return response.text().then((body) => {
                let data
                try {
                    data = JSON.parse(body)
                } catch {
                    if (!response.ok) throw new Error(`Firebase HTTP ${response.status}`)
                    throw new Error("Firebase returned an empty or invalid JSON response.")
                }
                if (!response.ok) {
                    throw new Error((data.error && data.error.message) || `Firebase HTTP ${response.status}`)
                }
                return data
            })
        })
    }

    function auth() {
        return request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
            method: "POST",
            body: JSON.stringify({ returnSecureToken: true }),
        }).then((data) => {
            idToken = data.idToken
            refreshToken = data.refreshToken || ""
            tokenExpiresAt = Date.now() + Number(data.expiresIn || 3600) * 1000
            return idToken
        })
    }

    function validToken() {
        if (idToken && Date.now() < tokenExpiresAt - 30000) return Promise.resolve(idToken)
        if (!refreshToken) return auth()
        return request(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        }).then((data) => {
            idToken = data.id_token
            refreshToken = data.refresh_token || refreshToken
            tokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000
            return idToken
        })
    }

    function firestore(url, options) {
        return validToken().then(() => {
            options = options || {}
            options.headers = Object.assign({}, options.headers || {}, { Authorization: `Bearer ${idToken}` })
            return request(url, options)
        })
    }

    function value(field) {
        if (!field) return ""
        if (field.stringValue !== undefined) return field.stringValue
        if (field.integerValue !== undefined) return String(field.integerValue)
        if (field.booleanValue !== undefined) return field.booleanValue
        return ""
    }

    function fields(document) {
        const result = {}
        const source = (document && document.fields) || {}
        Object.keys(source).forEach((key) => (result[key] = value(source[key])))
        return result
    }

    function serverFrom(document) {
        const data = fields(document)
        const get = (keys) => {
            for (let i = 0; i < keys.length; i++) if (data[keys[i]]) return data[keys[i]]
            return ""
        }
        const url = get(["url", "serverUrl", "portalUrl", "portal_url", "host", "link", "server"])
        const mac = get(["macAddress", "mac", "mac_address", "mac_addr", "MAC"]).toUpperCase()
        if (!url || !mac) return null
        return {
            id: (document.name || "").split("/").pop(),
            name: get(["name", "serverName", "title"]) || "Portail IPTV",
            url,
            mac,
            username: get(["username"]),
            password: get(["password"]),
            assignedToUserId: get(["assignedToUserId"]),
        }
    }

    function findUser(pin) {
        return firestore(`${ROOT}:runQuery`, {
            method: "POST",
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: "users" }],
                    where: {
                        fieldFilter: {
                            field: { fieldPath: "pin" },
                            op: "EQUAL",
                            value: { stringValue: pin },
                        },
                    },
                    limit: 1,
                },
            }),
        }).then((rows) => {
            const row = (rows || []).filter((item) => item.document)[0]
            if (!row) throw new Error("Aucun compte ne correspond à ce code PIN.")
            const doc = row.document
            const data = fields(doc)
            if (data.isActive === false || data.isActive === "false") throw new Error("Ce compte est désactivé.")
            return {
                id: (doc.name || "").split("/").pop(),
                name: data.name || data.userName || "Abonné Family Premium",
                assignedServerId: data.assignedServerId || data.serverId || data.server_id || "",
                data,
            }
        })
    }

    function allServers() {
        return firestore(`${ROOT}/servers?pageSize=500`).then((data) => {
            return (data.documents || []).map(serverFrom).filter(Boolean)
        })
    }

    function assignServer(userId, serverId, previousServerId, userName) {
        const userPath = `projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(userId)}`
        const serverPath = `projects/${PROJECT}/databases/(default)/documents/servers/${encodeURIComponent(serverId)}`
        const writes = [
            {
                update: { name: userPath, fields: { assignedServerId: { stringValue: serverId } } },
                updateMask: { fieldPaths: ["assignedServerId"] },
            },
            {
                update: {
                    name: serverPath,
                    fields: {
                        assignedToUserId: { stringValue: userId },
                        assignedToName: { stringValue: userName || "Family Premium" },
                        assignedAt: { timestampValue: new Date().toISOString() },
                    },
                },
                updateMask: { fieldPaths: ["assignedToUserId", "assignedToName", "assignedAt"] },
            },
        ]
        const oldServer = (App.store && App.store.state.firebaseServers || [])
            .filter((server) => server.id === previousServerId && server.assignedToUserId === userId)[0]
        if (previousServerId && previousServerId !== serverId && oldServer) {
            writes.push({
                update: { name: `projects/${PROJECT}/databases/(default)/documents/servers/${encodeURIComponent(previousServerId)}`, fields: {} },
                updateMask: { fieldPaths: ["assignedToUserId", "assignedToName", "assignedAt"] },
            })
        }
        return firestore(`${ROOT}:commit`, { method: "POST", body: JSON.stringify({ writes }) })
    }

    function signIn(pin) {
        return auth().then(() => Promise.all([findUser(pin), allServers()])).then((results) => {
            const user = results[0]
            const all = results[1]
            let selected = all.filter((server) => server.id === user.assignedServerId)[0]
            if (!selected) selected = all.filter((server) => server.assignedToUserId === user.id)[0]
            if (!selected) {
                const data = user.data
                const url = data.serverUrl || data.url || data.portalUrl || data.portal_url || ""
                const mac = (data.macAddress || data.mac || data.mac_address || "").toUpperCase()
                if (url && mac) selected = { id: user.assignedServerId, name: data.serverName || user.name, url, mac }
            }
            if (!selected) throw new Error("Aucun serveur MAC Portal n’est associé à ce compte.")
            const servers = all.filter((server) => !server.assignedToUserId || server.assignedToUserId === user.id)
            return { user, servers, selected }
        })
    }

    return { signIn, assignServer }
})()
