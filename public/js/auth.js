// ===============================
// AUTENTICAÇÃO GLOBAL SGOS
// Presença: offline após 5 min sem atividade.
// Sessão: logout automático após 8 h sem atividade.
// ===============================

const SGOS_OFFLINE_MS = 5 * 60 * 1000;
const SGOS_LOGOUT_MS = 8 * 60 * 60 * 1000;
const SGOS_PING_MS = 60 * 1000;
const SGOS_ACTIVITY_KEY = "sgos_ultima_atividade";

function executandoNoApp() {
    try {
        const params = new URLSearchParams(window.location.search);
        return localStorage.getItem("is_app") === "1" ||
               params.get("app") === "1" ||
               Boolean(window.Capacitor);
    } catch {
        return localStorage.getItem("is_app") === "1";
    }
}

function obterUsuario() {
    try {
        const valor = localStorage.getItem("usuario");
        return valor ? JSON.parse(valor) : null;
    } catch {
        return null;
    }
}

function obterLogId() {
    return localStorage.getItem("log_id");
}

function obterUltimaAtividade() {
    const valor = Number(localStorage.getItem(SGOS_ACTIVITY_KEY));
    return Number.isFinite(valor) && valor > 0 ? valor : Date.now();
}

function salvarUltimaAtividade(timestamp = Date.now()) {
    localStorage.setItem(SGOS_ACTIVITY_KEY, String(timestamp));
}

function limparSessao() {
    [
        "usuario",
        "log_id",
        "usuario_id",
        "sessao_app",
        "token",
        "sgos_token",
        "is_app",
        "empresa_id",
        "empresa_nome",
        "empresa_logo",
        "push_usuario_id",
        SGOS_ACTIVITY_KEY
    ].forEach(chave => localStorage.removeItem(chave));

    // Mantém provedor/api_base para o app saber em qual empresa abrir,
    // mas impede a restauração do usuário anterior.
    sessionStorage.clear();
}

function irLogin(motivo = "") {
    if (window.location.pathname.includes("login")) return;
    const destino = motivo ? `/login.html?motivo=${encodeURIComponent(motivo)}` : "/login.html";
    window.location.replace(destino);
}

(function verificarLoginAutomatico() {
    const usuario = obterUsuario();
    const paginaLogin = window.location.pathname.includes("login");
    if (!usuario && !paginaLogin) irLogin();
})();

const fetchOriginal = window.fetch.bind(window);
let ultimoPingEnviado = 0;
let pingEmAndamento = false;
let ultimoEstadoAtivo = null;
let timerAtividade = null;
let intervaloPing = null;
let logoutEmAndamento = false;

const SGOS_LOGOUT_EVENT_KEY = "sgos_logout_event";
const canalSessaoSGOS = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("sgos_sessao")
    : null;

function avisarOutrasAbasLogout(logId) {
    const payload = {
        tipo: "logout",
        log_id: String(logId || ""),
        em: Date.now()
    };

    try {
        localStorage.setItem(SGOS_LOGOUT_EVENT_KEY, JSON.stringify(payload));
    } catch {}

    try {
        canalSessaoSGOS?.postMessage(payload);
    } catch {}
}

function receberLogoutExterno(payload) {
    if (!payload || payload.tipo !== "logout") return;

    const atual = obterLogId();
    if (payload.log_id && atual && String(payload.log_id) !== String(atual)) return;

    logoutEmAndamento = true;
    clearTimeout(timerAtividade);
    if (intervaloPing) clearInterval(intervaloPing);
    limparSessao();

    if (!window.location.pathname.includes("login")) {
        window.location.replace("/login.html?logout=1&t=" + Date.now());
    }
}

window.addEventListener("storage", (evento) => {
    if (evento.key !== SGOS_LOGOUT_EVENT_KEY || !evento.newValue) return;
    try { receberLogoutExterno(JSON.parse(evento.newValue)); } catch {}
});

if (canalSessaoSGOS) {
    canalSessaoSGOS.onmessage = (evento) => receberLogoutExterno(evento.data);
}


function tempoInativo() {
    return Math.max(0, Date.now() - obterUltimaAtividade());
}

function usuarioEstaAtivo() {
    return tempoInativo() < SGOS_OFFLINE_MS;
}

function sessaoExpiradaLocalmente() {
    if (executandoNoApp()) return false;
    return tempoInativo() >= SGOS_LOGOUT_MS;
}

function ehRotaWhatsapp(url) {
    try {
        return new URL(url, window.location.origin).pathname.startsWith("/api/whatsapp/");
    } catch {
        return String(url || "").startsWith("/api/whatsapp/");
    }
}

function ehRotaPublica(url) {
    try {
        const caminho = new URL(url, window.location.origin).pathname;
        return caminho === "/api/login" || caminho === "/api/health";
    } catch {
        return false;
    }
}

