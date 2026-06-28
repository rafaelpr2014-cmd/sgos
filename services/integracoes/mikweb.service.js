// services/integracoes/mikweb.service.js
const axios = require("axios");

function limparBaseUrl(baseUrl) {
    return String(baseUrl || "").replace(/\/+$/, "");
}

function headers(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
    };
}

async function get(config, endpoint, params = {}) {
    const baseUrl = limparBaseUrl(config.base_url);

    return axios.get(`${baseUrl}${endpoint}`, {
        headers: headers(config.token),
        params,
        timeout: 15000
    }).then(r => r.data);
}

async function testarConexao(config) {
    return get(config, "/customers", { limit: 1 });
}

async function buscarClientes(config, termo = "") {
    const dados = await get(config, "/customers", {
        search: termo
    });

    const clientes = dados.customers || [];

    return {
        clientes: clientes.map(normalizarClienteMikWeb),
        total: dados.meta?.pages?.total_count || clientes.length
    };
}

async function buscarClientePorId(config, id) {
    const dados = await get(config, `/customers/${id}`);
    const c = dados.customer || dados;
    return normalizarClienteMikWeb(c);
}

function normalizarClienteMikWeb(cliente) {
    return {
        origem_erp: "mikweb",
        id: cliente.id || null,

        nome: cliente.full_name || cliente.name || "-",

        endereco: [
            cliente.street,
            cliente.number,
            cliente.neighborhood,
            cliente.city,
            cliente.state
        ].filter(Boolean).join(", "),

        cidade: cliente.city || "-",
        rua: cliente.street || "-",
        n: cliente.number || "",
        numero: cliente.number || "",
        bairro: cliente.neighborhood || "-",
        referencia: cliente.complement || "-",

        plano: cliente.plan?.name || "-",
        plano_id_erp: cliente.plan?.id || cliente.plan_id || null,

        login: cliente.login || cliente.user || cliente.name || "-",

        telefone:
            cliente.cell_phone_number_1 ||
            cliente.cell_phone_number_2 ||
            cliente.cell_phone_number_3 ||
            cliente.cell_phone_number_4 ||
            cliente.phone_number ||
            "",

        status_contrato: cliente.status || "-",

        status_conexao:
            cliente.ip_pppoe || cliente.ip
                ? "Online"
                : "Não informado",

        ip_pppoe: cliente.ip_pppoe || cliente.ip || null,

        latitude: cliente.latitude || null,
        longitude: cliente.longitude || null,

        servidor: cliente.server?.name || "-"
    };
}

module.exports = {
    endpointTeste: "/customers",
    endpointClientes: "/customers",
    testarConexao,
    buscarClientes,
    buscarClientePorId
};
