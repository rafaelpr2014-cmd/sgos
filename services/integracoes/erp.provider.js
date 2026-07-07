const { criarProviderPadrao } = require("./interface");

const providers = {
    mikweb: criarProviderPadrao("mikweb", require("./mikweb")),
    sgp: criarProviderPadrao("sgp", require("./sgp")),
    ixc: criarProviderPadrao("ixc", require("./ixc")),
    hubsoft: criarProviderPadrao("hubsoft", require("./hubsoft"))
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
