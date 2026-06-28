// ===============================
// AUTENTICAÇÃO GLOBAL SGOS
// ===============================

// ===============================
// OBTER USUÁRIO
// ===============================
function obterUsuario() {

    try {

        const usuario =
            localStorage.getItem("usuario");

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

    if (
        !window.location.pathname.includes("login")
    ) {

        window.location.href =
            "/login.html";
    }
}

// ===============================
// VERIFICA LOGIN
// ===============================
(function verificarLoginAutomatico() {

    const usuario =
        obterUsuario();

    const paginaLogin =
        window.location.pathname.includes("login");

    if (!usuario && !paginaLogin) {

        irLogin();
    }

})();

// ===============================
// FETCH ORIGINAL
// ===============================
const fetchOriginal = window.fetch;

// ===============================
// PATCH GLOBAL FETCH
// ===============================
window.fetch = async function(url, opcoes = {}) {

    const usuario =
        obterUsuario();

    // ===============================
    // GARANTE HEADERS
    // ===============================
    opcoes.headers = {
        ...(opcoes.headers || {})
    };

    // ===============================
    // FORM DATA
    // ===============================
    const isFormData =
        opcoes.body instanceof FormData;

    // ===============================
    // CONTENT TYPE
    // ===============================
    if (!isFormData) {

        opcoes.headers["Content-Type"] =
            "application/json";
    }

    // ===============================
    // ACCEPT
    // ===============================
    opcoes.headers["Accept"] =
        "application/json";

    // ===============================
    // AUTH HEADERS
    // ===============================
    if (usuario) {

        opcoes.headers["x-usuario-id"] =
            usuario.id;

        opcoes.headers["x-usuario-nome"] =
            usuario.usuario;

        opcoes.headers["x-usuario-cargo"] =
            usuario.cargo;

        opcoes.headers["x-empresa-id"] =
            usuario.empresa_id;
    }

    try {

        const response =
            await fetchOriginal(url, opcoes);

        // ===============================
        // NÃO AUTORIZADO
        // ===============================
        if (response.status === 401) {

            console.warn(
                "⚠️ Sessão expirada"
            );

            limparSessao();

            irLogin();

            return;
        }

        // ===============================
        // ERRO API
        // ===============================
        if (!response.ok) {

            const text =
                await response.text();

            console.error(
                "Erro API:",
                text
            );

            throw new Error(
                `Erro ${response.status}`
            );
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

    const log_id =
        obterLogId();

    if (!log_id) return;

    try {

        await fetch("/api/ping", {

            method: "POST",

            body: JSON.stringify({
                log_id
            })

        });

        console.log(
            "💓 Ping enviado"
        );

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

    const usuario =
        obterUsuario();

    const paginaLogin =
        window.location.pathname.includes("login");

    if (!usuario || paginaLogin) {
        return;
    }

    // ping imediato
    enviarPing();

    // ping contínuo
    setInterval(() => {

        enviarPing();

    }, 60000); // 1 minuto
}

// ===============================
// INICIA SISTEMA
// ===============================
iniciarPingAutomatico();

// ===============================
// LOGOUT
// ===============================
async function logout() {

    const log_id =
        obterLogId();

    try {

        if (log_id) {

            await fetch("/api/logout", {

                method: "POST",

                keepalive: true,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    log_id
                })

            });

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

    // limpa sessão
    limparSessao();

    // redireciona
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

        // NÃO faz logout
        // apenas para o ping
    }
);