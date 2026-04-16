const express = require('express');
const router = express.Router();

const { criarSessao, sessions, qrs } = require('./whatsappService');

// ===============================
// 📲 GERAR QR CODE
// ===============================
router.get('/qr/:empresaId', async (req, res) => {
    const { empresaId } = req.params;

    criarSessao(empresaId);

    // aguarda o QR ser gerado
    setTimeout(() => {

        if (qrs[empresaId]) {
            return res.json({ qr: qrs[empresaId] });
        }

        return res.json({
            erro: 'QR ainda não gerado, clique novamente'
        });

    }, 2000);
});

// ===============================
// 🔍 STATUS WHATSAPP
// ===============================
router.get('/status/:empresaId', (req, res) => {
    const client = sessions[req.params.empresaId];

    if (!client) {
        return res.json({ status: 'desconectado' });
    }

    res.json({
        status: client.info ? 'conectado' : 'aguardando'
    });
});

module.exports = router;

router.get('/teste', async (req, res) => {
    const { enviarMensagem } = require('./whatsappService');

    try {
        await enviarMensagem(
            1, // empresa_id
            '73998069552', // seu número (sem espaços)
            '🚀 Teste do SDOS funcionando!'
        );

        res.json({ sucesso: true });

    } catch (err) {
        res.json({ erro: err.message });
    }
});