const cron = require("node-cron");

const {
    gerarRelatorioEmpresa,
    enviarRelatorio,
    dataBR
} = require("../services/relatorios.service");

// Caminho real do módulo de WhatsApp no SGOS.
const {
    enviarMidia
} = require("../whatsapp/whatsappService");

const FUSO = "America/Sao_Paulo";

function parsePeriodicidades(valor) {
    if (!valor) return [];

    if (Array.isArray(valor)) {
        return valor.map(v => String(v).trim().toLowerCase()).filter(Boolean);
    }

    try {
        const parsed = JSON.parse(valor);

        if (Array.isArray(parsed)) {
            return parsed
                .map(v => String(v).trim().toLowerCase())
                .filter(Boolean);
        }
    } catch (_) {
        // Tenta interpretar como texto separado por vírgulas.
    }

    return String(valor)
        .split(",")
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

function horarioAgora() {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(new Date());
}

function dataHoraAgora() {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        dateStyle: "short",
        timeStyle: "medium"
    }).format(new Date());
}

function diaSemanaAgora() {
    const texto = new Intl.DateTimeFormat("en-US", {
        timeZone: FUSO,
        weekday: "short"
    }).format(new Date());

    return {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6
    }[texto];
}

function diaMesAgora() {
    return Number(
        new Intl.DateTimeFormat("en-US", {
            timeZone: FUSO,
            day: "2-digit"
        }).format(new Date())
    );
}

function metodoInclui(metodo, canal) {
    const valor = String(metodo || "").trim().toLowerCase();

    if (valor === "ambos") return true;
    if (valor === canal) return true;

    return canal === "whatsapp" && valor.includes("whats");
}

function destinos(emp) {
    const emails = [];
    const telefones = [];

    if (
        Number(emp.relatorio_usar_email_cadastrado) === 1 &&
        emp.email
    ) {
        emails.push(String(emp.email).trim());
    }

    if (emp.relatorio_email) {
        emails.push(String(emp.relatorio_email).trim());
    }

    if (
        Number(emp.relatorio_usar_telefone_cadastrado) === 1 &&
        emp.telefone
    ) {
        telefones.push(String(emp.telefone).trim());
    }

    if (emp.relatorio_telefone) {
        telefones.push(String(emp.relatorio_telefone).trim());
    }

    return {
        emails: [...new Set(emails.filter(Boolean))],
        telefones: [...new Set(telefones.filter(Boolean))]
    };
}

async function jaEnviado(
    pool,
    empresaId,
    tipo,
    inicio,
    fim,
    canal,
    destino
) {
    const [rows] = await pool.query(
        `
        SELECT id
        FROM relatorios_envios
        WHERE empresa_id = ?
          AND tipo = ?
          AND periodo_inicio = ?
          AND periodo_fim = ?
          AND canal = ?
          AND (
                cliente_email = ?
                OR cliente_telefone = ?
              )
          AND status = 'ENVIADO'
        LIMIT 1
        `,
        [
            empresaId,
            tipo,
            inicio,
            fim,
            canal,
            canal === "email" ? destino : null,
            canal === "whatsapp" ? destino : null
        ]
    );

    return rows.length > 0;
}

