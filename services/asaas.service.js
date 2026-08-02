const axios = require('axios');

function getConfig() {
    const ambiente = String(process.env.ASAAS_ENV || 'sandbox').trim().toLowerCase();
    const baseURL = String(process.env.ASAAS_API_URL || (
        ambiente === 'production'
            ? 'https://api.asaas.com/v3'
            : 'https://api-sandbox.asaas.com/v3'
    )).trim().replace(/\/+$/, '');

    // dotenv remove aspas externas automaticamente. O trim evita espaços/quebras acidentais.
    const apiKey = String(process.env.ASAAS_API_KEY || '').trim();

    if (!apiKey) {
        const erro = new Error('ASAAS_API_KEY não configurada no arquivo .env.');
        erro.codigo = 'ASAAS_NAO_CONFIGURADO';
        throw erro;
    }

    return { ambiente, baseURL, apiKey };
}

function criarClienteHttp() {
    const { baseURL, apiKey } = getConfig();
    return axios.create({
        baseURL,
        timeout: 30000,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            access_token: apiKey,
            'User-Agent': 'SGOS/1.0 Asaas Integration'
        },
        validateStatus: () => true
    });
}

function mensagemErroAsaas(data, status) {
    const erros = Array.isArray(data?.errors)
        ? data.errors.map(item => item?.description || item?.code).filter(Boolean)
        : [];
    return erros.join(' | ') || data?.message || `Erro na API Asaas (HTTP ${status}).`;
}

async function requisicao(method, url, data, params) {
    const http = criarClienteHttp();
    let resposta;

    try {
        resposta = await http.request({ method, url, data, params });
    } catch (falhaRede) {
        const erro = new Error(falhaRede?.message || 'Falha de conexão com o Asaas.');
        erro.status = 0;
        erro.codigo = 'ASAAS_FALHA_REDE';
        erro.detalhes = {
            code: falhaRede?.code || null,
            method,
            url
        };
        throw erro;
    }

    if (resposta.status < 200 || resposta.status >= 300) {
        const erro = new Error(mensagemErroAsaas(resposta.data, resposta.status));
        erro.status = resposta.status;
        erro.codigo = 'ERRO_ASAAS';
        erro.detalhes = resposta.data || null;
        throw erro;
    }

    return resposta.data;
}

function normalizarDocumento(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function normalizarTelefone(valor) {
    return String(valor || '').replace(/\D/g, '');
}

async function localizarClientes(filtros = {}) {
    return requisicao('GET', '/customers', undefined, filtros);
}

async function criarCliente(dados) {
    return requisicao('POST', '/customers', dados);
}

async function consultarCliente(customerId) {
    return requisicao('GET', `/customers/${encodeURIComponent(customerId)}`);
}

async function atualizarCliente(customerId, dados) {
    return requisicao('PUT', `/customers/${encodeURIComponent(customerId)}`, dados);
}

async function criarCobranca(dados) {
    return requisicao('POST', '/payments', dados);
}

async function consultarCobranca(paymentId) {
    return requisicao('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

async function atualizarCobranca(paymentId, dados) {
    return requisicao('PUT', `/payments/${encodeURIComponent(paymentId)}`, dados);
}

async function removerCobranca(paymentId) {
    return requisicao('DELETE', `/payments/${encodeURIComponent(paymentId)}`);
}

module.exports = {
    getConfig,
    normalizarDocumento,
    normalizarTelefone,
    localizarClientes,
    criarCliente,
    consultarCliente,
    atualizarCliente,
    criarCobranca,
    consultarCobranca,
    atualizarCobranca,
    removerCobranca
};
