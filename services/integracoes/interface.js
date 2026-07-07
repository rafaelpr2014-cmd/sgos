/**
 * Interface padrão dos ERPs do SGOS.
 *
 * Todo provider deve expor estes métodos, mesmo que internamente precise
 * adaptar a API do ERP:
 * - testarConexao(config)
 * - buscarCliente(config, termo)
 * - buscarPlano(config, clienteOuContrato)
 * - buscarLogin(config, clienteOuContrato)
 * - buscarContrato(config, clienteOuTermo)
 * - buscarClienteCompleto(config, termo)
 *
 * Compatibilidade mantida:
 * - buscarClientes(config, termo)
 * - buscarClientePorId(config, id)
 */

function primeiroValor(...valores){
    return valores.find(v => v !== undefined && v !== null && String(v).trim() !== "") || "";
}

function normalizarListaResposta(resposta, origem = ""){
    if(!resposta) return [];
    if(Array.isArray(resposta)) return resposta;
    if(Array.isArray(resposta.clientes)) return resposta.clientes;
    if(Array.isArray(resposta.data)) return resposta.data;
    if(Array.isArray(resposta.registros)) return resposta.registros;
    if(resposta.id || resposta.nome || resposta.cliente_id){
        return [{...resposta, origem_erp: resposta.origem_erp || origem}];
    }
    return [];
}

function normalizarClientePadrao(cliente = {}, origem = ""){
    const contrato = cliente.contrato && typeof cliente.contrato === "object" ? cliente.contrato : {};
    const plano = cliente.plano && typeof cliente.plano === "object" ? cliente.plano : {};
    const login = cliente.login && typeof cliente.login === "object" ? cliente.login : {};
    const endereco = cliente.endereco && typeof cliente.endereco === "object" ? cliente.endereco : {};

    return {
        origem_erp: cliente.origem_erp || origem,
        id: String(primeiroValor(cliente.id, cliente.cliente_id, cliente.codigo)),
        cliente_id: String(primeiroValor(cliente.cliente_id, cliente.id, cliente.codigo)),
        contrato_id: String(primeiroValor(cliente.contrato_id, contrato.id, contrato.contrato_id)),
        nome: primeiroValor(cliente.nome, cliente.razao, cliente.razao_social, cliente.fantasia),
        fantasia: primeiroValor(cliente.fantasia, cliente.nome_fantasia),
        cpf_cnpj: primeiroValor(cliente.cpf_cnpj, cliente.cnpj_cpf, cliente.cpf, cliente.cnpj),
        telefone: primeiroValor(cliente.telefone, cliente.celular, cliente.whatsapp, cliente.fone),
        login: primeiroValor(cliente.login, login.login, login.usuario, login.username),
        senha: primeiroValor(cliente.senha, cliente.senha_pppoe, login.senha, login.password),
        senha_pppoe: primeiroValor(cliente.senha_pppoe, cliente.senha, login.senha, login.password),
        plano_nome: primeiroValor(cliente.plano_nome, plano.nome, plano.descricao),
        plano_nome_erp: primeiroValor(cliente.plano_nome_erp, cliente.plano_nome, plano.nome, plano.descricao),
        plano_id_erp: primeiroValor(cliente.plano_id_erp, plano.id, cliente.id_plano),
        endereco: typeof cliente.endereco === "string" ? cliente.endereco : primeiroValor(endereco.completo, cliente.endereco_completo),
        cidade: primeiroValor(cliente.cidade, endereco.cidade),
        cidade_id_erp: primeiroValor(cliente.cidade_id_erp, endereco.cidade_id),
        rua: primeiroValor(cliente.rua, endereco.rua, endereco.logradouro),
        numero: primeiroValor(cliente.numero, cliente.n, endereco.numero),
        n: primeiroValor(cliente.n, cliente.numero, endereco.numero),
        bairro: primeiroValor(cliente.bairro, endereco.bairro),
        referencia: primeiroValor(cliente.referencia, endereco.referencia, cliente.complemento, endereco.complemento),
        latitude: primeiroValor(cliente.latitude, endereco.latitude),
        longitude: primeiroValor(cliente.longitude, endereco.longitude),
        status: primeiroValor(cliente.status, cliente.ativo, contrato.status),
        bruto: cliente.bruto || cliente
    };
}

function criarProviderPadrao(nome, service){
    if(!service || typeof service !== "object"){
        throw new Error(`Provider ${nome} inválido.`);
    }

    async function buscarCliente(config, termo){
        if(typeof service.buscarCliente === "function") return service.buscarCliente(config, termo);
        if(typeof service.buscarClientes === "function"){
            const resposta = await service.buscarClientes(config, termo);
            return normalizarListaResposta(resposta, nome)[0] || null;
        }
        if(typeof service.buscarClientePorId === "function") return service.buscarClientePorId(config, termo);
        throw new Error(`Provider ${nome} não implementa buscarCliente.`);
    }

    async function buscarClienteCompleto(config, termo){
        if(typeof service.buscarClienteCompleto === "function") return service.buscarClienteCompleto(config, termo);
        const cliente = await buscarCliente(config, termo);
        return cliente ? normalizarClientePadrao(cliente, nome) : null;
    }

    async function buscarClientes(config, termo){
        if(typeof service.buscarClientes === "function") return service.buscarClientes(config, termo);
        const cliente = await buscarClienteCompleto(config, termo);
        return { origem_erp: nome, total: cliente ? 1 : 0, clientes: cliente ? [cliente] : [] };
    }

    async function buscarContrato(config, clienteOuTermo){
        if(typeof service.buscarContrato === "function") return service.buscarContrato(config, clienteOuTermo);
        if(typeof service.buscarContratoPorId === "function") return service.buscarContratoPorId(config, clienteOuTermo?.contrato_id || clienteOuTermo);
        const cliente = typeof clienteOuTermo === "object" ? clienteOuTermo : await buscarClienteCompleto(config, clienteOuTermo);
        return cliente?.bruto?.contrato || cliente?.contrato || null;
    }

    async function buscarLogin(config, clienteOuTermo){
        if(typeof service.buscarLogin === "function") return service.buscarLogin(config, clienteOuTermo);
        const cliente = typeof clienteOuTermo === "object" ? clienteOuTermo : await buscarClienteCompleto(config, clienteOuTermo);
        return cliente?.bruto?.login || cliente?.login || null;
    }

    async function buscarPlano(config, clienteOuTermo){
        if(typeof service.buscarPlano === "function") return service.buscarPlano(config, clienteOuTermo);
        const cliente = typeof clienteOuTermo === "object" ? clienteOuTermo : await buscarClienteCompleto(config, clienteOuTermo);
        return {
            id: cliente?.plano_id_erp || "",
            nome: cliente?.plano_nome || cliente?.plano_nome_erp || "",
            nome_erp: cliente?.plano_nome_erp || cliente?.plano_nome || ""
        };
    }

    return {
        ...service,
        nome,
        testarConexao: service.testarConexao,
        buscarCliente,
        buscarClientes,
        buscarClienteCompleto,
        buscarClientePorId: service.buscarClientePorId || buscarClienteCompleto,
        buscarPlano,
        buscarLogin,
        buscarContrato,
        normalizarClientePadrao
    };
}

module.exports = {
    criarProviderPadrao,
    normalizarClientePadrao,
    normalizarListaResposta,
    primeiroValor
};
