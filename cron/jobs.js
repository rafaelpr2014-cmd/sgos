const cron = require("node-cron");
const { gerarRelatorioEmpresa, enviarRelatorio } = require("../services/relatorios.service");

module.exports = (pool) => {

    console.log("🚀 CRON carregado com sucesso!");

    // ===============================
    // 📊 DIÁRIO (TODO DIA 22H)
    // ===============================
    cron.schedule("0 22 * * *", async () => {

        console.log("📊 CRON diário iniciado...");

        await processarEnvio(pool, "diario");

    }, {
        timezone: "America/Sao_Paulo"
    });

    // ===============================
// 🚀 CRON - LANÇAMENTO AUTOMÁTICO OS
// ===============================
cron.schedule("* * * * *", async () => {

    try {

        console.log("⏰ Verificando OS agendadas...");

        const [osList] = await pool.query(`
    SELECT id, empresa_id
    FROM ordens_servico
    WHERE agendamento_envio IS NOT NULL
    AND agendamento_envio <= NOW()
    AND status = 'agendado'
    AND iniciado_em IS NULL
`);

        if (!osList.length) return;

        for (const os of osList) {

            await pool.query(`
    UPDATE ordens_servico
    SET
        status = 'em_andamento',
        iniciado_em = NOW(),
        enviado_por = 0
    WHERE id = ?
    AND empresa_id = ?
    AND status = 'agendado'
`, [os.id, os.empresa_id]);

            console.log(`🚀 OS lançada automaticamente: ${os.id}`);
        }

        const io = require("../server").io;

        if (io) io.emit("os_update");

    } catch (err) {
        console.error("❌ ERRO CRON AGENDAMENTO:", err);
    }

}, {
    timezone: "America/Sao_Paulo"
});

    // ===============================
    // 🔥 FUNÇÃO CENTRAL
    // ===============================
    async function processarEnvio(pool, tipo) {

        try {

            const [empresas] = await pool.query(`
                SELECT * FROM empresa
                WHERE relatorio_envio_tipo = ?
            `, [tipo]);

            console.log(`📦 Empresas encontradas (${tipo}): ${empresas.length}`);

            if (!empresas.length) {
                console.log("⚠️ Nenhuma empresa configurada para envio.");
                return;
            }

            for (const emp of empresas) {

                try {

                    // 🚫 valida email
                    if (!emp.relatorio_email) {
                        console.log(`⚠️ Empresa ${emp.id} sem email configurado`);
                        continue;
                    }

                    console.log(`📨 Enviando relatório empresa ${emp.id} para ${emp.relatorio_email}`);

                    // ✅ AGORA PASSANDO O TIPO CORRETAMENTE
                    const pdf = await gerarRelatorioEmpresa(pool, emp.id, tipo);

                    // 🚫 evita envio se PDF vazio
                    if (!pdf || pdf.length < 100) {
                        throw new Error("PDF vazio ou inválido");
                    }

                    await enviarRelatorio(
                        emp.relatorio_email,
                        pdf,
                        `Relatório ${tipo}`
                    );

                    await pool.query(`
                        INSERT INTO relatorios_envios
                        (empresa_id, cliente_email, tipo, status)
                        VALUES (?, ?, ?, 'ENVIADO')
                    `, [emp.id, emp.relatorio_email, tipo]);

                    console.log(`✅ Enviado com sucesso empresa ${emp.id}`);

                } catch (err) {

                    console.error(`❌ ERRO empresa ${emp.id}:`, err.message);

                    await pool.query(`
                        INSERT INTO relatorios_envios
                        (empresa_id, cliente_email, tipo, status, erro)
                        VALUES (?, ?, ?, 'ERRO', ?)
                    `, [emp.id, emp.relatorio_email, tipo, err.message]);
                }
            }

        } catch (err) {
            console.error("❌ ERRO GERAL CRON:", err);
        }
    }
};