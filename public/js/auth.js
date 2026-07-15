// ===============================
// AUTENTICAÇÃO GLOBAL SGOS
// ===============================

// ===============================
// OBTER USUÁRIO
// ===============================
function obterUsuario() {
    try {
        const usuario = localStorage.getItem("usuario");

        return usuario
            ? JSON.parse(usuario)
            : null;
    } catch {
        return null;
    }
}

// ===============================
// OBTER LOG_ID
// ===============================
function obterLogId() {
    return localStorage.getItem("log_id");
}

// ===============================
// REMOVER SESSÃO
// ===============================
function limparSessao() {
    localStorage.removeItem("usuario");
    localStorage.removeItem("log_id");
}

// ===============================
// REDIRECIONAR LOGIN
// ===============================
function irLogin() {
    if (!window.location.pathname.includes("login")) {
        window.location.href = "/login.html";
    }
}

// ===============================
// VERIFICA LOGIN
// ===============================
(function verificarLoginAutomatico() {
    const usuario = obterUsuario();
    const paginaLogin =
        window.location.pathname.includes("login");

    if (!usuario && !paginaLogin) {
        irLogin();
    }
})();

// ===============================
// FETCH ORIGINAL
// ===============================
const fetchOriginal = window.fetch.bind(window);

// ===============================
// IDENTIFICA ROTA OPCIONAL WHATSAPP
// ===============================
function ehRotaWhatsapp(url) {
    try {
        const caminho =
            new URL(url, window.location.origin).pathname;

        return caminho.startsWith("/api/whatsapp/");
    } catch {
        return String(url || "")
            .startsWith("/api/whatsapp/");
    }
}

// ===============================
// PATCH GLOBAL FETCH
// ===============================
window.fetch = async function(url, opcoes = {}) {
    const usuario = obterUsuario();

    // Clona os headers para não alterar o objeto original.
    const headers =
        new Headers(opcoes.headers || {});

    const isFormData =
        opcoes.body instanceof FormData;

    // Só define Content-Type quando existe corpo JSON.
    // Evita Content-Type desnecessário em GET.
    if (
        !isFormData &&
        opcoes.body !== undefined &&
        opcoes.body !== null &&
        !headers.has("Content-Type")
    ) {
        headers.set(
            "Content-Type",
            "application/json"
        );
    }

    if (!headers.has("Accept")) {
        headers.set(
            "Accept",
            "application/json"
        );
    }

    if (usuario) {
        if (usuario.id !== undefined && usuario.id !== null) {
            headers.set(
                "x-usuario-id",
                String(usuario.id)
            );
        }

        headers.set(
            "x-usuario-nome",
            String(
                usuario.usuario ||
                usuario.nome ||
                ""
            )
        );

        headers.set(
            "x-usuario-cargo",
            String(usuario.cargo || "")
        );

        const empresaId =
            usuario.empresa_id ??
            usuario.empresaId ??
            usuario.id_empresa ??
            usuario.empresa?.id;

        if (
            empresaId !== undefined &&
            empresaId !== null &&
            empresaId !== ""
        ) {
            headers.set(
                "x-empresa-id",
                String(empresaId)
            );
        }
    }

    try {
        const response =
            await fetchOriginal(url, {
                ...opcoes,
                credentials:
                    opcoes.credentials ||
                    "same-origin",
                headers
            });

        // =================================================
        // WHATSAPP É MÓDULO OPCIONAL
        // Um 401/403 do WhatsApp não significa que o login
        // inteiro do SGOS expirou.
        // =================================================
        if (
            ehRotaWhatsapp(url) &&
            (
                response.status === 401 ||
                response.status === 403
            )
        ) {
            console.warn(
                "⚠️ WhatsApp não autorizado ou indisponível:",
                response.status
            );

            // Retorna a Response normalmente.
            // A própria página exibirá "desconectado".
            return response;
        }

        // =================================================
        // DEMAIS ROTAS: mantém o comportamento anterior
        // =================================================
        if (response.status === 401) {
            console.warn("⚠️ Sessão expirada");

            limparSessao();
            irLogin();

            // Não devolve undefined silenciosamente.
            const erro =
                new Error("Sessão expirada");

            erro.status = 401;
            throw erro;
        }

        if (!response.ok) {
            // Usa clone para não consumir o body da resposta
            // que pode ser tratado por quem chamou fetch().
            let text = "";

            try {
                text =
                    await response
                        .clone()
                        .text();
            } catch {}

            console.error(
                "Erro API:",
                text || response.status
            );

            const erro =
                new Error(
                    `Erro ${response.status}`
                );

            erro.status =
                response.status;

            erro.response =
                response;

            throw erro;
        }

        return response;

    } catch (err) {
        console.error(
            "Erro fetch:",
            err
        );

        throw err;
    }
};

// ===============================
// PING AUTOMÁTICO
// ===============================
async function enviarPing() {
    const log_id = obterLogId();

    if (!log_id) return;

    try {
        await fetch("/api/ping", {
            method: "POST",
            body: JSON.stringify({
                log_id
            })
        });

        console.log("💓 Ping enviado");

    } catch (err) {
        console.error(
            "Erro ping:",
            err
        );
    }
}

// ===============================
// INICIA PING
// ===============================
function iniciarPingAutomatico() {
    const usuario = obterUsuario();

    const paginaLogin =
        window.location.pathname.includes("login");

    if (!usuario || paginaLogin) {
        return;
    }

    enviarPing();

    setInterval(() => {
        enviarPing();
    }, 60000);
}

// ===============================
// INICIA SISTEMA
// ===============================
iniciarPingAutomatico();

// ===============================
// LOGOUT
// ===============================
async function logout() {
    const log_id = obterLogId();

    try {
        if (log_id) {
            await fetchOriginal(
                "/api/logout",
                {
                    method: "POST",
                    keepalive: true,
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        log_id
                    })
                }
            );

            console.log(
                "🚪 Logout registrado"
            );
        }

    } catch (err) {
        console.error(
            "Erro logout:",
            err
        );
    }

    limparSessao();

    window.location.href =
        "/login.html";
}

// ===============================
// FECHOU ABA/NAVEGADOR
// ===============================
window.addEventListener(
    "beforeunload",
    () => {
        console.log(
            "📴 Página encerrada"
        );
    }
);
