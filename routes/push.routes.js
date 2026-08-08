const express = require("express");

module.exports = (pool, verificarAutenticacao) => {
    const router = express.Router();

    router.post("/token", verificarAutenticacao, async (req, res) => {
        try {
            const usuarioId = req.usuario.id;
            const empresaId = req.usuario.empresa_id;

            const token_fcm = String(req.body?.token_fcm || "").trim();
            const plataforma = String(req.body?.plataforma || "web").toLowerCase();
            const device_id = req.body?.device_id
                ? String(req.body.device_id).trim()
                : null;

            if(!token_fcm){
                return res.status(400).json({ erro: "token_fcm não informado" });
            }

            const plataformasPermitidas = ["ios", "android", "web"];
            const plataformaFinal = plataformasPermitidas.includes(plataforma)
                ? plataforma
                : "web";

            /*
             * Mantém o comportamento original do cadastro do token.
             * A única limpeza automática aqui é pelo MESMO token, nunca
             * desativando outros tokens do aparelho antes do novo cadastro.
             *
             * Isso evita interromper notificações legítimas após login.
             */
            await pool.query(`
                UPDATE usuarios_push_tokens
                SET ativo = 0,
                    atualizado_em = NOW()
                WHERE token_fcm = ?
                  AND (
                      usuario_id <> ?
                      OR empresa_id <> ?
                  )
            `, [token_fcm, usuarioId, empresaId]);

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
            `, [usuarioId, empresaId, token_fcm, plataformaFinal, device_id]);

            return res.json({
                ok: true,
                plataforma: plataformaFinal,
                token_inicio: token_fcm.substring(0, 25)
            });

        } catch(err){
            console.error("ERRO /api/push/token:", err);
            return res.status(500).json({ erro: err.message });
        }
    });


    // Desativa o vínculo push somente quando o usuário realmente faz logout.
    router.post("/token/logout", verificarAutenticacao, async (req, res) => {
        try {
            const usuarioId = req.usuario.id;
            const empresaId = req.usuario.empresa_id;

            const token_fcm = req.body?.token_fcm
                ? String(req.body.token_fcm).trim()
                : "";

            const device_id = req.body?.device_id
                ? String(req.body.device_id).trim()
                : "";

            if(!token_fcm && !device_id){
                return res.status(400).json({
                    erro: "token_fcm ou device_id deve ser informado"
                });
            }

            let sql = `
                UPDATE usuarios_push_tokens
                SET ativo = 0,
                    atualizado_em = NOW()
                WHERE usuario_id = ?
                  AND empresa_id = ?
                  AND ativo = 1
            `;
            const params = [usuarioId, empresaId];

            if(token_fcm && device_id){
                sql += ` AND (token_fcm = ? OR device_id = ?)`;
                params.push(token_fcm, device_id);
            }else if(token_fcm){
                sql += ` AND token_fcm = ?`;
                params.push(token_fcm);
            }else{
                sql += ` AND device_id = ?`;
                params.push(device_id);
            }

            const [resultado] = await pool.query(sql, params);

            return res.json({
                ok: true,
                desativados: resultado?.affectedRows || 0
            });

        } catch(err){
            console.error("ERRO /api/push/token/logout:", err);
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
                cliente: req.body?.cliente || "Teste SGOS",
                localidade: req.body?.localidade || "",
                tipoServico: req.body?.tipo_servico || ""
            });

            return res.json({ ok:true, resultado });
        } catch(err){
            console.error("ERRO /api/push/teste:", err);
            return res.status(500).json({ erro: err.message });
        }
    });

    return router;
};
