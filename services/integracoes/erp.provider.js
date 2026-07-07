const { criarProviderPadrao } = require("./interface");

function carregar(nome){
    try{
        return criarProviderPadrao(nome, require(`./${nome}`));
    }catch(errNovo){
        try{
            return criarProviderPadrao(nome, require(`./${nome}.service`));
        }catch(errAntigo){
            throw errNovo;
        }
    }
}

const providers = {
    mikweb: carregar("mikweb"),
    sgp: carregar("sgp"),
    ixc: carregar("ixc"),
    hubsoft: carregar("hubsoft")
};

function normalizarTipoERP(tipo){
    return String(tipo || "mikweb").trim().toLowerCase();
}

function getProvider(tipo){
    const chave = normalizarTipoERP(tipo);
    const provider = providers[chave];
    if(!provider){
        const err = new Error(`ERP não suportado: ${tipo}`);
        err.status = 400;
        throw err;
    }
    return provider;
}

module.exports = providers;
module.exports.getProvider = getProvider;
module.exports.normalizarTipoERP = normalizarTipoERP;
