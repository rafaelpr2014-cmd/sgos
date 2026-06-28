// D:\sdos\routes\auth.routes.js

module.exports = (db) => {
    const express = require("express");
    const router = express.Router();
    const bcrypt = require("bcryptjs");

    router.post("/login", async (req, res) => {
        try {
            const { usuario, senha } = req.body;

            if (!usuario || !senha) {
                return res.status(400).json({
                    erro: "Usuário e senha são obrigatórios"
                });
            }

            // =====================================
            // IDENTIFICAR EMPRESA PELO SUBDOMÍNIO
            // =====================================

            const host = req.headers.host || "";

            console.log("================================");
            console.log("LOGIN RECEBIDO");
            console.log("HOST:", host);
            console.log("USUARIO:", usuario);

            // Remove porta se existir
            const dominioSemPorta = host.split(":")[0];

            // Extrai subdomínio
            const subdominio = dominioSemPorta.split(".")[0];

            console.log("SUBDOMINIO:", subdominio);

            // =====================================
            // BUSCAR EMPRESA
            // =====================================

            const [empresaRows] = await db.promise().query(
                `
                SELECT id, nome_fantasia, subdominio
                FROM empresa
                WHERE subdominio = ?
                LIMIT 1
                `,
                [subdominio]
            );

            console.log("EMPRESA ENCONTRADA:", empresaRows);

            if (!empresaRows.length) {
                return res.status(401).json({
                    erro: "Empresa não encontrada para este domínio"
                });
            }

            const empresa = empresaRows[0];

            // =====================================
            // BUSCAR USUÁRIO DA EMPRESA
            // =====================================

            const [rows] = await db.promise().query(
                `
                SELECT
                    id,
                    usuario,
                    senha,
                    cargo,
                    ativo,
                    empresa_id
                FROM usuarios
                WHERE usuario = ?
                AND empresa_id = ?
                LIMIT 1
                `,
                [usuario, empresa.id]
            );

            console.log("USUARIO ENCONTRADO:", rows);

            if (!rows.length) {
                return res.status(401).json({
                    erro: "Usuário ou senha incorretos"
                });
            }

            const user = rows[0];

            // =====================================
            // USUÁRIO ATIVO?
            // =====================================

            if (!user.ativo) {
                return res.status(401).json({
                    erro: "Usuário desativado"
                });
            }

            // =====================================
            // VALIDAR SENHA
            // =====================================

            const senhaValida = await bcrypt.compare(
                senha,
                user.senha
            );

            console.log("SENHA VALIDA:", senhaValida);

            if (!senhaValida) {
                return res.status(401).json({
                    erro: "Usuário ou senha incorretos"
                });
            }

            // =====================================
            // LOGIN OK
            // =====================================

            return res.json({
                sucesso: true,
                usuario: {
                    id: user.id,
                    nome: user.usuario,
                    cargo: user.cargo,
                    empresa_id: user.empresa_id,
                    empresa_nome: empresa.nome_fantasia,
                    subdominio: empresa.subdominio
                }
            });

        } catch (err) {
            console.error("ERRO LOGIN:", err);

            return res.status(500).json({
                erro: "Erro interno do servidor"
            });
        }
    });

    return router;
};