async function finalizarSessaoAutomaticaLocal() {
    if (logoutEmAndamento) return;
    logoutEmAndamento = true;

    const log_id = obterLogId();
    const usuario = obterUsuario();

    clearTimeout(timerAtividade);
    if (intervaloPing) {
        clearInterval(intervaloPing);
        intervaloPing = null;
    }

    try {
        if (log_id) {
            await fetchOriginal("/api/logout", {
                method: "POST",
                keepalive: true,
                headers: {
                    "Content-Type": "application/json",
                    "x-log-id": String(log_id),
                    "x-usuario-id": String(usuario?.id || ""),
                    "x-empresa-id": String(usuario?.empresa_id || "")
                },
                body: JSON.stringify({
                    log_id,
                    usuario_id: usuario?.id || null,
                    empresa_id: usuario?.empresa_id || null,
                    motivo: "inatividade_8h"
                })
            });
        }
    } catch (err) {
        console.warn("Não foi possível registrar o logout automático local:", err);
    } finally {
        limparSessao();
        irLogin("sessao_expirada");
    }
}

window.fetch = async function(url, opcoes = {}) {
    const usuario = obterUsuario();

    if (usuario && !ehRotaPublica(url) && sessaoExpiradaLocalmente()) {
        await finalizarSessaoAutomaticaLocal();
        const erro = new Error("Sessão expirada por inatividade");
        erro.status = 401;
        throw erro;
    }

    const headers = new Headers(opcoes.headers || {});
    const isFormData = opcoes.body instanceof FormData;

    if (!isFormData && opcoes.body != null && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    if (usuario) {
        if (usuario.id != null) headers.set("x-usuario-id", String(usuario.id));
        const logId = obterLogId();
        if (logId) headers.set("x-log-id", String(logId));
        headers.set("x-usuario-nome", String(usuario.usuario || usuario.nome || ""));
        headers.set("x-usuario-cargo", String(usuario.cargo || ""));
        headers.set("x-sgos-active", usuarioEstaAtivo() ? "1" : "0");

        const empresaId = usuario.empresa_id ?? usuario.empresaId ?? usuario.id_empresa ?? usuario.empresa?.id;
        if (empresaId != null && empresaId !== "") headers.set("x-empresa-id", String(empresaId));
        if (executandoNoApp()) headers.set("x-sgos-app", "1");
    }

    let credentials = opcoes.credentials;
    if (!credentials) {
        try {
            const destino = new URL(url, window.location.href);
            credentials = destino.origin === window.location.origin ? "same-origin" : "omit";
        } catch {
            credentials = "same-origin";
        }
    }

    const response = await fetchOriginal(url, {
        ...opcoes,
        credentials,
        headers
    });

    if (ehRotaWhatsapp(url) && (response.status === 401 || response.status === 403)) {
        return response;
    }

    if (response.status === 402) {
        let body = {};
        try {
            body = await response.clone().json();
        } catch {}

        if (body?.codigo === "EMPRESA_SUSPENSA_FINANCEIRO") {
            try {
                sessionStorage.setItem(
                    "sgos_suspensao_financeira",
                    JSON.stringify(body)
                );
            } catch {}

            const paginaFinanceiraPermitida =
                window.location.pathname.includes("acesso-suspenso") ||
                window.location.pathname.includes("minhas-faturas");

            if (!paginaFinanceiraPermitida) {
                window.location.replace(body?.redirecionar || "/acesso-suspenso.html");
            }
        }

        const erro = new Error(body?.erro || "Acesso suspenso por pendência financeira");
        erro.status = 402;
        erro.codigo = body?.codigo || "EMPRESA_SUSPENSA_FINANCEIRO";
        erro.detalhes = body;
        throw erro;
    }

    if (response.status === 401) {
        let motivo = "sessao_invalida";
        try {
            const body = await response.clone().json();
            motivo = body?.motivo || motivo;
        } catch {}

        // No aplicativo não tratamos inatividade como logout.
        // Apenas sessões realmente encerradas/inválidas voltam ao login.
        const encerrar = !executandoNoApp() ||
            ["sessao_encerrada", "sessao_invalida", "usuario_invalido"].includes(motivo);

        if (encerrar) {
            limparSessao();
            irLogin(motivo);
        }

        const erro = new Error(motivo === "inatividade_8h" ? "Sessão expirada" : "Não autenticado");
        erro.status = 401;
        erro.motivo = motivo;
        throw erro;
    }

    if (!response.ok) {
        let text = "";
        try { text = await response.clone().text(); } catch {}
        const erro = new Error(text || `Erro ${response.status}`);
        erro.status = response.status;
        erro.response = response;
        throw erro;
    }

    return response;
};

async function enviarPing(forcar = false) {
    if (logoutEmAndamento) return;

    const log_id = obterLogId();
    const usuario = obterUsuario();
    if (!log_id || !usuario || pingEmAndamento) return;

    const ativo = usuarioEstaAtivo();
    const agora = Date.now();
    if (!forcar && ultimoEstadoAtivo === ativo && agora - ultimoPingEnviado < SGOS_PING_MS) return;

    pingEmAndamento = true;
    try {
        const response = await fetchOriginal("/api/ping", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                "x-usuario-id": String(usuario.id),
                "x-log-id": String(log_id),
                "x-empresa-id": String(usuario.empresa_id || ""),
                "x-sgos-app": executandoNoApp() ? "1" : "0"
            },
            body: JSON.stringify({
                log_id,
                ativo: executandoNoApp() ? true : ativo,
                app_mobile: executandoNoApp() ? 1 : 0,
                ultima_atividade: new Date(obterUltimaAtividade()).toISOString()
            })
        });

        if (response.status === 401) {
            if (!executandoNoApp()) {
                limparSessao();
                irLogin("sessao_expirada");
            }
            return;
        }

        ultimoPingEnviado = agora;
        ultimoEstadoAtivo = ativo;
    } catch (err) {
        console.warn("Erro ao atualizar presença:", err);
    } finally {
        pingEmAndamento = false;
    }
}

