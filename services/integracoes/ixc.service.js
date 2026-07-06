const axios = require("axios");

function limparBaseUrl(baseUrl){
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if(!base) throw new Error("URL Base do IXC não informada.");

    if(base.endsWith("/webservice/v1")){
        return base;
    }

    return `${base}/webservice/v1`;
}

function tokenPareceBase64(token){
    const t = String(token || "").trim();
    if(!t || /[^A-Za-z0-9+/=]/.test(t)) return false;
    if(t.length % 4 !== 0) return false;
    try{
        Buffer.from(t, "base64").toString("utf8");
        return true;
    }catch(e){
        return false;
    }
}

function montarAuthorization(config, modo = "raw"){
    const tokenOriginal = String(config.token || "").trim();

    if(!tokenOriginal){
        throw new Error("Token do IXC não informado.");
    }

    if(/^Basic\s+/i.test(tokenOriginal)){
        return tokenOriginal;
    }

    // IXC geralmente usa o token gerado no usuário já como credencial Basic.
    // Algumas bases antigas/ambientes podem exigir token codificado em base64.
    if(modo === "base64_colon"){
        return "Basic " + Buffer.from(`${tokenOriginal}:`).toString("base64");
    }

    if(modo === "base64"){
        return "Basic " + Buffer.from(tokenOriginal).toString("base64");
    }

    return "Basic " + tokenOriginal;
}

function montarHeaders(config, modoAuth = "raw"){
    return {
        "Authorization": montarAuthorization(config, modoAuth),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "ixcsoft": "listar"
    };
}

function extrairRegistros(resposta){
    const data = resposta?.data ?? resposta;

    if(Array.isArray(data)){
        return data;
    }

    if(Array.isArray(data?.registros)){
        return data.registros;
    }

    if(Array.isArray(data?.data)){
        return data.data;
    }

    if(data && typeof data === "object" && data.registros && typeof data.registros === "object"){
        return Object.values(data.registros);
    }

    return [];
}

async function listar(config, tabela, body = {}){
    const baseUrl = limparBaseUrl(config.base_url);
    const url = `${baseUrl}/${String(tabela || "").replace(/^\/+/, "")}`;

    const payload = {
        qtype: body.qtype || "",
        query: body.query || "",
        oper: body.oper || "LIKE",
        page: String(body.page || "1"),
        rp: String(body.rp || "20"),
        sortname: body.sortname || "id",
        sortorder: body.sortorder || "desc"
    };

    const token = String(config.token || "").trim();
    const modos = /^Basic\s+/i.test(token)
        ? ["raw"]
        : ["raw", "base64_colon", "base64"];

    let ultimoErro = null;

    for(const modoAuth of modos){
        try{
            const resposta = await axios.post(url, payload, {
                headers: montarHeaders(config, modoAuth),
                timeout: Number(process.env.IXC_TIMEOUT_MS || 15000)
            });

            return resposta.data;
        }catch(err){
            ultimoErro = err;

            const status = err.response?.status;
            // Só tenta outro formato quando for falha de autenticação.
            if(status !== 401 && status !== 403){
                throw err;
            }
        }
    }

    throw ultimoErro;
}

function somenteNumeros(valor){
    return String(valor || "").replace(/\D+/g, "");
}

function primeiroValor(...valores){
    return valores.find(v => v !== undefined && v !== null && String(v).trim() !== "") || "";
}


function normalizarNomePlanoIXC(valor){
    let texto = String(valor || "").trim();
    if(!texto) return "";

    // Remove valores comerciais que costumam vir no IXC, ex: "300MEGA R$ 62,90"
    texto = texto.replace(/\s*R\$\s*[0-9.,]+.*/i, "");

    // Remove observações finais, ex: "300MEGA (FIBRA)" quando o SGOS tem o plano como "300MEGA"
    texto = texto.replace(/\s*\([^)]*\)\s*$/g, "");

    // Normaliza espaços
    texto = texto.replace(/\s+/g, " ").trim();

    return texto;
}

function montarEndereco(cliente){
    return [
        primeiroValor(cliente.endereco, cliente.logradouro, cliente.rua),
        primeiroValor(cliente.numero, cliente.n),
        primeiroValor(cliente.bairro),
        primeiroValor(cliente.cidade_nome, cliente.cidade)
    ].filter(Boolean).join(", ");
}

