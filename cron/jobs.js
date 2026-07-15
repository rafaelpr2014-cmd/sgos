const cron = require("node-cron");
const { gerarRelatorioEmpresa, enviarRelatorio, dataBR } = require("../services/relatorios.service");
const { enviarMidiaCentral } = require("../services/whatsappService");

const FUSO = "America/Sao_Paulo";

function parsePeriodicidades(valor) {
    if (!valor) return [];
    if (Array.isArray(valor)) return valor.map(v => String(v).trim().toLowerCase()).filter(Boolean);
    try {
        const parsed = JSON.parse(valor);
        if (Array.isArray(parsed)) return parsed.map(v => String(v).trim().toLowerCase()).filter(Boolean);
    } catch (_) {}
    return String(valor).split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
}

function normalizarHorario(valor) {
    if (valor === null || valor === undefined) return "";
    const texto = String(valor).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
    const match = texto.match(/(\d{1,2}):(\d{2})/);
    if (!match) return "";
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function horarioAgora() {
    return normalizarHorario(new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(new Date()));
}

function dataHoraAgora() {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        dateStyle: "short",
        timeStyle: "medium"
    }).format(new Date());
}

function diaSemanaAgora() {
    const texto = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" }).format(new Date());
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[texto];
}

function diaMesAgora() {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: FUSO, day: "2-digit" }).format(new Date()));
}

function metodoInclui(metodo, canal) {
    const valor = String(metodo || "").trim().toLowerCase();
    return valor === "ambos" || valor === canal || (canal === "whatsapp" && valor.includes("whats"));
}

function destinos(emp) {
    const emails = [];
    const telefones = [];
    if (Number(emp.relatorio_usar_email_cadastrado) === 1 && emp.email) emails.push(String(emp.email).trim());
    if (emp.relatorio_email) emails.push(String(emp.relatorio_email).trim());
    if (Number(emp.relatorio_usar_telefone_cadastrado) === 1 && emp.telefone) telefones.push(String(emp.telefone).trim());
    if (emp.relatorio_telefone) telefones.push(String(emp.relatorio_telefone).trim());
    return { emails: [...new Set(emails.filter(Boolean))], telefones: [...new Set(telefones.filter(Boolean))] };
}

async function jaEnviado(pool, empresaId, tipo, inicio, fim, canal, destino) {
    const coluna = canal === "email" ? "cliente_email" : "cliente_telefone";
    const [rows] = await pool.query(`
        SELECT id FROM relatorios_envios
        WHERE empresa_id = ?
          AND tipo = ?
          AND periodo_inicio = ?
          AND periodo_fim = ?
          AND canal = ?
          AND ${coluna} = ?
          AND status = 'ENVIADO'
        LIMIT 1
    `, [empresaId, tipo, inicio, fim, canal, destino]);
    return rows.length > 0;
}

