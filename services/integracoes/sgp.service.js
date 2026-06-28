// services/integracoes/sgp.service.js
const axios = require("axios");

function limparBaseUrl(baseUrl) {
    return String(baseUrl || "").replace(/\/+$/, "");
}

function montarPayload(config, extra = {}) {
    return {
        app: config.app,
        token: config.token,
        ...extra
    };
}

async function post(config, endpoint, body = {}) {
    const baseUrl = limparBaseUrl(config.base_url);

    return axios.post(`${baseUrl}${endpoint}`, montarPayload(config, body), {
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        timeout: 15000
    }).then(r => r.data);
}

// ===============================
// TESTAR CONEXÃO
// ===============================
async function testarConexao(config) {
    return post(config, "/api/ura/consultacliente/", {});
}

// ===============================
// BUSCAR CLIENTES
// ===============================
async function buscarClientes(config, termo = "") {
    const t = String(termo || "").trim();

    const tentativas = [];

    if (t) {
        tentativas.push({ contrato: t });
        tentativas.push({ login: t });
        tentativas.push({ cpfcnpj: t });
        tentativas.push({ telefone: t });
        tentativas.push({ nome: t });
    } else {
        tentativas.push({});
    }

    let ultimoBruto = null;
    let ultimoErro = null;

    for (const filtro of tentativas) {
        try {
            const dados = await post(config, "/api/ura/consultacliente/", filtro);
            ultimoBruto = dados;

            const clientes = extrairClientesSGP(dados);

            if (clientes.length) {
                return {
                    clientes: clientes.map(normalizarClienteSGP),
                    total: clientes.length,
                    bruto: dados
                };
            }

        } catch (err) {
            ultimoErro = err;
        }
    }

    if (ultimoErro && !ultimoBruto) {
        throw ultimoErro;
    }

    return {
        clientes: [],
        total: 0,
        bruto: ultimoBruto
    };
}

// ===============================
// BUSCAR POR ID
// ===============================
async function buscarClientePorId(config, id) {
    const resultado = await buscarClientes(config, id);
    return resultado.clientes?.[0] || {};
}

// ===============================
// EXTRAI CLIENTES DO RETORNO SGP
// ===============================
function extrairClientesSGP(dados) {
    if (!dados) return [];

    // Padrão real encontrado:
    // {
    //   msg: "Contrato(s) Localizado(s)",
    //   contratos: [ ... ]
    // }
    if (Array.isArray(dados.contratos)) {
        return dados.contratos;
    }

    if (Array.isArray(dados)) return dados;

    if (Array.isArray(dados.clientes)) return dados.clientes;
    if (Array.isArray(dados.cliente)) return dados.cliente;
    if (Array.isArray(dados.resultado)) return dados.resultado;
    if (Array.isArray(dados.results)) return dados.results;
    if (Array.isArray(dados.data)) return dados.data;

    if (dados.cliente && typeof dados.cliente === "object") return [dados.cliente];

    if (
        dados.razaoSocial ||
        dados.razao_social ||
        dados.nome ||
        dados.contratoId ||
        dados.clienteId ||
        dados.servico_login
    ) {
        return [dados];
    }

    return [];
}

function primeiro(...valores) {
    return valores.find(v =>
        v !== undefined &&
        v !== null &&
        String(v).trim() !== ""
    ) || "";
}

function telefoneSGP(c) {
    if (Array.isArray(c.telefones) && c.telefones.length) {
        return c.telefones[0];
    }

    if (Array.isArray(c.telefones_cargos) && c.telefones_cargos.length) {
        const item = c.telefones_cargos[0];

        if (typeof item === "string") return item;

        return primeiro(
            item.telefone,
            item.numero,
            item.celular
        );
    }

    return primeiro(
        c.telefone,
        c.celular,
        c.fone,
        c.whatsapp
    );
}

function statusContratoSGP(c) {
    return primeiro(
        c.contratoStatusDisplay,
        c.status_display,
        c.status,
        c.contratoStatus
    );
}

// ===============================
// NORMALIZA CLIENTE SGP PARA PADRÃO SGOS
// ===============================
function normalizarClienteSGP(c) {
    const rua = primeiro(
        c.endereco_logradouro,
        c.logradouro,
        c.rua
    );

    const numero = primeiro(
        c.endereco_numero,
        c.numero,
        c.n
    );

    const bairro = primeiro(
        c.endereco_bairro,
        c.bairro
    );

    const cidade = primeiro(
        c.endereco_cidade,
        c.cidade,
        c.municipio,
        c.popNome
    );

    const referencia = primeiro(
        c.endereco_complemento,
        c.endereco_pontoreferencia,
        c.referencia,
        c.complemento
    );

    const plano = primeiro(
        c.servico_plano,
        c.planointernet,
        c.plano,
        c.plano_nome,
        c.servico_nome
    );

    const login = primeiro(
        c.servico_login,
        c.contratoCentralLogin,
        c.login,
        c.usuario,
        c.pppoe_login
    );

    const nome = primeiro(
        c.razaoSocial,
        c.razao_social,
        c.nome,
        c.nome_cliente,
        c.cliente
    );

    return {
        origem_erp: "sgp",

        // Aqui uso contratoId como ID principal porque é o que você vai buscar na OS.
        id: primeiro(
            c.contratoId,
            c.contrato_id,
            c.id,
            c.clienteId,
            c.codigo
        ),

        cliente_id_erp: primeiro(
            c.clienteId,
            c.cliente_id
        ),

        nome: nome || "-",

        endereco: [
            rua,
            numero,
            bairro,
            cidade
        ].filter(Boolean).join(", "),

        cidade: cidade || "-",
        rua: rua || "-",
        n: numero || "",
        numero: numero || "",
        bairro: bairro || "-",
        referencia: referencia || "-",

        plano: plano || "-",
        plano_id_erp: primeiro(
            c.planoId,
            c.plano_id,
            c.servico_plano_id
        ) || null,

        login: login || "",

        telefone: telefoneSGP(c) || "",

        status_contrato: statusContratoSGP(c) || "-",

        status_conexao: primeiro(
            c.status_conexao,
            c.online,
            c.servico_status_conexao
        ) || "Não informado",

        ip_pppoe: primeiro(
            c.ip,
            c.ip_pppoe,
            c.servico_ip
        ) || null,

        latitude: primeiro(
            c.latitude,
            c.endereco_latitude
        ) || null,

        longitude: primeiro(
            c.longitude,
            c.endereco_longitude
        ) || null,

        servidor: primeiro(
            c.servidor,
            c.popNome
        ) || "-"
    };
}

module.exports = {
    endpointTeste: "/api/ura/consultacliente/",
    endpointClientes: "/api/ura/consultacliente/",
    testarConexao,
    buscarClientes,
    buscarClientePorId
};
