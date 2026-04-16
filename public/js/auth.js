// ===============================
// AUTENTICAÇÃO GLOBAL SDOS
// ===============================

// Obter usuário do localStorage
function obterUsuario() {
    const usuario = localStorage.getItem("usuario");
    return usuario ? JSON.parse(usuario) : null;
}

// Verificar login automaticamente
(function verificarLoginAutomatico() {
    const usuario = obterUsuario();
    const paginaLogin = window.location.pathname.includes("login");

    if (!usuario && !paginaLogin) {
        window.location.href = "/login.html";
    }
})();

// ===============================
// PATCH GLOBAL DO FETCH
// ===============================

const fetchOriginal = window.fetch;

window.fetch = async function(url, opcoes = {}) {
    const usuario = obterUsuario();

    opcoes.headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(opcoes.headers || {})
    };

    // Headers de autenticação
    if (usuario) {
        opcoes.headers["x-usuario-id"] = usuario.id;
        opcoes.headers["x-usuario-nome"] = usuario.usuario;
        opcoes.headers["x-usuario-cargo"] = usuario.cargo;
        opcoes.headers["x-empresa-id"] = usuario.empresa_id; // 🔥 ESSENCIAL
    }

    try {
        const response = await fetchOriginal(url, opcoes);

        // 🔐 Não autorizado
        if (response.status === 401) {
            localStorage.removeItem("usuario");
            window.location.href = "/login.html";
            return;
        }

        // ❌ erro backend (evita quebrar JSON)
        if (!response.ok) {
            const text = await response.text();
            console.error("Erro API:", text);
            throw new Error(`Erro ${response.status}`);
        }

        return response;

    } catch (err) {
        console.error("Erro fetch:", err);
        throw err;
    }
};

// ===============================
// LOGOUT
// ===============================
function logout() {
    localStorage.removeItem("usuario");
    window.location.href = "/login.html";
}