async function registrar(pool, dados) {
    await pool.query(`
        INSERT INTO relatorios_envios
        (empresa_id, cliente_email, cliente_telefone, tipo, periodo_inicio, periodo_fim, canal, nome_arquivo, status, erro, enviado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
        dados.empresaId,
        dados.email || null,
        dados.telefone || null,
        dados.tipo,
        dados.inicio,
        dados.fim,
        dados.canal,
        dados.nomeArquivo || null,
        dados.status,
        dados.erro || null
    ]);
}

function tituloTipo(tipo) {
    if (tipo === "diario") return "Relatório Diário";
    if (tipo === "semanal") return "Relatório Semanal";
    if (tipo === "mensal") return "Relatório Mensal";
    return "Relatório SGOS";
}

async function processarTipo(pool, emp, tipo) {
    console.log(`📄 Empresa ${emp.id}: gerando relatório ${tipo}...`);
    const rel = await gerarRelatorioEmpresa(pool, emp.id, tipo);

    if (!rel || !Buffer.isBuffer(rel.buffer) || rel.buffer.length < 100) {
        throw new Error("PDF vazio ou inválido");
    }

    console.log(`✅ Empresa ${emp.id}: PDF gerado (${rel.buffer.length} bytes) - ${rel.filename}`);

    const { emails, telefones } = destinos(emp);
    const nomeEmpresa = rel.empresa?.nome_provedor || rel.empresa?.nome_fantasia || rel.empresa?.nome_completo || "SGOS";
    const assunto = `${tituloTipo(tipo)} - ${nomeEmpresa}`;
    let enviados = 0;

    console.log(`🎯 Empresa ${emp.id}: método ${emp.relatorio_envio_tipo}`, { emails, telefones });

    if (metodoInclui(emp.relatorio_envio_tipo, "email")) {
        for (const email of emails) {
            if (await jaEnviado(pool, emp.id, tipo, rel.inicio, rel.fim, "email", email)) {
                console.log(`⏭️ Empresa ${emp.id}: ${email} já recebeu ${tipo} neste período.`);
                continue;
            }

            try {
                console.log(`📧 Empresa ${emp.id}: enviando para ${email}...`);
                await enviarRelatorio(email, rel.buffer, assunto, rel.filename);
                await registrar(pool, {
                    empresaId: emp.id, email, tipo,
                    inicio: rel.inicio, fim: rel.fim,
                    canal: "email", nomeArquivo: rel.filename,
                    status: "ENVIADO"
                });
                enviados++;
                console.log(`✅ Empresa ${emp.id}: e-mail enviado para ${email}.`);
            } catch (erro) {
                await registrar(pool, {
                    empresaId: emp.id, email, tipo,
                    inicio: rel.inicio, fim: rel.fim,
                    canal: "email", nomeArquivo: rel.filename,
                    status: "ERRO", erro: erro.message
                });
                console.error(`❌ Empresa ${emp.id}: erro no e-mail ${email}:`, erro.message);
            }
        }
    }

    if (metodoInclui(emp.relatorio_envio_tipo, "whatsapp")) {
        for (const telefone of telefones) {
            if (await jaEnviado(pool, emp.id, tipo, rel.inicio, rel.fim, "whatsapp", telefone)) {
                console.log(`⏭️ Empresa ${emp.id}: ${telefone} já recebeu ${tipo} neste período.`);
                continue;
            }

            try {
                if (typeof enviarMidiaCentral !== "function") throw new Error("enviarMidiaCentral não foi exportada pelo whatsappService");
                console.log(`📲 Empresa ${emp.id}: enviando para WhatsApp ${telefone}...`);
                const resultado = await enviarMidiaCentral(
                    emp.id,
                    telefone,
                    rel.buffer,
                    rel.filename,
                    `${assunto}\nPeríodo: ${dataBR(rel.inicio)} a ${dataBR(rel.fim)}`
                );
                if (resultado && resultado.ok === false) throw new Error(resultado.error || resultado.erro || "Falha no WhatsApp");
                await registrar(pool, {
                    empresaId: emp.id, telefone, tipo,
                    inicio: rel.inicio, fim: rel.fim,
                    canal: "whatsapp", nomeArquivo: rel.filename,
                    status: "ENVIADO"
                });
                enviados++;
                console.log(`✅ Empresa ${emp.id}: WhatsApp enviado para ${telefone}.`);
            } catch (erro) {
                await registrar(pool, {
                    empresaId: emp.id, telefone, tipo,
                    inicio: rel.inicio, fim: rel.fim,
                    canal: "whatsapp", nomeArquivo: rel.filename,
                    status: "ERRO", erro: erro.message
                });
                console.error(`❌ Empresa ${emp.id}: erro no WhatsApp ${telefone}:`, erro.message);
            }
        }
    }

    console.log(`🏁 Empresa ${emp.id}: ${tipo} finalizado com ${enviados} novo(s) envio(s).`);
}

module.exports = pool => {
    console.log("🚀 Agendador SGOS carregado.");

    cron.schedule("* * * * *", async () => {
        const agora = horarioAgora();
        console.log(`\n🕐 [${dataHoraAgora()}] Verificando relatórios automáticos para ${agora}...`);

        try {
            const [empresasAtivas] = await pool.query(`
                SELECT * FROM empresa
                WHERE relatorio_ativo = 1
                  AND ativo = 1
            `);

            const empresas = empresasAtivas.filter(emp =>
                normalizarHorario(emp.relatorio_horario || "08:00:00") === agora
            );

            console.log("🧪 Empresas ativas e horários:", empresasAtivas.map(emp => ({
                id: emp.id,
                horarioBanco: emp.relatorio_horario,
                horarioNormalizado: normalizarHorario(emp.relatorio_horario || "08:00:00")
            })));
            console.log(`🏢 Empresas encontradas no horário ${agora}: ${empresas.length}`, empresas.map(emp => emp.id));

            for (const emp of empresas) {
                try {
                    const periodicidades = parsePeriodicidades(emp.relatorio_periodicidades);
                    console.log(`🔎 Empresa ${emp.id}: periodicidades`, periodicidades);

                    if (periodicidades.includes("diario")) {
                        console.log(`➡️ Empresa ${emp.id}: envio diário confirmado.`);
                        await processarTipo(pool, emp, "diario");
                    }

                    if (periodicidades.includes("semanal") && Number(emp.relatorio_dia_semana) === diaSemanaAgora()) {
                        console.log(`➡️ Empresa ${emp.id}: envio semanal confirmado.`);
                        await processarTipo(pool, emp, "semanal");
                    }

                    if (periodicidades.includes("mensal") && Number(emp.relatorio_dia_mes) === diaMesAgora()) {
                        console.log(`➡️ Empresa ${emp.id}: envio mensal confirmado.`);
                        await processarTipo(pool, emp, "mensal");
                    }
                } catch (erro) {
                    console.error(`❌ Empresa ${emp.id}: erro no processamento automático:`, erro);
                }
            }
        } catch (erro) {
            console.error("❌ Erro no agendador de relatórios:", erro);
        }
    }, { timezone: FUSO });

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
                    SET status = 'em_andamento', iniciado_em = NOW(), enviado_por = 0
                    WHERE id = ? AND empresa_id = ? AND status = 'agendado'
                `, [os.id, os.empresa_id]);
            }
        } catch (erro) {
            console.error("❌ Erro no cron de OS agendadas:", erro);
        }
    }, { timezone: FUSO });
};
