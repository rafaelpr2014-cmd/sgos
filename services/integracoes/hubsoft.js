const axios = require("axios");
const { normalizarClientePadrao, primeiroValor } = require("./interface");

function limparBaseUrl(baseUrl){
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if(!base) throw new Error("URL Base da HubSoft não informada.");
    return base;
}

function getPassword(config){
    return String(config.password || config.password_api || "").trim();
}

function temOAuth(config){
    return !!(
        String(config.client_id || "").trim() &&
        String(config.client_secret || "").trim() &&
        String(config.username || "").trim() &&
        getPassword(config)
    );
}

function temTokenDireto(config){
    return !!String(config.token || config.access_token || "").trim();
}

function joinUrl(baseUrl, path){
    const base = limparBaseUrl(baseUrl);
    const p = String(path || "").replace(/^\/+/, "");
    if(!p) return base;

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
    const body = {
        grant_type: "password",
        client_id: String(config.client_id || "").trim(),
        client_secret: String(config.client_secret || "").trim(),
        username: String(config.username || "").trim(),
        password: getPassword(config)
    };

    const paths = ["oauth/token", "api/v1/oauth/token", "api/oauth/token"];
    let ultimoErro = null;

    for(const path of paths){
        const url = joinUrl(baseUrl, path);

        for(const formato of ["form", "json"]){
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
    if(Array.isArray(data?.data?.cliente)) return data.data.cliente;
    if(Array.isArray(data?.resultado)) return data.resultado;
    if(Array.isArray(data?.resultado?.clientes)) return data.resultado.clientes;
    if(Array.isArray(data?.results)) return data.results;
    if(Array.isArray(data?.registros)) return data.registros;
    if(data?.cliente && !Array.isArray(data.cliente)) return [data.cliente];
    if(data?.data?.cliente && !Array.isArray(data.data.cliente)) return [data.data.cliente];
    if(data && typeof data === "object" && (data.id || data.codigo_cliente || data.nome_razaosocial || data.nome || data.id_cliente)) return [data];
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

// =============================
// GraphQL HubSoft
// =============================
const GRAPHQL_ENDPOINTS = ["graphql/v1", "graphql", "api/graphql", "api/v1/graphql"];

function unwrapGraphQLType(type){
    let atual = type;
    while(atual?.ofType) atual = atual.ofType;
    return atual || type;
}

function isScalarGraphQL(type){
    const t = unwrapGraphQLType(type);
    return ["SCALAR", "ENUM"].includes(t?.kind);
}

function ehCampoCliente(nome){
    const n = String(nome || "").toLowerCase();
    return n.includes("cliente") || n.includes("assinante");
}

function argValorParaBusca(argName, busca){
    const n = String(argName || "").toLowerCase();
    if(["busca", "search", "termo", "q", "nome", "nome_razaosocial", "cpf_cnpj", "documento", "cpf", "cnpj", "login", "contrato"].includes(n)) return busca;
    if(["first", "limit", "per_page", "perpage", "take", "quantidade", "page_size"].includes(n)) return 10;
    if(["page", "pagina", "offset", "skip"].includes(n)) return 1;
    return undefined;
}

async function requestGraphQL(config, query, variables = {}, token = null){
    const baseUrl = limparBaseUrl(config.base_url);
    const accessToken = token || await obterToken(config);
    let ultimoErro = null;

    for(const path of GRAPHQL_ENDPOINTS){
        try{
            const resposta = await axios({
                method: "post",
                url: joinUrl(baseUrl, path),
                headers: montarHeaders(config, accessToken),
                data: { query, variables },
                timeout: Number(process.env.HUBSOFT_TIMEOUT_MS || 20000),
                validateStatus: status => status >= 200 && status < 300
            });

            if(resposta.data?.errors?.length){
                const err = new Error(resposta.data.errors.map(e => e.message).join(" | "));
                err.graphqlErrors = resposta.data.errors;
                err.endpoint = path;
                err.responseData = resposta.data;
                throw err;
            }

            return { endpoint: path, data: resposta.data };
        }catch(err){
            ultimoErro = err;
        }
    }

    throw ultimoErro || new Error("Não foi possível acessar o endpoint GraphQL da HubSoft.");
}

async function introspectGraphQL(config, token){
    const query = `
        query SGOSIntrospection {
            __schema {
                queryType { fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } }
                types { name kind fields { name type { kind name ofType { kind name ofType { kind name } } } } }
            }
        }
    `;
    const resp = await requestGraphQL(config, query, {}, token);
    return { endpoint: resp.endpoint, schema: resp.data?.data?.__schema };
}

function selecionarCamposScalar(schema, typeName){
    const type = schema?.types?.find(t => t.name === typeName);
    const fields = Array.isArray(type?.fields) ? type.fields : [];
    const preferidos = [
        "id", "id_cliente", "codigo_cliente", "cliente_id",
        "nome", "nome_razaosocial", "razao_social", "nome_fantasia",
        "cpf_cnpj", "cpf", "cnpj", "documento",
        "telefone", "celular", "whatsapp", "fone", "telefone_celular",
        "status", "ativo", "login", "login_pppoe",
        "endereco", "endereco_completo", "rua", "logradouro", "numero", "bairro", "cidade",
        "latitude", "longitude"
    ];

    const nomes = [];
    for(const p of preferidos){
        const f = fields.find(c => c.name === p && isScalarGraphQL(c.type));
        if(f && !nomes.includes(f.name)) nomes.push(f.name);
    }
    for(const f of fields){
        if(nomes.length >= 28) break;
        if(isScalarGraphQL(f.type) && !nomes.includes(f.name)) nomes.push(f.name);
    }

    return nomes.length ? nomes : ["id"];
}

function extrairListasProfundas(obj, saida = []){
    if(!obj || typeof obj !== "object") return saida;
    if(Array.isArray(obj)){
        if(obj.length && obj.some(item => item && typeof item === "object")) saida.push(obj);
        for(const item of obj) extrairListasProfundas(item, saida);
        return saida;
    }
    for(const value of Object.values(obj)) extrairListasProfundas(value, saida);
    return saida;
}

function filtrarClientesPorBusca(lista, busca){
    const termo = String(busca || "").toLowerCase().replace(/\D/g, "") || String(busca || "").toLowerCase();
    const textoBusca = String(busca || "").toLowerCase();

    return lista.filter(item => {
        if(!item || typeof item !== "object") return false;
        const vals = Object.values(item).map(v => String(v ?? "").toLowerCase()).join(" ");
        const nums = vals.replace(/\D/g, "");
        return vals.includes(textoBusca) || (!!termo && nums.includes(termo));
    });
}

async function buscarClientesGraphQL(config, busca, token){
    const info = await introspectGraphQL(config, token);
    const schema = info.schema;
    const queryFields = schema?.queryType?.fields || [];
    const candidatos = queryFields.filter(f => ehCampoCliente(f.name));
    const debug = [];

    for(const field of candidatos){
        const tipoRetorno = unwrapGraphQLType(field.type);
        const campos = selecionarCamposScalar(schema, tipoRetorno?.name).join("\n");
        const args = [];
        const variables = {};
        const varDefs = [];

        for(const arg of field.args || []){
            const valor = argValorParaBusca(arg.name, busca);
            if(valor === undefined) continue;

            const tipoBase = unwrapGraphQLType(arg.type);
            const varName = arg.name.replace(/[^A-Za-z0-9_]/g, "_");
            variables[varName] = valor;
            args.push(`${arg.name}: $${varName}`);
            varDefs.push(`$${varName}: ${tipoBase?.name === "Int" ? "Int" : "String"}`);
        }

        // Se o campo exige argumentos obrigatórios desconhecidos, pula para evitar erro.
        const obrigatoriosNaoPreenchidos = (field.args || []).some(arg => arg.type?.kind === "NON_NULL" && !args.some(a => a.startsWith(`${arg.name}:`)));
        if(obrigatoriosNaoPreenchidos) continue;

        const query = `query SGOSBuscaHubSoft${varDefs.length ? `(${varDefs.join(", ")})` : ""} {
            ${field.name}${args.length ? `(${args.join(", ")})` : ""} {
                ${campos}
            }
        }`;

        try{
            const resp = await requestGraphQL(config, query, variables, token);
            const bruto = resp.data?.data || {};
            const listas = extrairListasProfundas(bruto);
            let lista = listas.find(l => l.length) || extrairLista(bruto[field.name]);

            if(Array.isArray(lista) && lista.length){
                // Quando a query não possui filtro, filtra localmente.
                if(!args.length) lista = filtrarClientesPorBusca(lista, busca);

                const clientes = lista.map(normalizarHubSoft).filter(c => c && (c.nome || c.id || c.cliente_id));
                if(clientes.length){
                    return {
                        origem_erp: "hubsoft",
                        total: clientes.length,
                        clientes,
                        endpoint: resp.endpoint,
                        metodo: "graphql",
                        campo_graphql: field.name,
                        bruto
                    };
                }
            }

            debug.push({ campo: field.name, args: field.args?.map(a => a.name) || [], total: Array.isArray(lista) ? lista.length : 0 });
        }catch(err){
            debug.push({ campo: field.name, erro: err.message });
        }
    }

    return { origem_erp: "hubsoft", total: 0, clientes: [], debug_graphql: debug.slice(0, 20), endpoint_graphql: info.endpoint };
}

async function testarConexao(config){
    const token = await obterToken(config);

    try{
        const info = await introspectGraphQL(config, token);
        const campos = info.schema?.queryType?.fields?.map(f => f.name).filter(ehCampoCliente).slice(0, 20) || [];
        return {
            ok: true,
            mensagem: "HubSoft conectado com sucesso via GraphQL.",
            endpoint: info.endpoint,
            retorno: { status: "ok", graphql: true, campos_cliente_encontrados: campos }
        };
    }catch(err){
        throw err;
    }
}

async function buscarClientes(config, termo){
    const busca = String(termo || "").trim();
    if(!busca) return { origem_erp: "hubsoft", total: 0, clientes: [] };

    const token = await obterToken(config);
    return buscarClientesGraphQL(config, busca, token);
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
    endpointTeste: "/graphql/v1",
    endpointClientes: "/graphql/v1",
    request,
    requestGraphQL,
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
