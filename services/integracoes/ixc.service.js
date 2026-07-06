const axios = require("axios");

function limparBaseUrl(baseUrl){
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if(!base) throw new Error("URL Base do IXC não informada.");

    if(base.endsWith("/webservice/v1")){
        return base;
    }

    return `${base}/webservice/v1`;
}

function montarHeaders(config){
    const tokenOriginal = String(config.token || "").trim();

    if(!tokenOriginal){
        throw new Error("Token do IXC não informado.");
    }

    const authorization = /^Basic\s+/i.test(tokenOriginal)
        ? tokenOriginal
        : "Basic " + Buffer.from(`${tokenOriginal}:`).toString("base64");

    return {
        "Authorization": authorization,
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

    const resposta = await axios.post(url, payload, {
        headers: montarHeaders(config),
        timeout: Number(process.env.IXC_TIMEOUT_MS || 15000)
    });

    return resposta.data;
}

function somenteNumeros(valor){
    return String(valor || "").replace(/\D+/g, "");
}

function primeiroValor(...valores){
    return valores.find(v => v !== undefined && v !== null && String(v).trim() !== "") || "";
}

function montarEndereco(cliente){
    return [
        primeiroValor(cliente.endereco, cliente.logradouro, cliente.rua),
        primeiroValor(cliente.numero, cliente.n),
        primeiroValor(cliente.bairro),
        primeiroValor(cliente.cidade_nome, cliente.cidade)
    ].filter(Boolean).join(", ");
}

function normalizarCliente(cliente, contrato = null){
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
        login: contrato ? primeiroValor(contrato.login, contrato.usuario, contrato.pppoe_login) : primeiroValor(cliente.login),
        plano_nome: contrato ? primeiroValor(contrato.plano, contrato.plano_nome, contrato.id_vd_contrato, contrato.id_produto) : primeiroValor(cliente.plano, cliente.plano_nome),
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
        bruto: { cliente, contrato }
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

    for(const cliente of mapa.values()){
        const clienteId = primeiroValor(cliente.id, cliente.id_cliente);
        const contratos = await buscarContratosCliente(config, clienteId);

        if(contratos.length){
            contratos.forEach(contrato => clientes.push(normalizarCliente(cliente, contrato)));
        }else{
            clientes.push(normalizarCliente(cliente));
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
    return normalizarCliente(cliente, contratos[0] || null);
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
    buscarClientePorId
};
