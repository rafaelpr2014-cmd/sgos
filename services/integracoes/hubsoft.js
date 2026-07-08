const axios = require("axios");
const { normalizarClientePadrao, primeiroValor } = require("./interface");

function limparBaseUrl(baseUrl){
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if(!base) throw new Error("URL Base da HubSoft não informada.");
    return base;
}

function temOAuth(config){
    return !!(
        String(config.client_id || "").trim() &&
        String(config.client_secret || "").trim() &&
        String(config.username || "").trim() &&
        String(config.password || config.password || "").trim()
    );
}

function temTokenDireto(config){
    return !!String(config.token || config.access_token || "").trim();
}

function joinUrl(baseUrl, path){
    const base = limparBaseUrl(baseUrl);
    const p = String(path || "").replace(/^\/+/, "");
    if(!p) return base;

    // Evita duplicar /api/v1 quando a URL Base já foi cadastrada com /api/v1.
    if(/\/api\/v1$/i.test(base) && /^api\/v1\//i.test(p)){
        return `${base}/${p.replace(/^api\/v1\//i, "")}`;
    }

    return `${base}/${p}`;
}

function montarHeaders(config, tokenOverride = null){
    const token = String(tokenOverride || config.access_token || config.token || "").trim();
    if(!token) throw new Error("Token da HubSoft não informado ou não gerado.");

    return {
        "Authorization": /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`,
        "Accept": "application/json",
        "Content-Type": "application/json"
    };
}

async function autenticarOAuth(config){
    if(!temOAuth(config)){
        throw new Error("Credenciais OAuth da HubSoft incompletas. Informe client_id, client_secret, username e password.");
    }

    const baseUrl = limparBaseUrl(config.base_url);
    const password = String(config.password || config.password || "").trim();

    const body = {
        grant_type: "password",
        client_id: String(config.client_id || "").trim(),
        client_secret: String(config.client_secret || "").trim(),
        username: String(config.username || "").trim(),
        password
    };

    const paths = [
        "oauth/token",
        "api/v1/oauth/token",
        "api/oauth/token"
    ];

    let ultimoErro = null;

    for(const path of paths){
        const url = joinUrl(baseUrl, path);
        for(const formato of ["json", "form"]){
            try{
                const resposta = await axios({
                    method: "post",
                    url,
                    headers: formato === "form"
                        ? { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" }
                        : { "Accept": "application/json", "Content-Type": "application/json" },
                    data: formato === "form" ? new URLSearchParams(body).toString() : body,
                    timeout: Number(process.env.HUBSOFT_TIMEOUT_MS || 15000),
                    validateStatus: status => status >= 200 && status < 300
                });

                const accessToken = primeiroValor(
                    resposta.data?.access_token,
                    resposta.data?.token,
                    resposta.data?.data?.access_token,
                    resposta.data?.data?.token
                );

                if(!accessToken){
                    throw new Error("HubSoft autenticou, mas não retornou access_token.");
                }

                return {
                    access_token: accessToken,
                    refresh_token: primeiroValor(resposta.data?.refresh_token, resposta.data?.data?.refresh_token),
                    expires_in: primeiroValor(resposta.data?.expires_in, resposta.data?.data?.expires_in),
                    bruto: resposta.data,
                    endpoint_auth: path
                };
            }catch(err){
                ultimoErro = err;
            }
        }
    }

    throw ultimoErro || new Error("Não foi possível autenticar na HubSoft.");
}

async function obterToken(config){
    // Se existir OAuth completo, prioriza OAuth. Se falhar, tenta token direto se foi informado.
    if(temOAuth(config)){
        try{
            const auth = await autenticarOAuth(config);
            return auth.access_token;
        }catch(err){
            if(temTokenDireto(config)) return String(config.token || config.access_token || "").trim();
            throw err;
        }
    }

    if(temTokenDireto(config)) return String(config.token || config.access_token || "").trim();

    throw new Error("Informe o token Bearer ou as credenciais OAuth da HubSoft.");
}

async function request(config, method, path, options = {}){
    const baseUrl = limparBaseUrl(config.base_url);
    const url = joinUrl(baseUrl, path);
    const token = options.token || await obterToken(config);

    const resposta = await axios({
        method,
        url,
        headers: montarHeaders(config, token),
        params: options.params || undefined,
        data: options.data || undefined,
        timeout: Number(process.env.HUBSOFT_TIMEOUT_MS || 15000),
        validateStatus: status => status >= 200 && status < 300
    });

    return resposta.data;
}

function extrairLista(data){
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.clientes)) return data.clientes;
    if(Array.isArray(data?.cliente)) return data.cliente;
    if(Array.isArray(data?.data)) return data.data;
    if(Array.isArray(data?.data?.data)) return data.data.data;
    if(Array.isArray(data?.data?.clientes)) return data.data.clientes;
    if(Array.isArray(data?.resultado)) return data.resultado;
    if(Array.isArray(data?.resultado?.clientes)) return data.resultado.clientes;
    if(Array.isArray(data?.results)) return data.results;
    if(Array.isArray(data?.registros)) return data.registros;
    if(data?.cliente) return [data.cliente];
    if(data?.data?.cliente) return [data.data.cliente];
    if(data && typeof data === "object" && (data.id || data.codigo_cliente || data.nome_razaosocial || data.nome)) return [data];
    return [];
}

function normalizarHubSoft(cliente = {}){
    const contrato = primeiroValor(cliente.contrato, cliente.contrato_servico, cliente.servico, cliente.contratos?.[0], cliente.servicos?.[0]) || {};
    const endereco = primeiroValor(cliente.endereco, cliente.endereco_principal, cliente.endereco_instalacao, cliente.enderecos?.[0]) || {};
    const login = primeiroValor(cliente.login, cliente.login_pppoe, cliente.usuario_pppoe, contrato.login, contrato.login_pppoe) || {};
    const plano = primeiroValor(cliente.plano, cliente.plano_servico, cliente.servico, contrato.plano) || {};

    return normalizarClientePadrao({
        origem_erp: "hubsoft",
        id: primeiroValor(cliente.id, cliente.codigo_cliente, cliente.cliente_id, cliente.id_cliente),
        cliente_id: primeiroValor(cliente.id, cliente.codigo_cliente, cliente.cliente_id, cliente.id_cliente),
        contrato_id: primeiroValor(cliente.contrato_id, contrato.id, contrato.codigo_contrato, contrato.id_contrato, contrato.contrato_id),
        nome: primeiroValor(cliente.nome_razaosocial, cliente.nome, cliente.razao_social, cliente.fantasia, cliente.nome_cliente),
        fantasia: primeiroValor(cliente.nome_fantasia, cliente.fantasia),
        cpf_cnpj: primeiroValor(cliente.cpf_cnpj, cliente.cnpj_cpf, cliente.documento, cliente.cpf, cliente.cnpj),
        telefone: primeiroValor(cliente.telefone, cliente.celular, cliente.whatsapp, cliente.fone, cliente.telefone_celular),
        login: primeiroValor(cliente.usuario, cliente.login_pppoe, login.login, login.usuario, login.username),
        senha: primeiroValor(cliente.senha, cliente.senha_pppoe, login.senha, login.password),
        senha_pppoe: primeiroValor(cliente.senha_pppoe, cliente.senha, login.senha, login.password),
        plano_nome: primeiroValor(cliente.plano_nome, plano.nome, plano.descricao, plano.nome_plano),
        plano_nome_erp: primeiroValor(cliente.plano_nome, plano.nome, plano.descricao, plano.nome_plano),
        plano_id_erp: primeiroValor(cliente.plano_id, plano.id, plano.codigo, plano.id_plano),
        endereco: typeof endereco === "string" ? endereco : primeiroValor(endereco.completo, endereco.endereco_completo, cliente.endereco_completo),
        rua: primeiroValor(cliente.rua, endereco.rua, endereco.logradouro, endereco.endereco),
        numero: primeiroValor(cliente.numero, endereco.numero),
        bairro: primeiroValor(cliente.bairro, endereco.bairro, endereco.nome_bairro),
        cidade: primeiroValor(cliente.cidade, endereco.cidade, endereco.nome_cidade),
        referencia: primeiroValor(cliente.referencia, endereco.referencia, cliente.complemento, endereco.complemento),
        latitude: primeiroValor(cliente.latitude, endereco.latitude),
        longitude: primeiroValor(cliente.longitude, endereco.longitude),
        status: primeiroValor(cliente.status, cliente.ativo, contrato.status, contrato.status_contrato),
        bruto: { cliente, contrato, login, plano, endereco }
    }, "hubsoft");
}

async function testarConexao(config){
    const token = await obterToken(config);

    const tentativas = [
        { method: "get", path: "api/v1/clientes", params: { per_page: 1, limit: 1 } },
        { method: "get", path: "api/v1/cliente", params: { per_page: 1, limit: 1 } },
        { method: "get", path: "api/v1/integracao/clientes", params: { per_page: 1, limit: 1 } },
        { method: "get", path: "api/v1/integracao/cliente", params: { per_page: 1, limit: 1 } },
        { method: "get", path: "clientes", params: { per_page: 1, limit: 1 } },
        { method: "get", path: "cliente", params: { per_page: 1, limit: 1 } }
    ];

    let ultimoErro = null;
    for(const t of tentativas){
        try{
            const retorno = await request(config, t.method, t.path, { params: t.params, token });
            return { ok: true, mensagem: "HubSoft conectado com sucesso.", endpoint: t.path, retorno };
        }catch(err){
            ultimoErro = err;
        }
    }

    throw ultimoErro || new Error("Não foi possível conectar na HubSoft.");
}

async function executarTentativaBusca(config, tentativa, token){
    if(tentativa.method === "post"){
        return request(config, "post", tentativa.path, { data: tentativa.data, params: tentativa.params, token });
    }
    return request(config, "get", tentativa.path, { params: tentativa.params, token });
}

async function buscarClientes(config, termo){
    const busca = String(termo || "").trim();
    if(!busca) return { origem_erp: "hubsoft", total: 0, clientes: [] };

    const token = await obterToken(config);

    const paramsBusca = [
        { busca },
        { search: busca },
        { termo: busca },
        { q: busca },
        { nome: busca },
        { cpf_cnpj: busca },
        { documento: busca },
        { login: busca },
        { contrato: busca }
    ];

    const paths = [
        "api/v1/clientes",
        "api/v1/cliente",
        "api/v1/integracao/clientes",
        "api/v1/integracao/cliente",
        "clientes",
        "cliente",
        "integracao/clientes",
        "integracao/cliente"
    ];

    const tentativas = [];

    for(const path of paths){
        for(const params of paramsBusca){
            tentativas.push({ method: "get", path, params });
        }
    }

    for(const path of paths){
        tentativas.push({ method: "post", path, data: { busca } });
        tentativas.push({ method: "post", path, data: { termo: busca } });
        tentativas.push({ method: "post", path, data: { search: busca } });
        tentativas.push({ method: "post", path, data: { nome: busca } });
    }

    tentativas.push({ method: "get", path: `api/v1/clientes/${encodeURIComponent(busca)}` });
    tentativas.push({ method: "get", path: `api/v1/cliente/${encodeURIComponent(busca)}` });
    tentativas.push({ method: "get", path: `api/v1/integracao/cliente/${encodeURIComponent(busca)}` });
    tentativas.push({ method: "get", path: `clientes/${encodeURIComponent(busca)}` });
    tentativas.push({ method: "get", path: `cliente/${encodeURIComponent(busca)}` });

    let ultimoErro = null;
    const debugTentativas = [];

    for(const t of tentativas){
        try{
            const retorno = await executarTentativaBusca(config, t, token);
            const lista = extrairLista(retorno);
            debugTentativas.push({ endpoint: t.path, method: t.method, params: t.params || null, data: t.data || null, total_extraido: lista.length });

            const clientes = lista.map(normalizarHubSoft);
            if(clientes.length){
                return {
                    origem_erp: "hubsoft",
                    total: clientes.length,
                    clientes,
                    bruto: retorno,
                    endpoint: t.path,
                    metodo: t.method
                };
            }
        }catch(err){
            ultimoErro = err;
            const status = err.response?.status;
            debugTentativas.push({ endpoint: t.path, method: t.method, params: t.params || null, data: t.data || null, erro: status || err.message });
        }
    }

    if(ultimoErro && ultimoErro.response?.status && ![404, 405, 422].includes(ultimoErro.response.status)){
        throw ultimoErro;
    }

    return { origem_erp: "hubsoft", total: 0, clientes: [], debug: debugTentativas.slice(0, 20) };
}

async function buscarCliente(config, termo){
    const resposta = await buscarClientes(config, termo);
    return resposta.clientes?.[0] || null;
}

async function buscarClienteCompleto(config, termo){
    return buscarCliente(config, termo);
}

async function buscarContrato(config, clienteOuTermo){
    if(typeof clienteOuTermo === "object") return clienteOuTermo.bruto?.contrato || null;
    const cliente = await buscarClienteCompleto(config, clienteOuTermo);
    return cliente?.bruto?.contrato || null;
}

async function buscarLogin(config, clienteOuTermo){
    if(typeof clienteOuTermo === "object") return clienteOuTermo.bruto?.login || clienteOuTermo.login || null;
    const cliente = await buscarClienteCompleto(config, clienteOuTermo);
    return cliente?.bruto?.login || cliente?.login || null;
}

async function buscarPlano(config, clienteOuTermo){
    if(typeof clienteOuTermo === "object"){
        return clienteOuTermo.bruto?.plano || { id: clienteOuTermo.plano_id_erp || "", nome: clienteOuTermo.plano_nome || "" };
    }
    const cliente = await buscarClienteCompleto(config, clienteOuTermo);
    return cliente ? (cliente.bruto?.plano || { id: cliente.plano_id_erp || "", nome: cliente.plano_nome || "" }) : null;
}

module.exports = {
    endpointTeste: "/api/v1/clientes",
    endpointClientes: "/api/v1/clientes",
    request,
    autenticarOAuth,
    testarConexao,
    buscarClientes,
    buscarCliente,
    buscarClienteCompleto,
    buscarClientePorId: buscarClienteCompleto,
    buscarContrato,
    buscarLogin,
    buscarPlano
};
