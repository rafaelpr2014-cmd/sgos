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
// BUSCAR CLIENTES POR ENDEREÇO
// ===============================
function textoFiltro(v) {
    return String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function clientePassaFiltrosEndereco(c, filtros = {}) {
    const contem = (valor, busca) => !busca || textoFiltro(valor).includes(textoFiltro(busca));

    return (
        contem(c.cidade, filtros.localidade || filtros.cidade) &&
        contem(c.rua || c.endereco, filtros.rua) &&
        contem(c.bairro, filtros.bairro) &&
        contem(c.referencia, filtros.referencia)
    );
}

function chaveClienteSGP(c) {
    return String(
        c.id ||
        c.contrato_id ||
        c.cliente_id_erp ||
        c.login ||
        c.telefone ||
        `${c.nome || ""}-${c.rua || ""}-${c.numero || ""}`
    );
}

async function buscarClientesPorFiltros(config, filtros = {}) {
    const f = {
        localidade: String(filtros.localidade || filtros.cidade || "").trim(),
        rua: String(filtros.rua || "").trim(),
        bairro: String(filtros.bairro || "").trim(),
        referencia: String(filtros.referencia || "").trim()
    };

    const temFiltro = Object.values(f).some(Boolean);
    if (!temFiltro) {
        return { clientes: [], total: 0, bruto: null };
    }

    const mapa = new Map();
    let ultimoBruto = null;
    let ultimoErro = null;

    // Algumas instalações/versões do SGP aceitam filtros adicionais no endpoint URA.
    // Tentamos os nomes mais comuns. Se não houver retorno, fazemos a consulta ampla
    // e aplicamos o filtro de endereço no SGOS.
    const tentativas = [];

    if (f.localidade) {
        tentativas.push({ cidade: f.localidade });
        tentativas.push({ endereco_cidade: f.localidade });
    }
    if (f.rua) {
        tentativas.push({ logradouro: f.rua });
        tentativas.push({ endereco_logradouro: f.rua });
        tentativas.push({ rua: f.rua });
    }
    if (f.bairro) {
        tentativas.push({ bairro: f.bairro });
        tentativas.push({ endereco_bairro: f.bairro });
    }
    if (f.referencia) {
        tentativas.push({ referencia: f.referencia });
        tentativas.push({ endereco_pontoreferencia: f.referencia });
        tentativas.push({ endereco_complemento: f.referencia });
        tentativas.push({ complemento: f.referencia });
    }

    // Se houver mais de um filtro, também tenta o conjunto completo.
    tentativas.unshift({
        ...(f.localidade ? { cidade: f.localidade } : {}),
        ...(f.rua ? { logradouro: f.rua } : {}),
        ...(f.bairro ? { bairro: f.bairro } : {}),
        ...(f.referencia ? { referencia: f.referencia } : {})
    });

    for (const filtro of tentativas) {
        try {
            const dados = await post(config, "/api/ura/consultacliente/", filtro);
            ultimoBruto = dados;
            const clientes = extrairClientesSGP(dados).map(normalizarClienteSGP);
            for (const cliente of clientes) {
                if (clientePassaFiltrosEndereco(cliente, f)) {
                    mapa.set(chaveClienteSGP(cliente), cliente);
                }
            }
        } catch (err) {
            ultimoErro = err;
        }
    }

    // Fallback importante: o teste de conexão desta própria integração já consulta
    // o endpoint com payload vazio. Em instalações que permitem essa consulta ampla,
    // aproveitamos o retorno e filtramos localmente por cidade/rua/bairro/referência.
    if (mapa.size === 0) {
        try {
            const dados = await post(config, "/api/ura/consultacliente/", {});
            ultimoBruto = dados;
            const clientes = extrairClientesSGP(dados).map(normalizarClienteSGP);
            for (const cliente of clientes) {
                if (clientePassaFiltrosEndereco(cliente, f)) {
                    mapa.set(chaveClienteSGP(cliente), cliente);
                }
            }
        } catch (err) {
            ultimoErro = err;
        }
    }

    if (mapa.size === 0 && ultimoErro && !ultimoBruto) {
        throw ultimoErro;
    }

    const clientes = [...mapa.values()];
    return {
        clientes,
        total: clientes.length,
        bruto: ultimoBruto
    };
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
    function extrairContato(valor){
        if (!valor) return "";

        if (Array.isArray(valor)) {
            const preferido =
                valor.find(v => String(v?.tipoContato || v?.tipo || "").toLowerCase().includes("celular") && String(v?.tipoContato || v?.tipo || "").toLowerCase().includes("pessoal")) ||
                valor.find(v => String(v?.tipoContato || v?.tipo || "").toLowerCase().includes("celular")) ||
                valor.find(v => String(v?.tipoContato || v?.tipo || "").toLowerCase().includes("whatsapp")) ||
                valor[0];

            return extrairContato(preferido);
        }

        if (typeof valor === "object") {
            return primeiro(
                valor.contato,
                valor.telefone,
                valor.numero,
                valor.celular,
                valor.whatsapp,
                valor.fone
            );
        }

        const texto = String(valor).trim();
        return texto === "[object Object]" ? "" : texto;
    }

    return primeiro(
        extrairContato(c.telefones),
        extrairContato(c.telefones_cargos),
        extrairContato(c.telefone),
        extrairContato(c.celular),
        extrairContato(c.fone),
        extrairContato(c.whatsapp)
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
        plano_nome: plano || "",
        plano_nome_erp: plano || "",
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
    buscarClientesPorFiltros,
    buscarClientePorId
};
