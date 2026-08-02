'use strict';

const { enviarMensagemCentral } = require('./whatsappService');

module.exports = function criarMinhasFaturasService(pool) {
    function dataLocalISO(data = new Date()) {
        return [
            data.getFullYear(),
            String(data.getMonth() + 1).padStart(2, '0'),
            String(data.getDate()).padStart(2, '0')
        ].join('-');
    }

    function adicionarDias(data, dias) {
        const copia = new Date(data.getFullYear(), data.getMonth(), data.getDate());
        copia.setDate(copia.getDate() + dias);
        return copia;
    }

    function validarDataSolicitada(data) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
            const erro = new Error('Informe uma data válida.');
            erro.status = 400;
            throw erro;
        }

        const hoje = new Date();
        const minimo = dataLocalISO(hoje);
        const maximo = dataLocalISO(adicionarDias(hoje, 2));

        if (data < minimo || data > maximo) {
            const erro = new Error(
                'A promessa pode ser solicitada somente para hoje ou até dois dias à frente.'
            );
            erro.status = 400;
            erro.codigo = 'PROMESSA_DATA_FORA_DO_LIMITE';
            throw erro;
        }

        return { minimo, maximo };
    }

    async function telefoneSuporte() {
        const configurado = String(process.env.SGOS_SUPORTE_WHATSAPP || '').trim();
        if (configurado) return configurado;

        const [rows] = await pool.query(
            `SELECT telefone
             FROM empresa
             WHERE id = 1
             LIMIT 1`
        );

        return String(rows[0]?.telefone || '').trim();
    }

    async function notificarSuporteWhatsApp({
        empresaId,
        cobrancaId,
        solicitacaoId,
        dataSolicitada,
        observacao,
        usuarioId
    }) {
        try {
            const [rows] = await pool.query(
                `SELECT
                    e.nome_fantasia,
                    e.nome_provedor,
                    e.razao_social,
                    c.competencia,
                    c.descricao,
                    c.valor,
                    c.vencimento,
                    u.usuario AS solicitante
                 FROM empresa e
                 INNER JOIN empresa_cobrancas c
                    ON c.empresa_id = e.id
                   AND c.id = ?
                 LEFT JOIN usuarios u
                    ON u.id = ?
                 WHERE e.id = ?
                 LIMIT 1`,
                [cobrancaId, usuarioId || null, empresaId]
            );

            const dados = rows[0] || {};
            const destino = await telefoneSuporte();

            if (!destino) {
                throw new Error(
                    'Configure SGOS_SUPORTE_WHATSAPP no .env ou o telefone da empresa 1.'
                );
            }

            const empresaNome =
                dados.nome_fantasia ||
                dados.nome_provedor ||
                dados.razao_social ||
                'Empresa não identificada';

            const valor = Number(dados.valor || 0).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            });

            const mensagem = [
                '📌 *NOVA SOLICITAÇÃO DE PROMESSA DE PAGAMENTO*',
                '',
                `🏢 Empresa: ${empresaNome}`,
                `🧾 Competência: ${dados.competencia || '-'}`,
                `📝 Fatura: ${dados.descricao || '-'}`,
                `💰 Valor: ${valor}`,
                `📅 Vencimento: ${dados.vencimento
                    ? new Date(`${String(dados.vencimento).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')
                    : '-'}`,
                `🤝 Data solicitada: ${new Date(`${dataSolicitada}T00:00:00`).toLocaleDateString('pt-BR')}`,
                `👤 Solicitante: ${dados.solicitante || 'Usuário da empresa'}`,
                `💬 Justificativa: ${String(observacao || '').trim() || 'Não informada'}`,
                '',
                `🔎 Solicitação nº ${solicitacaoId}`,
                'Acesse o Financeiro das Empresas no SGOS para aprovar ou recusar.'
            ].join('\n');

            const resultado = await enviarMensagemCentral(destino, mensagem);

            await pool.query(
                `INSERT INTO cobrancas_comunicacoes
                 (
                    empresa_id,
                    cobranca_id,
                    canal,
                    tipo,
                    destinatario,
                    status,
                    mensagem,
                    resposta,
                    tentativas,
                    enviado_em,
                    erro,
                    criado_em
                 )
                 VALUES (?, ?, 'WHATSAPP', 'SOLICITACAO_PROMESSA_SUPORTE', ?, ?, ?, ?, 1, ?, ?, NOW())`,
                [
                    empresaId,
                    cobrancaId,
                    destino,
                    resultado?.ok ? 'ENVIADO' : 'ERRO',
                    mensagem,
                    JSON.stringify(resultado || {}),
                    resultado?.ok ? new Date() : null,
                    resultado?.ok ? null : String(
                        resultado?.detail ||
                        resultado?.error ||
                        'Falha ao enviar a mensagem.'
                    )
                ]
            );

            return {
                enviado: Boolean(resultado?.ok),
                destino,
                resultado
            };
        } catch (erro) {
            console.error('Erro ao enviar solicitação de promessa ao WhatsApp do SGOS:', erro);

            try {
                await pool.query(
                    `INSERT INTO cobrancas_comunicacoes
                     (
                        empresa_id,
                        cobranca_id,
                        canal,
                        tipo,
                        destinatario,
                        status,
                        mensagem,
                        resposta,
                        tentativas,
                        enviado_em,
                        erro,
                        criado_em
                     )
                     VALUES (?, ?, 'WHATSAPP', 'SOLICITACAO_PROMESSA_SUPORTE', NULL, 'ERRO',
                             'Falha ao preparar notificação da solicitação de promessa.',
                             NULL, 1, NULL, ?, NOW())`,
                    [
                        empresaId,
                        cobrancaId,
                        String(erro?.message || erro)
                    ]
                );
            } catch {}

            return {
                enviado: false,
                erro: erro?.message || String(erro)
            };
        }
    }

    async function empresa(id) {
        const [rows] = await pool.query(
            `SELECT id, nome_fantasia, razao_social, nome_provedor, plano_empresa,
                    financeiro_status, COALESCE(suspensa_financeiro,0) AS suspensa_financeiro,
                    suspensa_em, suspensa_motivo
             FROM empresa
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        return rows[0] || null;
    }

    async function faturas(id) {
        const [rows] = await pool.query(
            `SELECT c.*,
                    (
                        SELECT p.id
                        FROM empresa_promessas_pagamento p
                        WHERE p.cobranca_id = c.id
                          AND p.status = 'ATIVA'
                          AND p.acesso_liberado_ate >= NOW()
                        ORDER BY p.id DESC
                        LIMIT 1
                    ) AS promessa_id,
                    (
                        SELECT p.acesso_liberado_ate
                        FROM empresa_promessas_pagamento p
                        WHERE p.cobranca_id = c.id
                          AND p.status = 'ATIVA'
                          AND p.acesso_liberado_ate >= NOW()
                        ORDER BY p.id DESC
                        LIMIT 1
                    ) AS promessa_ate
             FROM empresa_cobrancas c
             WHERE c.empresa_id = ?
             ORDER BY c.vencimento DESC, c.id DESC`,
            [id]
        );
        return rows;
    }

    async function resumo(id) {
        const emp = await empresa(id);
        if (!emp) {
            const erro = new Error('Empresa não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const lista = await faturas(id);
        const pendentes = lista.filter(item =>
            ['PENDENTE','VENCIDO'].includes(String(item.status_interno || '').toUpperCase())
        );
        const vencidas = lista.filter(item =>
            String(item.status_interno || '').toUpperCase() === 'VENCIDO'
        );
        const pagas = lista.filter(item =>
            String(item.status_interno || '').toUpperCase() === 'PAGO'
        );
        const proxima = lista
            .filter(item => String(item.status_interno || '').toUpperCase() === 'PENDENTE')
            .sort((a,b) => String(a.vencimento).localeCompare(String(b.vencimento)))[0] || null;

        let aviso = null;

        if (Number(emp.suspensa_financeiro) === 1) {
            aviso = {
                nivel: 'SUSPENSO',
                titulo: 'Acesso suspenso',
                mensagem: emp.suspensa_motivo || 'Pendência financeira',
                suspensao_programada_em: emp.suspensa_em
            };
        } else if (vencidas.length) {
            const cobranca = [...vencidas].sort(
                (a,b) => String(a.vencimento).localeCompare(String(b.vencimento))
            )[0];

            aviso = {
                nivel: 'VENCIDO',
                titulo: 'Existe uma mensalidade pendente',
                mensagem: 'Regularize a pendência para evitar suspensão.',
                suspensao_programada_em: cobranca.suspensao_programada_em,
                cobranca_id: cobranca.id
            };
        }

        return {
            empresa: emp,
            resumo: {
                total_aberto: pendentes.reduce((s,item) => s + Number(item.valor || 0), 0),
                pendentes: pendentes.length,
                vencidas: vencidas.length,
                pagas: pagas.length,
                proxima_fatura: proxima,
                ultimo_pagamento: pagas[0] || null,
                aviso
            },
            faturas: lista
        };
    }

    async function timeline(id) {
        const [rows] = await pool.query(
            `SELECT id, cobranca_id, acao, detalhes, criado_em
             FROM empresa_financeiro_logs
             WHERE empresa_id = ?
             ORDER BY id DESC
             LIMIT 100`,
            [id]
        );
        return rows;
    }

    async function solicitar({empresaId, cobrancaId, data, observacao, usuarioId}) {
        validarDataSolicitada(data);

        const [cobrancas] = await pool.query(
            `SELECT id, status_interno
             FROM empresa_cobrancas
             WHERE id = ?
               AND empresa_id = ?
             LIMIT 1`,
            [cobrancaId, empresaId]
        );

        if (!cobrancas.length) {
            const erro = new Error('Cobrança não encontrada.');
            erro.status = 404;
            throw erro;
        }

        const [existentes] = await pool.query(
            `SELECT id
             FROM empresa_solicitacoes_promessa
             WHERE empresa_id = ?
               AND cobranca_id = ?
               AND status = 'PENDENTE'
             LIMIT 1`,
            [empresaId, cobrancaId]
        );

        if (existentes.length) {
            const erro = new Error('Já existe solicitação pendente.');
            erro.status = 409;
            throw erro;
        }

        const [resultado] = await pool.query(
            `INSERT INTO empresa_solicitacoes_promessa
             (empresa_id, cobranca_id, data_solicitada, observacao, status, solicitado_por, solicitado_em)
             VALUES (?, ?, ?, ?, 'PENDENTE', ?, NOW())`,
            [empresaId, cobrancaId, data, String(observacao || ''), usuarioId || null]
        );

        await pool.query(
            `INSERT INTO empresa_financeiro_logs
             (empresa_id, cobranca_id, usuario_id, acao, detalhes, criado_em)
             VALUES (?, ?, ?, 'SOLICITACAO_PROMESSA_CRIADA', ?, NOW())`,
            [
                empresaId,
                cobrancaId,
                usuarioId || null,
                JSON.stringify({
                    solicitacao_id: resultado.insertId,
                    data_solicitada: data
                })
            ]
        );

        const whatsapp = await notificarSuporteWhatsApp({
            empresaId,
            cobrancaId,
            solicitacaoId: resultado.insertId,
            dataSolicitada: data,
            observacao,
            usuarioId
        });

        return {
            id: resultado.insertId,
            whatsapp_notificado: Boolean(whatsapp?.enviado),
            whatsapp_detalhes: whatsapp
        };
    }

    async function solicitacoes(id) {
        const [rows] = await pool.query(
            `SELECT s.*, c.competencia, c.valor, c.vencimento, c.status_interno
             FROM empresa_solicitacoes_promessa s
             INNER JOIN empresa_cobrancas c ON c.id = s.cobranca_id
             WHERE s.empresa_id = ?
             ORDER BY s.id DESC`,
            [id]
        );
        return rows;
    }

    return {
        resumo,
        faturas,
        timeline,
        solicitar,
        solicitacoes
    };
};
