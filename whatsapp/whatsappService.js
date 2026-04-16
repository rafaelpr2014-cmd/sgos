const { Client, LocalAuth } = require('whatsapp-web.js');

const sessions = {};
const qrs = {};

// ===============================
// 🚀 CRIAR SESSÃO
// ===============================
function criarSessao(empresaId) {
    if (sessions[empresaId]) return sessions[empresaId];

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: empresaId }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log(`📲 QR gerado para empresa ${empresaId}`);
        qrs[empresaId] = qr;
    });

    client.on('ready', () => {
        console.log(`✅ WhatsApp conectado: Empresa ${empresaId}`);
    });

    client.on('disconnected', () => {
        console.log(`❌ WhatsApp desconectado: Empresa ${empresaId}`);
        delete sessions[empresaId];
        delete qrs[empresaId];
    });

    client.initialize();

    sessions[empresaId] = client;

    return client;
}

// ===============================
// 📲 OBTER CLIENTE (SESSION EXISTENTE OU CRIAR)
// ===============================
function getCliente(empresaId) {
    if (sessions[empresaId]) return sessions[empresaId];
    return criarSessao(empresaId);
}

// ===============================
// 📞 FORMATAR TELEFONE
// ===============================
function formatarNumero(numero) {
    if (!numero) return null;

    numero = numero.toString().replace(/\D/g, '');

    // remove 0 inicial
    if (numero.startsWith('0')) {
        numero = numero.substring(1);
    }

    // adiciona 55 se não tiver
    if (!numero.startsWith('55')) {
        numero = '55' + numero;
    }

    return numero;
}

// ===============================
// 📲 ENVIAR MENSAGEM
// ===============================
async function enviarMensagem(empresaId, telefone, mensagem) {
    const client = getCliente(empresaId);

    if (!client) {
        console.log('⚠️ WhatsApp não conectado');
        return;
    }

    try {
        const numeroFormatado = formatarNumero(telefone);

        const numberId = await client.getNumberId(numeroFormatado);

        if (!numberId) {
            console.log('❌ Número inválido:', numeroFormatado);
            return;
        }

        await client.sendMessage(numberId._serialized, mensagem);

        console.log('✅ Mensagem enviada:', numeroFormatado);

    } catch (err) {
        console.log('❌ Erro WhatsApp:', err);
    }
}

module.exports = {
    criarSessao,
    getCliente,       // <<=== agora existe
    enviarMensagem,
    sessions,
    qrs
};