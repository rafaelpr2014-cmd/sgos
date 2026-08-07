const express = require("express");

module.exports = (pool, verificarAutenticacao) => {
    const router = express.Router();

    // =========================================================
    // REGISTRAR / ATUALIZAR TOKEN PUSH
    // =========================================================
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
             * PROTEÇÃO IMPORTANTE:
             * Antes de associar o token/dispositivo ao usuário atual,
             * desativa vínculos antigos do MESMO aparelho/token.
             *
             * Isso evita que, após logout e novo login com outro técnico,
             * o mesmo celular continue recebendo push do usuário anterior.
             */
            if(device_id){
                await pool.query(`
                    UPDATE usuarios_push_tokens
                    SET ativo = 0,
                        atualizado_em = NOW()
                    WHERE device_id = ?
                      AND (
                          usuario_id <> ?
                          OR empresa_id <> ?
                          OR token_fcm <> ?
                      )
                `, [device_id, usuarioId, empresaId, token_fcm]);
            }

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


    // =========================================================
    // DESATIVAR TOKEN PUSH NO LOGOUT
    // =========================================================
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

            const condicoes = [
                "usuario_id = ?",
                "empresa_id = ?",
                "ativo = 1"
            ];

            const parametros = [
                usuarioId,
                empresaId
            ];

            if(token_fcm && device_id){
                condicoes.push("(token_fcm = ? OR device_id = ?)");
                parametros.push(token_fcm, device_id);
            }else if(token_fcm){
                condicoes.push("token_fcm = ?");
                parametros.push(token_fcm);
            }else{
                condicoes.push("device_id = ?");
                parametros.push(device_id);
            }

            const [resultado] = await pool.query(`
                UPDATE usuarios_push_tokens
                SET ativo = 0,
                    atualizado_em = NOW()
                WHERE ${condicoes.join("\n                  AND ")}
            `, parametros);

            return res.json({
                ok: true,
                desativados: resultado?.affectedRows || 0
            });

        } catch(err){
            console.error("ERRO /api/push/token/logout:", err);
            return res.status(500).json({ erro: err.message });
        }
    });


    // =========================================================
    // ROTA DE TESTE
    // =========================================================
    // Envia uma notificação para o usuário logado.
    router.post("/teste", verificarAutenticacao, async (req, res) => {
        try {
            const pushService = req.app.get("pushService");

            if(!pushService || typeof pushService.enviarPushNovaOS !== "function"){
                return res.status(503).json({
                    erro: "Serviço de push indisponível"
                });
            }

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