async function registrar(pool, dados) {
    await pool.query(
        `
        INSERT INTO relatorios_envios (
            empresa_id,
            cliente_email,
            cliente_telefone,
            tipo,
            periodo_inicio,
            periodo_fim,
            canal,
            nome_arquivo,
            status,
            erro,
            enviado_em
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
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
        ]
    );
}

function tituloTipo(tipo) {
    if (tipo === "diario") return "Relatório Diário";
    if (tipo === "semanal") return "Relatório Semanal";
    if (tipo === "mensal") return "Relatório Mensal";
    return "Relatório SGOS";
}

async function processarEmail(pool, emp, tipo, rel, email, assunto) {
    const duplicado = await jaEnviado(
        pool,
        emp.id,
        tipo,
        rel.inicio,
        rel.fim,
        "email",
        email
    );

    if (duplicado) {
        console.log(
            `⏭️ Empresa ${emp.id}: e-mail ${email} já recebeu ${tipo} neste período.`
        );
        return false;
    }

    try {
        console.log(`📧 Empresa ${emp.id}: enviando para ${email}...`);

        await enviarRelatorio(
            email,
            rel.buffer,
            assunto,
            rel.filename
        );

        await registrar(pool, {
            empresaId: emp.id,
            tipo,
            inicio: rel.inicio,
            fim: rel.fim,
            email,
            canal: "email",
            nomeArquivo: rel.filename,
            status: "ENVIADO"
        });

        console.log(`✅ Empresa ${emp.id}: e-mail enviado para ${email}.`);
        return true;
    } catch (err) {
        console.error(
            `❌ Empresa ${emp.id}: falha no e-mail ${email}:`,
            err.message
        );

        await registrar(pool, {
            empresaId: emp.id,
            tipo,
            inicio: rel.inicio,
            fim: rel.fim,
            email,
            canal: "email",
            nomeArquivo: rel.filename,
            status: "ERRO",
            erro: err.message
        });

        return false;
    }
}

async function processarWhatsApp(
    pool,
    emp,
    tipo,
    rel,
    telefone,
    assunto
) {
    const duplicado = await jaEnviado(
        pool,
        emp.id,
        tipo,
        rel.inicio,
        rel.fim,
        "whatsapp",
        telefone
    );

    if (duplicado) {
        console.log(
            `⏭️ Empresa ${emp.id}: WhatsApp ${telefone} já recebeu ${tipo} neste período.`
        );
        return false;
    }

    try {
        if (typeof enviarMidia !== "function") {
            throw new Error(
                "A função enviarMidia não está disponível no whatsappService."
            );
        }

        console.log(
            `📲 Empresa ${emp.id}: enviando PDF para WhatsApp ${telefone}...`
        );

        const resultado = await enviarMidia(
            emp.id,
            telefone,
            rel.buffer,
            rel.filename,
            `${assunto}\nPeríodo: ${dataBR(rel.inicio)} a ${dataBR(rel.fim)}`
        );

        if (resultado && resultado.ok === false) {
            throw new Error(
                resultado.error ||
                resultado.erro ||
                "Falha ao enviar documento pelo WhatsApp."
            );
        }

        await registrar(pool, {
            empresaId: emp.id,
            tipo,
            inicio: rel.inicio,
            fim: rel.fim,
            telefone,
            canal: "whatsapp",
            nomeArquivo: rel.filename,
            status: "ENVIADO"
        });

        console.log(
            `✅ Empresa ${emp.id}: PDF enviado para WhatsApp ${telefone}.`
        );

        return true;
    } catch (err) {
        console.error(
            `❌ Empresa ${emp.id}: falha no WhatsApp ${telefone}:`,
            err.message
        );

        await registrar(pool, {
            empresaId: emp.id,
            tipo,
            inicio: rel.inicio,
            fim: rel.fim,
            telefone,
            canal: "whatsapp",
            nomeArquivo: rel.filename,
            status: "ERRO",
            erro: err.message
        });

        return false;
    }
}

async function processarTipo(pool, emp, tipo) {
    console.log(
        `📄 Empresa ${emp.id}: iniciando geração do relatório ${tipo}.`
    );

    let rel;

    try {
        rel = await gerarRelatorioEmpresa(pool, emp.id, tipo);
    } catch (err) {
        console.error(
            `❌ Empresa ${emp.id}: erro ao gerar PDF ${tipo}:`,
            err.message
        );
        return;
    }

    if (!rel || !rel.buffer || rel.buffer.length < 100) {
        console.error(
            `❌ Empresa ${emp.id}: PDF ${tipo} vazio ou inválido.`
        );
        return;
    }

    console.log(
        `✅ Empresa ${emp.id}: PDF gerado (${rel.buffer.length} bytes) - ${rel.filename}`
    );

    const { emails, telefones } = destinos(emp);

    console.log(`🎯 Empresa ${emp.id}: destinos encontrados`, {
        emails,
        telefones,
        metodo: emp.relatorio_envio_tipo
    });

    const nomeEmpresa =
        rel.empresa?.nome_provedor ||
        rel.empresa?.nome_fantasia ||
        rel.empresa?.nome_completo ||
        "SGOS";

    const assunto = `${tituloTipo(tipo)} - ${nomeEmpresa}`;

    let sucessos = 0;

    if (metodoInclui(emp.relatorio_envio_tipo, "email")) {
        if (!emails.length) {
            console.warn(
                `⚠️ Empresa ${emp.id}: envio por e-mail habilitado, mas não há destinatário.`
            );
        }

        for (const email of emails) {
            const enviado = await processarEmail(
                pool,
                emp,
                tipo,
                rel,
                email,
                assunto
            );

            if (enviado) sucessos++;
        }
    }

    if (metodoInclui(emp.relatorio_envio_tipo, "whatsapp")) {
        if (!telefones.length) {
            console.warn(
                `⚠️ Empresa ${emp.id}: envio por WhatsApp habilitado, mas não há telefone.`
            );
        }

        for (const telefone of telefones) {
            const enviado = await processarWhatsApp(
                pool,
                emp,
                tipo,
                rel,
                telefone,
                assunto
            );

            if (enviado) sucessos++;
        }
    }

    if (!sucessos) {
        console.warn(
            `⚠️ Empresa ${emp.id}: nenhum envio novo concluído para ${tipo}.`
        );
    } else {
        console.log(
            `🏁 Empresa ${emp.id}: processamento ${tipo} concluído com ${sucessos} envio(s).`
        );
    }
}

module.exports = pool => {
    console.log("🚀 Agendador SGOS carregado.");

    cron.schedule(
        "* * * * *",
        async () => {
            const agora = horarioAgora();

            console.log(
                `\n🕐 [${dataHoraAgora()}] Verificando relatórios automáticos para ${agora}...`
            );

            try {
                const [empresas] = await pool.query(
                    `
                    SELECT *
                    FROM empresa
                    WHERE relatorio_ativo = 1
                      AND ativo = 1
                      AND DATE_FORMAT(
                            COALESCE(relatorio_horario, '08:00:00'),
                            '%H:%i'
                          ) = ?
                    `,
                    [agora]
                );

                console.log(
                    `🏢 Empresas encontradas no horário ${agora}: ${empresas.length}`,
                    empresas.map(emp => emp.id)
                );

                for (const emp of empresas) {
                    try {
                        const periodicidades =
                            parsePeriodicidades(
                                emp.relatorio_periodicidades
                            );

                        console.log(`🔎 Empresa ${emp.id}:`, {
                            horarioBanco: emp.relatorio_horario,
                            ativo: emp.relatorio_ativo,
                            periodicidades,
                            metodo: emp.relatorio_envio_tipo,
                            diaSemanaConfigurado:
                                emp.relatorio_dia_semana,
                            diaSemanaAtual: diaSemanaAgora(),
                            diaMesConfigurado:
                                emp.relatorio_dia_mes,
                            diaMesAtual: diaMesAgora()
                        });

                        if (periodicidades.includes("diario")) {
                            console.log(
                                `➡️ Empresa ${emp.id}: periodicidade diária confirmada.`
                            );

                            await processarTipo(
                                pool,
                                emp,
                                "diario"
                            );
                        }

                        if (
                            periodicidades.includes("semanal") &&
                            Number(emp.relatorio_dia_semana) ===
                                diaSemanaAgora()
                        ) {
                            console.log(
                                `➡️ Empresa ${emp.id}: periodicidade semanal confirmada.`
                            );

                            await processarTipo(
                                pool,
                                emp,
                                "semanal"
                            );
                        }

                        if (
                            periodicidades.includes("mensal") &&
                            Number(emp.relatorio_dia_mes) ===
                                diaMesAgora()
                        ) {
                            console.log(
                                `➡️ Empresa ${emp.id}: periodicidade mensal confirmada.`
                            );

                            await processarTipo(
                                pool,
                                emp,
                                "mensal"
                            );
                        }
                    } catch (err) {
                        console.error(
                            `❌ Empresa ${emp.id}: erro no processamento:`,
                            err
                        );
                    }
                }
            } catch (err) {
                console.error(
                    "❌ Erro no agendador de relatórios:",
                    err
                );
            }
        },
        {
            timezone: FUSO
        }
    );

    // Mantém o lançamento automático de OS.
    cron.schedule(
        "* * * * *",
        async () => {
            try {
                const [lista] = await pool.query(
                    `
                    SELECT id, empresa_id
                    FROM ordens_servico
                    WHERE agendamento_envio IS NOT NULL
                      AND agendamento_envio <= NOW()
                      AND status = 'agendado'
                      AND iniciado_em IS NULL
                    `
                );

                if (!lista.length) return;

                console.log(
                    `🚀 ${lista.length} OS agendada(s) pronta(s) para lançamento.`
                );

                for (const os of lista) {
                    await pool.query(
                        `
                        UPDATE ordens_servico
                        SET
                            status = 'em_andamento',
                            iniciado_em = NOW(),
                            enviado_por = 0
                        WHERE id = ?
                          AND empresa_id = ?
                          AND status = 'agendado'
                        `,
                        [os.id, os.empresa_id]
                    );

                    console.log(
                        `✅ OS ${os.id} da empresa ${os.empresa_id} lançada automaticamente.`
                    );
                }
            } catch (err) {
                console.error(
                    "❌ Erro no cron de OS agendadas:",
                    err
                );
            }
        },
        {
            timezone: FUSO
        }
    );
};
