const cron = require("node-cron");
const { gerarRelatorioEmpresa, enviarRelatorio, dataBR } = require("../services/relatorios.service");
const { enviarMidia } = require("../services/whatsappService");

function parsePeriodicidades(valor) {
    if (!valor) return [];
    if (Array.isArray(valor)) return valor;
    try {
        const parsed = JSON.parse(valor);
        if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return String(valor).split(",").map(v => v.trim()).filter(Boolean);
}

function horarioAgora() {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date());
}

function diaSemanaAgora() {
    const texto = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date());
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[texto];
}

function diaMesAgora() {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", day: "2-digit" }).format(new Date()));
}

function metodoInclui(metodo, canal) {
    metodo = String(metodo || "").toLowerCase();
    return metodo === "ambos" || metodo === canal || (canal === "whatsapp" && metodo.includes("whats"));
}

function destinos(emp) {
    const emails = [];
    const telefones = [];
    if (Number(emp.relatorio_usar_email_cadastrado) === 1 && emp.email) emails.push(emp.email);
    if (emp.relatorio_email) emails.push(emp.relatorio_email);
    if (Number(emp.relatorio_usar_telefone_cadastrado) === 1 && emp.telefone) telefones.push(emp.telefone);
    if (emp.relatorio_telefone) telefones.push(emp.relatorio_telefone);
    return { emails: [...new Set(emails)], telefones: [...new Set(telefones)] };
}

async function jaEnviado(pool, empresaId, tipo, inicio, fim) {
    const [rows] = await pool.query(`
        SELECT id FROM relatorios_envios
        WHERE empresa_id = ? AND tipo = ? AND periodo_inicio = ? AND periodo_fim = ? AND status = 'ENVIADO'
        LIMIT 1
    `, [empresaId, tipo, inicio, fim]);
    return rows.length > 0;
}

async function registrar(pool, dados) {
    await pool.query(`
        INSERT INTO relatorios_envios
        (empresa_id, tipo, periodo_inicio, periodo_fim, cliente_email, cliente_telefone, canal, nome_arquivo, status, erro, enviado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [dados.empresaId, dados.tipo, dados.inicio, dados.fim, dados.email || null, dados.telefone || null, dados.canal, dados.nomeArquivo, dados.status, dados.erro || null]);
}

async function processarTipo(pool, emp, tipo) {
    const rel = await gerarRelatorioEmpresa(pool, emp.id, tipo);
    if (await jaEnviado(pool, emp.id, tipo, rel.inicio, rel.fim)) return;

    const { emails, telefones } = destinos(emp);
    const assunto = `${tipo === "diario" ? "Relatório Diário" : tipo === "semanal" ? "Relatório Semanal" : "Relatório Mensal"} - ${rel.empresa.nome_provedor || rel.empresa.nome_fantasia || rel.empresa.nome_completo || "SGOS"}`;
    let sucessos = 0;

    if (metodoInclui(emp.relatorio_envio_tipo, "email")) {
        for (const email of emails) {
            try {
                await enviarRelatorio(email, rel.buffer, assunto, rel.filename);
                await registrar(pool, { empresaId: emp.id, tipo, inicio: rel.inicio, fim: rel.fim, email, canal: "email", nomeArquivo: rel.filename, status: "ENVIADO" });
                sucessos++;
            } catch (err) {
                await registrar(pool, { empresaId: emp.id, tipo, inicio: rel.inicio, fim: rel.fim, email, canal: "email", nomeArquivo: rel.filename, status: "ERRO", erro: err.message });
            }
        }
    }

    if (metodoInclui(emp.relatorio_envio_tipo, "whatsapp")) {
        for (const telefone of telefones) {
            try {
                await enviarMidia(emp.id, telefone, rel.buffer, rel.filename, `${assunto}\nPeríodo: ${dataBR(rel.inicio)} a ${dataBR(rel.fim)}`);
                await registrar(pool, { empresaId: emp.id, tipo, inicio: rel.inicio, fim: rel.fim, telefone, canal: "whatsapp", nomeArquivo: rel.filename, status: "ENVIADO" });
                sucessos++;
            } catch (err) {
                await registrar(pool, { empresaId: emp.id, tipo, inicio: rel.inicio, fim: rel.fim, telefone, canal: "whatsapp", nomeArquivo: rel.filename, status: "ERRO", erro: err.message });
            }
        }
    }

    if (!sucessos) console.warn(`⚠️ Empresa ${emp.id}: nenhum relatório enviado (${tipo}).`);
}

module.exports = pool => {
    console.log("🚀 Agendador SGOS carregado.");

    cron.schedule("* * * * *", async () => {
        try {
            const agora = horarioAgora();
            const [empresas] = await pool.query(`
                SELECT * FROM empresa
                WHERE relatorio_ativo = 1
                  AND ativo = 1
                  AND DATE_FORMAT(COALESCE(relatorio_horario, '08:00:00'), '%H:%i') = ?
            `, [agora]);

            for (const emp of empresas) {
                const periodicidades = parsePeriodicidades(emp.relatorio_periodicidades);
                if (periodicidades.includes("diario")) await processarTipo(pool, emp, "diario");
                if (periodicidades.includes("semanal") && Number(emp.relatorio_dia_semana) === diaSemanaAgora()) await processarTipo(pool, emp, "semanal");
                if (periodicidades.includes("mensal") && Number(emp.relatorio_dia_mes) === diaMesAgora()) await processarTipo(pool, emp, "mensal");
            }
        } catch (err) {
            console.error("❌ Erro no agendador de relatórios:", err);
        }
    }, { timezone: "America/Sao_Paulo" });

    // Mantém o lançamento automático de OS que já existia.
    cron.schedule("* * * * *", async () => {
        try {
            const [lista] = await pool.query(`
                SELECT id, empresa_id FROM ordens_servico
                WHERE agendamento_envio IS NOT NULL
                  AND agendamento_envio <= NOW()
                  AND status = 'agendado'
                  AND iniciado_em IS NULL
            `);
            for (const os of lista) {
                await pool.query(`
                    UPDATE ordens_servico
                    SET status='em_andamento', iniciado_em=NOW(), enviado_por=0
                    WHERE id=? AND empresa_id=? AND status='agendado'
                `, [os.id, os.empresa_id]);
            }
        } catch (err) {
            console.error("❌ Erro no cron de OS agendadas:", err);
        }
    }, { timezone: "America/Sao_Paulo" });
};
