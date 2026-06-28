const express = require("express");

module.exports = (pool, verificarAutenticacao) => {
    const router = express.Router();

    router.post("/token", verificarAutenticacao, async (req, res) => {
        try {
            const usuarioId = req.usuario.id;
            const empresaId = req.usuario.empresa_id;
            const { token_fcm, plataforma = "android", device_id = null } = req.body;

            if(!token_fcm){
                return res.status(400).json({ erro: "token_fcm não informado" });
            }

            await pool.query(`
                INSERT INTO usuarios_push_tokens
                    (usuario_id, empresa_id, token_fcm, plataforma, device_id, ativo, atualizado_em)
                VALUES (?, ?, ?, ?, ?, 1, NOW())
                ON DUPLICATE KEY UPDATE
                    usuario_id = VALUES(usuario_id),
                    empresa_id = VALUES(empresa_id),
                    plataforma = VALUES(plataforma),
                    device_id = VALUES(device_id),
                    ativo = 1,
                    atualizado_em = NOW()
            `, [usuarioId, empresaId, token_fcm, plataforma, device_id]);

            return res.json({ ok:true });
        } catch(err){
            console.error("ERRO /api/push/token:", err);
            return res.status(500).json({ erro: err.message });
        }
    });

    // Rota de teste: envia uma notificação para o usuário logado.
    router.post("/teste", verificarAutenticacao, async (req, res) => {
        try {
            const pushService = req.app.get("pushService");
            const osId = req.body?.os_id || "teste";

            const resultado = await pushService.enviarPushNovaOS({
                usuarioId: req.usuario.id,
                empresaId: req.usuario.empresa_id,
                osId,
                cliente: req.body?.cliente || "Teste SGOS"
            });

            return res.json({ ok:true, resultado });
        } catch(err){
            console.error("ERRO /api/push/teste:", err);
            return res.status(500).json({ erro: err.message });
        }
    });

    return router;
};
