const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const { gerarRelatorioEmpresa, enviarRelatorio, dataBR } = require("../services/relatorios.service");
const { enviarMidiaCentral } = require("../services/whatsappService");

const FUSO = "America/Sao_Paulo";
const MAX_TENTATIVAS = 3;
const INTERVALO_TENTATIVA_MINUTOS = 5;
const RETENCAO_DIAS = 7;
const PASTA_MONITOR = path.join(__dirname, "..", "uploads", "relatorios-monitor");

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

function tituloTipo(tipo) {
    if (tipo === "diario") return "Relatório Diário";
    if (tipo === "semanal") return "Relatório Semanal";
    if (tipo === "mensal") return "Relatório Mensal";
    return "Relatório SGOS";
}

function erroDetalhado(erro) {
    if (!erro) return "Erro desconhecido";
    const partes = [erro.message, erro.code, erro?.response?.data?.message, erro?.response?.data?.error]
        .filter(Boolean)
        .map(String);
    return [...new Set(partes)].join(" | ").slice(0, 2000) || "Erro desconhecido";
}

function salvarPdfMonitor(buffer, nomeOriginal, empresaId) {
    if (!buffer?.length) return null;
    fs.mkdirSync(PASTA_MONITOR, { recursive: true });
    const baseSeguro = path.basename(String(nomeOriginal || "relatorio.pdf"))
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const nome = `${Date.now()}-${empresaId}-${Math.random().toString(36).slice(2, 8)}-${baseSeguro}`;
    const absoluto = path.join(PASTA_MONITOR, nome);
    fs.writeFileSync(absoluto, buffer);
    return path.relative(path.join(__dirname, ".."), absoluto).replace(/\\/g, "/");
}

function caminhoAbsolutoSeguro(caminhoRelativo) {
    if (!caminhoRelativo) return null;
    const raiz = path.resolve(path.join(__dirname, ".."));
    const absoluto = path.resolve(raiz, caminhoRelativo);
    if (!absoluto.startsWith(path.resolve(PASTA_MONITOR) + path.sep)) return null;
    return absoluto;
}

