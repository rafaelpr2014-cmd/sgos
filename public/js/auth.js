// ===============================
// AUTENTICAÇÃO GLOBAL SGOS
// Presença: offline após 5 min sem atividade.
// Sessão: logout automático após 8 h sem atividade.
// ===============================

const SGOS_OFFLINE_MS = 5 * 60 * 1000;
const SGOS_LOGOUT_MS = 8 * 60 * 60 * 1000;
const SGOS_PING_MS = 60 * 1000;
const SGOS_ACTIVITY_KEY = "sgos_ultima_atividade";

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
    localStorage.removeItem("usuario");
    localStorage.removeItem("log_id");
    localStorage.removeItem(SGOS_ACTIVITY_KEY);
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

function tempoInativo() {
    return Math.max(0, Date.now() - obterUltimaAtividade());
}

function usuarioEstaAtivo() {
    return tempoInativo() < SGOS_OFFLINE_MS;
}

function sessaoExpiradaLocalmente() {
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
    const log_id = obterLogId();
    try {
        if (log_id) {
            await fetchOriginal("/api/logout", {
                method: "POST",
                keepalive: true,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ log_id, motivo: "inatividade_8h" })
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
    }

    const response = await fetchOriginal(url, {
        ...opcoes,
        credentials: opcoes.credentials || "same-origin",
        headers
    });

    if (ehRotaWhatsapp(url) && (response.status === 401 || response.status === 403)) {
        return response;
    }

    if (response.status === 401) {
        let motivo = "sessao_expirada";
        try {
            const body = await response.clone().json();
            motivo = body?.motivo || motivo;
        } catch {}
        limparSessao();
        irLogin(motivo);
        const erro = new Error("Sessão expirada");
        erro.status = 401;
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
                "x-empresa-id": String(usuario.empresa_id || "")
            },
            body: JSON.stringify({
                log_id,
                ativo,
                ultima_atividade: new Date(obterUltimaAtividade()).toISOString()
            })
        });

        if (response.status === 401) {
            limparSessao();
            irLogin("sessao_expirada");
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

    setInterval(() => {
        if (sessaoExpiradaLocalmente()) {
            finalizarSessaoAutomaticaLocal();
            return;
        }
        enviarPing(false);
    }, SGOS_PING_MS);
}

iniciarControleDeAtividade();

async function logout() {
    const log_id = obterLogId();
    try {
        if (log_id) {
            await fetchOriginal("/api/logout", {
                method: "POST",
                keepalive: true,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ log_id, motivo: "manual" })
            });
        }
    } catch (err) {
        console.error("Erro ao registrar logout:", err);
    } finally {
        limparSessao();
        window.location.replace("/login.html");
    }
}