function normalizarCliente(cliente, contrato = null, login = null){
    const nome = primeiroValor(cliente.razao, cliente.nome, cliente.fantasia);
    const telefone = primeiroValor(
        cliente.telefone_celular,
        cliente.celular,
        cliente.whatsapp,
        cliente.telefone,
        cliente.fone
    );

    return {
        origem_erp: "ixc",
        id: String(primeiroValor(cliente.id, cliente.id_cliente)),
        cliente_id: String(primeiroValor(cliente.id, cliente.id_cliente)),
        contrato_id: contrato ? String(primeiroValor(contrato.id, contrato.id_contrato)) : "",
        nome,
        fantasia: primeiroValor(cliente.fantasia),
        cpf_cnpj: primeiroValor(cliente.cnpj_cpf, cliente.cpf_cnpj, cliente.cpf, cliente.cnpj),
        telefone,
        login: primeiroValor(
            login?.login,
            login?.usuario,
            login?.username,
            login?.pppoe_login,
            contrato?.login,
            contrato?.usuario,
            contrato?.pppoe_login,
            cliente.login
        ),
        senha: primeiroValor(login?.senha, login?.password, login?.senha_pppoe, cliente.senha),
        senha_pppoe: primeiroValor(login?.senha, login?.password, login?.senha_pppoe, cliente.senha),
        plano_nome: normalizarNomePlanoIXC(contrato ? primeiroValor(contrato.contrato, contrato.plano, contrato.plano_nome, contrato.descricao, contrato.id_vd_contrato, contrato.id_produto) : primeiroValor(cliente.plano, cliente.plano_nome)),
        plano_nome_erp: contrato ? primeiroValor(contrato.contrato, contrato.plano, contrato.plano_nome, contrato.descricao) : primeiroValor(cliente.plano, cliente.plano_nome),
        plano_id_erp: contrato ? primeiroValor(contrato.id_vd_contrato, contrato.id_produto, contrato.id_plano) : primeiroValor(cliente.id_vd_contrato, cliente.id_plano),
        endereco: montarEndereco(cliente),
        cidade: primeiroValor(cliente.cidade_nome, cliente.cidade),
        rua: primeiroValor(cliente.endereco, cliente.logradouro, cliente.rua),
        numero: primeiroValor(cliente.numero, cliente.n),
        n: primeiroValor(cliente.numero, cliente.n),
        bairro: primeiroValor(cliente.bairro),
        referencia: primeiroValor(cliente.referencia, cliente.complemento),
        latitude: primeiroValor(cliente.latitude, cliente.lat),
        longitude: primeiroValor(cliente.longitude, cliente.lng, cliente.lon),
        status: primeiroValor(cliente.ativo, cliente.status, contrato?.status),
        bruto: { cliente, contrato, login }
    };
}

async function buscarContratosCliente(config, clienteId){
    if(!clienteId) return [];

    try{
        const data = await listar(config, "cliente_contrato", {
            qtype: "cliente_contrato.id_cliente",
            query: String(clienteId),
            oper: "=",
            rp: "10",
            sortname: "id"
        });

        return extrairRegistros(data);
    }catch(err){
        return [];
    }
}


async function buscarLoginsContrato(config, contratoId, clienteId = null){
    const tentativas = [];

    if(contratoId){
        tentativas.push({
            qtype: "radusuarios.id_contrato",
            query: String(contratoId),
            oper: "=",
            rp: "10",
            sortname: "id"
        });
        tentativas.push({
            qtype: "radusuarios.id_cliente_contrato",
            query: String(contratoId),
            oper: "=",
            rp: "10",
            sortname: "id"
        });
        tentativas.push({
            qtype: "radusuarios.contrato",
            query: String(contratoId),
            oper: "=",
            rp: "10",
            sortname: "id"
        });
    }

    if(clienteId){
        tentativas.push({
            qtype: "radusuarios.id_cliente",
            query: String(clienteId),
            oper: "=",
            rp: "10",
            sortname: "id"
        });
    }

    for(const filtro of tentativas){
        try{
            const data = await listar(config, "radusuarios", filtro);
            const registros = extrairRegistros(data);
            if(registros.length){
                if(contratoId){
                    const exato = registros.find(r =>
                        String(primeiroValor(r.id_contrato, r.id_cliente_contrato, r.contrato)).trim() === String(contratoId).trim()
                    );
                    if(exato) return [exato];
                }
                return registros;
            }
        }catch(err){
            // Algumas versões do IXC usam nomes de campos diferentes. Tenta o próximo formato.
        }
    }

    return [];
}

async function buscarLoginsPorLogin(config, termo){
    const busca = String(termo || "").trim();
    if(!busca) return [];

    const tentativas = [
        { qtype: "radusuarios.login", query: busca, oper: "LIKE", rp: "20", sortname: "id" },
        { qtype: "radusuarios.usuario", query: busca, oper: "LIKE", rp: "20", sortname: "id" }
    ];

    for(const filtro of tentativas){
        try{
            const data = await listar(config, "radusuarios", filtro);
            const registros = extrairRegistros(data);
            if(registros.length) return registros;
        }catch(err){
            // ignora e tenta próximo campo
        }
    }

    return [];
}

