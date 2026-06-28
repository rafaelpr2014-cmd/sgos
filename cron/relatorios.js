module.exports = (pool, verificarAutenticacao) => {

    // 📥 envio manual
    router.post("/enviar-manual", verificarAutenticacao, async (req, res) => {

        try {

            const { email, empresa_id } = req.body;

            const { gerarRelatorioEmpresa, enviarRelatorio } =
                require("../services/relatorios.service");

            const pdf = await gerarRelatorioEmpresa(pool, empresa_id);

            await enviarRelatorio(email, pdf, "Relatório Manual SGOS");

            await pool.query(`
                INSERT INTO relatorios_envios
                (empresa_id, cliente_email, tipo, status)
                VALUES (?, ?, 'manual', 'ENVIADO')
            `, [empresa_id, email]);

            return res.json({ ok: true, message: "Relatório enviado com sucesso" });

        } catch (err) {

            console.error(err);

            return res.status(500).json({ erro: err.message });
        }
    });

    return router;
};