function registrarAtividadeReal() {
    const estavaOffline = !usuarioEstaAtivo();
    salvarUltimaAtividade();
    clearTimeout(timerAtividade);
    timerAtividade = setTimeout(() => enviarPing(estavaOffline), 350);
}

function iniciarControleDeAtividade() {
    const usuario = obterUsuario();
    if (!usuario || window.location.pathname.includes("login")) return;

    if (!localStorage.getItem(SGOS_ACTIVITY_KEY)) salvarUltimaAtividade();

    ["mousedown", "keydown", "touchstart", "scroll"].forEach(evento => {
        window.addEventListener(evento, registrarAtividadeReal, { passive: true });
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) registrarAtividadeReal();
    });

    enviarPing(true);

    intervaloPing = setInterval(() => {
        if (logoutEmAndamento) return;

        if (sessaoExpiradaLocalmente()) {
            finalizarSessaoAutomaticaLocal();
            return;
        }
        enviarPing(false);
    }, SGOS_PING_MS);
}

iniciarControleDeAtividade();

async function logout() {
    if (logoutEmAndamento) return;
    logoutEmAndamento = true;

    const log_id = obterLogId();
    const usuario = obterUsuario();

    // Impede um ping concorrente de manter a sessão como ativa durante o logout.
    clearTimeout(timerAtividade);
    if (intervaloPing) {
        clearInterval(intervaloPing);
        intervaloPing = null;
    }

    let logoutRegistrado = !log_id;

    try {
        if (log_id) {
            const headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "x-log-id": String(log_id),
                "x-sgos-app": executandoNoApp() ? "1" : "0"
            };

            if (usuario?.id != null) {
                headers["x-usuario-id"] = String(usuario.id);
            }

            if (usuario?.empresa_id != null) {
                headers["x-empresa-id"] = String(usuario.empresa_id);
            }

            const resposta = await fetchOriginal("/api/logout", {
                method: "POST",
                credentials: "same-origin",
                keepalive: true,
                headers,
                body: JSON.stringify({
                    log_id,
                    usuario_id: usuario?.id || null,
                    empresa_id: usuario?.empresa_id || null,
                    motivo: "manual"
                })
            });

            // 200 = encerrada agora; 404 também pode significar que já estava encerrada.
            logoutRegistrado = resposta.ok || resposta.status === 404;

            if (!logoutRegistrado) {
                let detalhe = "";
                try {
                    detalhe = await resposta.text();
                } catch {}

                throw new Error(
                    detalhe || `Falha ao encerrar sessão no servidor (${resposta.status})`
                );
            }
        }
    } catch (err) {
        console.error("Erro ao registrar logout:", err);

        // Segunda tentativa simples, útil em WebView durante troca de página.
        if (log_id && navigator.sendBeacon) {
            try {
                const dados = new Blob(
                    [JSON.stringify({
                        log_id,
                        usuario_id: usuario?.id || null,
                        empresa_id: usuario?.empresa_id || null,
                        motivo: "manual_beacon"
                    })],
                    { type: "application/json" }
                );

                logoutRegistrado = navigator.sendBeacon("/api/logout", dados);
            } catch (beaconErr) {
                console.warn("Falha também no sendBeacon de logout:", beaconErr);
            }
        }
    } finally {
        avisarOutrasAbasLogout(log_id);
        limparSessao();

        const destino = executandoNoApp()
            ? "/login.html?logout=1"
            : "/login.html?logout=1";

        window.location.replace(destino);
    }
}