async function buscarContratoPorId(config, contratoId){
    if(!contratoId) return null;

    try{
        const data = await listar(config, "cliente_contrato", {
            qtype: "cliente_contrato.id",
            query: String(contratoId),
            oper: "=",
            rp: "1",
            sortname: "id"
        });
        return extrairRegistros(data)[0] || null;
    }catch(err){
        return null;
    }
}

async function buscarPorCampo(config, campo, termo, oper = "LIKE", rp = "20"){
    const data = await listar(config, "cliente", {
        qtype: campo,
        query: termo,
        oper,
        rp,
        sortname: "id"
    });

    return extrairRegistros(data);
}

async function buscarClientes(config, termo){
    const busca = String(termo || "").trim();
    if(!busca){
        return { clientes: [] };
    }

    const campos = [];
    const numerico = somenteNumeros(busca);

    if(/^\d+$/.test(busca)){
        campos.push({ campo: "cliente.id", termo: busca, oper: "=" });
    }

    campos.push({ campo: "cliente.razao", termo: busca, oper: "LIKE" });
    campos.push({ campo: "cliente.fantasia", termo: busca, oper: "LIKE" });

    if(numerico.length >= 5){
        campos.push({ campo: "cliente.cnpj_cpf", termo: numerico, oper: "LIKE" });
        campos.push({ campo: "cliente.telefone_celular", termo: numerico, oper: "LIKE" });
        campos.push({ campo: "cliente.telefone", termo: numerico, oper: "LIKE" });
    }

    const mapa = new Map();

    for(const filtro of campos){
        try{
            const encontrados = await buscarPorCampo(config, filtro.campo, filtro.termo, filtro.oper);
            for(const cliente of encontrados){
                const id = String(primeiroValor(cliente.id, cliente.id_cliente));
                if(id && !mapa.has(id)){
                    mapa.set(id, cliente);
                }
            }
        }catch(err){
            // Mantém a busca funcionando mesmo se algum campo não existir na base IXC.
        }

        if(mapa.size >= 20) break;
    }

    const clientes = [];

    // Também permite pesquisar diretamente pelo login PPPoE.
    try{
        const loginsEncontrados = await buscarLoginsPorLogin(config, busca);
        for(const login of loginsEncontrados){
            const clienteIdLogin = primeiroValor(login.id_cliente, login.cliente);
            if(clienteIdLogin && !mapa.has(String(clienteIdLogin))){
                const achados = await buscarPorCampo(config, "cliente.id", String(clienteIdLogin), "=", "1");
                if(achados[0]) mapa.set(String(clienteIdLogin), achados[0]);
            }
        }
    }catch(err){
        // Mantém a busca normal caso a consulta por login não esteja disponível.
    }

    for(const cliente of mapa.values()){
        const clienteId = primeiroValor(cliente.id, cliente.id_cliente);
        const contratos = await buscarContratosCliente(config, clienteId);

        if(contratos.length){
            for(const contrato of contratos){
                const contratoId = primeiroValor(contrato.id, contrato.id_contrato);
                const logins = await buscarLoginsContrato(config, contratoId, clienteId);
                clientes.push(normalizarCliente(cliente, contrato, logins[0] || null));
            }
        }else{
            const logins = await buscarLoginsContrato(config, null, clienteId);
            clientes.push(normalizarCliente(cliente, null, logins[0] || null));
        }
    }

    return {
        origem_erp: "ixc",
        total: clientes.length,
        clientes
    };
}

async function buscarClientePorId(config, id){
    const encontrados = await buscarPorCampo(config, "cliente.id", String(id || ""), "=", "1");
    const cliente = encontrados[0];

    if(!cliente){
        return null;
    }

    const contratos = await buscarContratosCliente(config, cliente.id);
    const contrato = contratos[0] || null;
    const logins = await buscarLoginsContrato(config, contrato ? primeiroValor(contrato.id, contrato.id_contrato) : null, cliente.id);
    return normalizarCliente(cliente, contrato, logins[0] || null);
}

async function testarConexao(config){
    const retorno = await listar(config, "cliente", {
        page: "1",
        rp: "1",
        sortname: "id",
        sortorder: "desc"
    });

    return {
        ok: true,
        mensagem: "IXC conectado com sucesso.",
        amostra: extrairRegistros(retorno).slice(0, 1),
        retorno
    };
}

module.exports = {
    endpointTeste: "/cliente",
    endpointClientes: "/cliente",
    listar,
    testarConexao,
    buscarClientes,
    buscarClientePorId,
    buscarLoginsContrato,
    buscarContratoPorId
};
