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
    // 📡 CRON - AGENDAMENTOS OS
    // ===============================
    cron.schedule("0 0,12 * * *", async () => {

        console.log("⏰ CRON OS rodando...");

        try {
            const [result] = await pool.query(`
                UPDATE ordens_servico
                SET status = 'aberto'
                WHERE status = 'agendado'
                AND agendamento IS NOT NULL
                AND DATE(agendamento) = CURDATE()
            `);

            console.log(`✅ OS atualizadas: ${result.affectedRows}`);

        } catch (err) {
            console.error("❌ ERRO CRON OS:", err);
        }

    }, {
        timezone: "America/Sao_Paulo"
    });

    // ===============================
    // 📊 SEMANAL (SÁBADO 18H)
    // ===============================
    cron.schedule("0 18 * * 6", async () => {

        console.log("📊 CRON semanal iniciado...");
        await processarEnvio(pool, "semanal");

    }, {
        timezone: "America/Sao_Paulo"
    });

    // ===============================
    // 📊 MENSAL (ÚLTIMO DIA 18H)
    // ===============================
    cron.schedule("0 18 * * *", async () => {

        const hoje = new Date();

        const ultimoDia = new Date(
            hoje.getFullYear(),
            hoje.getMonth() + 1,
            0
        ).getDate();

        if (hoje.getDate() !== ultimoDia) return;

        console.log("📊 CRON mensal iniciado...");
        await processarEnvio(pool, "mensal");

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