async function prepararEstruturaRelatorios(pool) {
    const alteracoes = [
        "ALTER TABLE relatorios_envios ADD COLUMN IF NOT EXISTS caminho_arquivo VARCHAR(500) NULL",
        "ALTER TABLE relatorios_envios ADD COLUMN IF NOT EXISTS tentativas INT NOT NULL DEFAULT 1",
        "ALTER TABLE relatorios_envios ADD COLUMN IF NOT EXISTS proxima_tentativa DATETIME NULL",
        "ALTER TABLE relatorios_envios ADD COLUMN IF NOT EXISTS atualizado_em DATETIME NULL"
    ];
    for (const sql of alteracoes) {
        try { await pool.query(sql); } catch (e) { console.error("⚠️ Estrutura relatorios_envios:", e.message); }
    }
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
    const [resultado] = await pool.query(`
        INSERT INTO relatorios_envios
        (empresa_id, cliente_email, cliente_telefone, tipo, periodo_inicio, periodo_fim, canal,
         nome_arquivo, caminho_arquivo, status, erro, tentativas, proxima_tentativa, enviado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
        dados.empresaId,
        dados.email || null,
        dados.telefone || null,
        dados.tipo,
        dados.inicio,
        dados.fim,
        dados.canal,
        dados.nomeArquivo || null,
        dados.caminhoArquivo || null,
        dados.status,
        dados.erro || null,
        Number(dados.tentativas || 1),
        dados.proximaTentativa || null
    ]);
    return resultado.insertId;
}

async function marcarSucesso(pool, id) {
    await pool.query(`
        UPDATE relatorios_envios
        SET status='ENVIADO', erro=NULL, proxima_tentativa=NULL, enviado_em=NOW(), atualizado_em=NOW()
        WHERE id=?
    `, [id]);
}

async function marcarFalha(pool, id, tentativaAtual, erro) {
    const tentarNovamente = tentativaAtual < MAX_TENTATIVAS;
    await pool.query(`
        UPDATE relatorios_envios
        SET status='ERRO', erro=?, tentativas=?,
            proxima_tentativa=${tentarNovamente ? `DATE_ADD(NOW(), INTERVAL ${INTERVALO_TENTATIVA_MINUTOS} MINUTE)` : "NULL"},
            atualizado_em=NOW()
        WHERE id=?
    `, [erro, tentativaAtual, id]);
}

async function enviarCanal({ pool, registroId, empresaId, canal, destino, buffer, nomeArquivo, assunto, inicio, fim, tentativa }) {
    try {
        if (canal === "email") {
            console.log(`📧 Empresa ${empresaId}: tentativa ${tentativa}/${MAX_TENTATIVAS} para ${destino}...`);
            await enviarRelatorio(destino, buffer, assunto, nomeArquivo);
        } else {
            if (typeof enviarMidiaCentral !== "function") throw new Error("enviarMidiaCentral não foi exportada pelo whatsappService");
            console.log(`📲 Empresa ${empresaId}: tentativa ${tentativa}/${MAX_TENTATIVAS} WhatsApp ${destino}...`);
            const resultado = await enviarMidiaCentral(
                empresaId,
                destino,
                buffer,
                nomeArquivo,
                `${assunto}\nPeríodo: ${dataBR(inicio)} a ${dataBR(fim)}`
            );
            if (resultado && resultado.ok === false) {
                throw Object.assign(new Error(resultado.detail || resultado.error || resultado.erro || "Falha no WhatsApp"), { code: resultado.code });
            }
        }
        await marcarSucesso(pool, registroId);
        console.log(`✅ Empresa ${empresaId}: ${canal} enviado para ${destino} na tentativa ${tentativa}/${MAX_TENTATIVAS}.`);
        return true;
    } catch (erro) {
        const detalhe = erroDetalhado(erro);
        await marcarFalha(pool, registroId, tentativa, detalhe);
        console.error(`❌ Empresa ${empresaId}: ${canal} falhou para ${destino} na tentativa ${tentativa}/${MAX_TENTATIVAS}:`, detalhe);
        if (erro?.stack) console.error(erro.stack);
        if (tentativa < MAX_TENTATIVAS) {
            console.log(`⏳ Nova tentativa em ${INTERVALO_TENTATIVA_MINUTOS} minutos.`);
        } else {
            console.log(`🛑 Limite de ${MAX_TENTATIVAS} tentativas atingido para ${canal} ${destino}.`);
        }
        return false;
    }
}

async function processarTipo(pool, emp, tipo) {
    console.log(`📄 Empresa ${emp.id}: gerando relatório ${tipo}...`);
    const rel = await gerarRelatorioEmpresa(pool, emp.id, tipo);
    if (!rel || !Buffer.isBuffer(rel.buffer) || rel.buffer.length < 100) throw new Error("PDF vazio ou inválido");

    const caminhoArquivo = salvarPdfMonitor(rel.buffer, rel.filename, emp.id);
    console.log(`✅ Empresa ${emp.id}: PDF gerado (${rel.buffer.length} bytes) - ${rel.filename}`);

    const { emails, telefones } = destinos(emp);
    const nomeEmpresa = rel.empresa?.nome_provedor || rel.empresa?.nome_fantasia || rel.empresa?.nome_completo || "SGOS";
    const assunto = `${tituloTipo(tipo)} - ${nomeEmpresa}`;
    let enviados = 0;

    console.log(`🎯 Empresa ${emp.id}: método ${emp.relatorio_envio_tipo}`, { emails, telefones });

    const alvos = [];
    if (metodoInclui(emp.relatorio_envio_tipo, "email")) emails.forEach(destino => alvos.push({ canal: "email", destino }));
    if (metodoInclui(emp.relatorio_envio_tipo, "whatsapp")) telefones.forEach(destino => alvos.push({ canal: "whatsapp", destino }));

    for (const alvo of alvos) {
        if (await jaEnviado(pool, emp.id, tipo, rel.inicio, rel.fim, alvo.canal, alvo.destino)) {
            console.log(`⏭️ Empresa ${emp.id}: ${alvo.destino} já recebeu ${tipo} por ${alvo.canal} neste período.`);
            continue;
        }

        const registroId = await registrar(pool, {
            empresaId: emp.id,
            email: alvo.canal === "email" ? alvo.destino : null,
            telefone: alvo.canal === "whatsapp" ? alvo.destino : null,
            tipo,
            inicio: rel.inicio,
            fim: rel.fim,
            canal: alvo.canal,
            nomeArquivo: rel.filename,
            caminhoArquivo,
            status: "PENDENTE",
            tentativas: 1
        });

        const ok = await enviarCanal({
            pool,
            registroId,
            empresaId: emp.id,
            canal: alvo.canal,
            destino: alvo.destino,
            buffer: rel.buffer,
            nomeArquivo: rel.filename,
            assunto,
            inicio: rel.inicio,
            fim: rel.fim,
            tentativa: 1
        });
        if (ok) enviados++;
    }

    console.log(`🏁 Empresa ${emp.id}: ${tipo} finalizado com ${enviados} novo(s) envio(s) confirmado(s).`);
}

async function processarRetentativas(pool) {
    const [pendentes] = await pool.query(`
        SELECT * FROM relatorios_envios
        WHERE status='ERRO'
          AND tentativas < ?
          AND proxima_tentativa IS NOT NULL
          AND proxima_tentativa <= NOW()
        ORDER BY proxima_tentativa ASC
        LIMIT 50
    `, [MAX_TENTATIVAS]);

    for (const item of pendentes) {
        const proximaTentativa = Number(item.tentativas || 1) + 1;
        const destino = item.canal === "email" ? item.cliente_email : item.cliente_telefone;
        const absoluto = caminhoAbsolutoSeguro(item.caminho_arquivo);

        if (!destino) {
            await marcarFalha(pool, item.id, MAX_TENTATIVAS, "Destinatário ausente para retentativa");
            continue;
        }
        if (!absoluto || !fs.existsSync(absoluto)) {
            await marcarFalha(pool, item.id, MAX_TENTATIVAS, "PDF não encontrado para retentativa");
            console.error(`❌ Retentativa ${item.id}: PDF indisponível (${item.caminho_arquivo || "sem caminho"}).`);
            continue;
        }

        let buffer;
        try { buffer = fs.readFileSync(absoluto); }
        catch (erro) {
            await marcarFalha(pool, item.id, MAX_TENTATIVAS, `Falha ao ler PDF: ${erro.message}`);
            continue;
        }

        const [empRows] = await pool.query("SELECT * FROM empresa WHERE id=? LIMIT 1", [item.empresa_id]);
        const emp = empRows[0] || {};
        const nomeEmpresa = emp.nome_provedor || emp.nome_fantasia || emp.nome_completo || "SGOS";
        const assunto = `${tituloTipo(item.tipo)} - ${nomeEmpresa}`;

        await enviarCanal({
            pool,
            registroId: item.id,
            empresaId: item.empresa_id,
            canal: item.canal,
            destino,
            buffer,
            nomeArquivo: item.nome_arquivo || "relatorio.pdf",
            assunto,
            inicio: item.periodo_inicio,
            fim: item.periodo_fim,
            tentativa: proximaTentativa
        });
    }
}

async function limparRelatoriosAntigos(pool) {
    try {
        fs.mkdirSync(PASTA_MONITOR, { recursive: true });
        const limiteMs = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;

        for (const nome of fs.readdirSync(PASTA_MONITOR)) {
            const absoluto = path.join(PASTA_MONITOR, nome);
            try {
                const st = fs.statSync(absoluto);
                if (st.isFile() && st.mtimeMs < limiteMs) fs.unlinkSync(absoluto);
            } catch (_) {}
        }

        const [resultado] = await pool.query(`
            DELETE FROM relatorios_envios
            WHERE COALESCE(atualizado_em, enviado_em) < DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        if (resultado.affectedRows) console.log(`🧹 Monitor: ${resultado.affectedRows} registro(s) com mais de ${RETENCAO_DIAS} dias removido(s).`);
    } catch (erro) {
        console.error("❌ Erro ao limpar relatórios antigos:", erro.message);
    }
}

module.exports = pool => {
    console.log("🚀 Agendador SGOS carregado.");

    prepararEstruturaRelatorios(pool)
        .then(() => limparRelatoriosAntigos(pool))
        .catch(erro => console.error("❌ Preparação dos relatórios:", erro.message));

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

            await processarRetentativas(pool);
        } catch (erro) {
            console.error("❌ Erro no agendador de relatórios:", erro);
        }
    }, { timezone: FUSO });

    // Limpeza diária dos PDFs e registros do monitor com mais de 7 dias.
    cron.schedule("20 3 * * *", () => limparRelatoriosAntigos(pool), { timezone: FUSO });

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
