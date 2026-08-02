'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');
const asaas = require('./asaas.service');
const {
    enviarMensagemCentral,
    enviarMidiaCentral
} = require('./whatsappService');

module.exports = function criarAsaasNotificacoesService(pool) {
    function nomeEmpresa(empresa) {
        return (
            empresa.nome_fantasia ||
            empresa.nome_provedor ||
            empresa.razao_social ||
            empresa.nome_completo ||
            'Empresa'
        );
    }

    function moeda(valor) {
        return Number(valor || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }

    function dataBR(valor) {
        if (!valor) return '-';
        const data = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
        return data.toLocaleDateString('pt-BR');
    }

    function normalizarTelefone(valor) {
        return String(valor || '').replace(/\D/g, '');
    }

    function criarTransporter() {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    async function registrarComunicacao({
        empresaId,
        cobrancaId,
        canal,
        tipo,
        destinatario,
        status,
        mensagem,
        resposta = null,
        erro = null
    }) {
        const [resultado] = await pool.query(
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
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW())`,
            [
                empresaId,
                cobrancaId,
                canal,
                tipo,
                destinatario || null,
                status,
                mensagem,
                resposta,
                status === 'ENVIADO' ? new Date() : null,
                erro
            ]
        );

        return resultado.insertId;
    }

    async function jaEnviado(cobrancaId, canal, tipo) {
        const [rows] = await pool.query(
            `SELECT id
             FROM cobrancas_comunicacoes
             WHERE cobranca_id = ?
               AND canal = ?
               AND tipo = ?
               AND status = 'ENVIADO'
             LIMIT 1`,
            [cobrancaId, canal, tipo]
        );
        return rows.length > 0;
    }

    async function baixarPdf(url) {
        if (!url) throw new Error('URL do boleto não informada.');

        const resposta = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 45000,
            maxRedirects: 5,
            headers: {
                Accept: 'application/pdf,*/*'
            }
        });

        const buffer = Buffer.from(resposta.data);
        if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
            throw new Error('PDF do boleto vazio ou inválido.');
        }

        return buffer;
    }

    async function obterPix(cobranca) {
        try {
            const pix = await asaas.consultarPixCobranca(cobranca.asaas_payment_id);
            return {
                payload: pix?.payload || null,
                encodedImage: pix?.encodedImage || null,
                expirationDate: pix?.expirationDate || null
            };
        } catch (erro) {
            console.warn(
                `Não foi possível obter Pix da cobrança ${cobranca.id}:`,
                erro.message
            );
            return {
                payload: null,
                encodedImage: null,
                expirationDate: null
            };
        }
    }

    async function buscarDados(cobrancaId) {
        const [rows] = await pool.query(
            `SELECT
                c.*,
                e.nome_fantasia,
                e.nome_provedor,
                e.razao_social,
                e.nome_completo,
                e.email,
                e.telefone
             FROM empresa_cobrancas c
             INNER JOIN empresa e ON e.id = c.empresa_id
             WHERE c.id = ?
             LIMIT 1`,
            [cobrancaId]
        );

        return rows[0] || null;
    }

    async function enviarEmail({
        empresa,
        cobranca,
        tipo,
        assunto,
        html,
        pdf = null
    }) {
        const email = String(empresa.email || '').trim();
        if (!email) throw new Error('Empresa sem e-mail cadastrado.');

        const mail = {
            from:
                process.env.SMTP_FROM ||
                `"SGOS" <${process.env.SMTP_USER}>`,
            to: email,
            subject: assunto,
            html
        };

        if (pdf) {
            mail.attachments = [{
                filename: `Boleto-SGOS-${cobranca.competencia || cobranca.id}.pdf`,
                content: pdf,
                contentType: 'application/pdf'
            }];
        }

        const transporter = criarTransporter();
        const resposta = await transporter.sendMail(mail);

        await registrarComunicacao({
            empresaId: cobranca.empresa_id,
            cobrancaId: cobranca.id,
            canal: 'EMAIL',
            tipo,
            destinatario: email,
            status: 'ENVIADO',
            mensagem: assunto,
            resposta: JSON.stringify({
                messageId: resposta?.messageId || null,
                accepted: resposta?.accepted || []
            })
        });

        return resposta;
    }

    async function enviarWhatsappTexto({
        empresa,
        cobranca,
        tipo,
        mensagem
    }) {
        const telefone = normalizarTelefone(empresa.telefone);
        if (!telefone) throw new Error('Empresa sem telefone cadastrado.');

        const resposta = await enviarMensagemCentral(telefone, mensagem);

        if (!resposta?.ok) {
            throw new Error(
                resposta?.detail ||
                resposta?.error ||
                'Falha no envio pelo WhatsApp.'
            );
        }

        await registrarComunicacao({
            empresaId: cobranca.empresa_id,
            cobrancaId: cobranca.id,
            canal: 'WHATSAPP',
            tipo,
            destinatario: telefone,
            status: 'ENVIADO',
            mensagem,
            resposta: JSON.stringify(resposta)
        });

        return resposta;
    }

    async function enviarWhatsappPdf({
        empresa,
        cobranca,
        tipo,
        mensagem,
        pdf
    }) {
        const telefone = normalizarTelefone(empresa.telefone);
        if (!telefone) throw new Error('Empresa sem telefone cadastrado.');

        const resposta = await enviarMidiaCentral(
            1,
            telefone,
            pdf,
            `Boleto-SGOS-${cobranca.competencia || cobranca.id}.pdf`,
            mensagem
        );

        if (!resposta?.ok) {
            throw new Error(
                resposta?.detail ||
                resposta?.error ||
                'Falha no envio do PDF pelo WhatsApp.'
            );
        }

        await registrarComunicacao({
            empresaId: cobranca.empresa_id,
            cobrancaId: cobranca.id,
            canal: 'WHATSAPP',
            tipo,
            destinatario: telefone,
            status: 'ENVIADO',
            mensagem,
            resposta: JSON.stringify(resposta)
        });

        return resposta;
    }

    async function registrarErro({
        empresa,
        cobranca,
        canal,
        tipo,
        mensagem,
        erro
    }) {
        await registrarComunicacao({
            empresaId: cobranca.empresa_id,
            cobrancaId: cobranca.id,
            canal,
            tipo,
            destinatario:
                canal === 'EMAIL'
                    ? empresa.email
                    : normalizarTelefone(empresa.telefone),
            status: 'ERRO',
            mensagem,
            erro: String(erro?.message || erro)
        });
    }

    async function enviarLembreteUmDiaAntes(cobrancaId) {
        const dados = await buscarDados(cobrancaId);
        if (!dados) throw new Error('Cobrança não encontrada.');

        const empresa = dados;
        const cobranca = dados;
        const nome = nomeEmpresa(empresa);
        const link = cobranca.invoice_url || cobranca.bank_slip_url || '';

        const mensagem = [
            `Olá, *${nome}*!`,
            '',
            'Sua mensalidade do SGOS vence amanhã.',
            `Valor: *${moeda(cobranca.valor)}*`,
            `Vencimento: *${dataBR(cobranca.vencimento)}*`,
            link ? `Fatura: ${link}` : '',
            '',
            'Caso o pagamento já tenha sido realizado, desconsidere.'
        ].filter(Boolean).join('\n');

        const html = `
            <div style="font-family:Arial,sans-serif;color:#0f172a">
                <h2>Olá, ${nome}!</h2>
                <p>Sua mensalidade do SGOS vence amanhã.</p>
                <p><strong>Valor:</strong> ${moeda(cobranca.valor)}<br>
                <strong>Vencimento:</strong> ${dataBR(cobranca.vencimento)}</p>
                ${link ? `<p><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 16px;border-radius:8px;display:inline-block">Visualizar fatura</a></p>` : ''}
                <p>Atenciosamente,<br>Equipe SGOS</p>
            </div>
        `;

        if (!await jaEnviado(cobranca.id, 'WHATSAPP', 'LEMBRETE_D1')) {
            try {
                await enviarWhatsappTexto({
                    empresa,
                    cobranca,
                    tipo: 'LEMBRETE_D1',
                    mensagem
                });
            } catch (erro) {
                await registrarErro({
                    empresa,
                    cobranca,
                    canal: 'WHATSAPP',
                    tipo: 'LEMBRETE_D1',
                    mensagem,
                    erro
                });
            }
        }

        if (!await jaEnviado(cobranca.id, 'EMAIL', 'LEMBRETE_D1')) {
            try {
                await enviarEmail({
                    empresa,
                    cobranca,
                    tipo: 'LEMBRETE_D1',
                    assunto: 'Sua mensalidade do SGOS vence amanhã',
                    html
                });
            } catch (erro) {
                await registrarErro({
                    empresa,
                    cobranca,
                    canal: 'EMAIL',
                    tipo: 'LEMBRETE_D1',
                    mensagem: 'Sua mensalidade vence amanhã.',
                    erro
                });
            }
        }
    }

    async function enviarVencimentoHoje(cobrancaId) {
        const dados = await buscarDados(cobrancaId);
        if (!dados) throw new Error('Cobrança não encontrada.');

        const empresa = dados;
        const cobranca = dados;
        const nome = nomeEmpresa(empresa);
        const pix = await obterPix(cobranca);
        const pdf = await baixarPdf(
            cobranca.bank_slip_url ||
            cobranca.invoice_url
        );

        const legenda = [
            `Olá, *${nome}*!`,
            '',
            'Sua mensalidade do SGOS vence hoje.',
            `Valor: *${moeda(cobranca.valor)}*`,
            `Vencimento: *${dataBR(cobranca.vencimento)}*`,
            '',
            'Segue o boleto em PDF.'
        ].join('\n');

        const textoPix = [
            '💠 *PIX COPIA E COLA*',
            pix.payload || 'O Pix não ficou disponível para esta cobrança.',
            '',
            cobranca.invoice_url
                ? `Abrir fatura: ${cobranca.invoice_url}`
                : ''
        ].filter(Boolean).join('\n');

        const html = `
            <div style="font-family:Arial,sans-serif;color:#0f172a">
                <h2>Olá, ${nome}!</h2>
                <p>Sua mensalidade do SGOS vence hoje.</p>
                <p><strong>Valor:</strong> ${moeda(cobranca.valor)}<br>
                <strong>Vencimento:</strong> ${dataBR(cobranca.vencimento)}</p>
                ${pix.payload ? `
                    <p><strong>Pix Copia e Cola:</strong></p>
                    <div style="background:#f1f5f9;padding:12px;border-radius:8px;word-break:break-all">${pix.payload}</div>
                ` : ''}
                ${cobranca.invoice_url ? `<p><a href="${cobranca.invoice_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 16px;border-radius:8px;display:inline-block">Abrir fatura</a></p>` : ''}
                <p>O boleto em PDF está anexado a este e-mail.</p>
                <p>Atenciosamente,<br>Equipe SGOS</p>
            </div>
        `;

        if (!await jaEnviado(cobranca.id, 'WHATSAPP', 'VENCIMENTO_D0_PDF')) {
            try {
                await enviarWhatsappPdf({
                    empresa,
                    cobranca,
                    tipo: 'VENCIMENTO_D0_PDF',
                    mensagem: legenda,
                    pdf
                });

                await enviarWhatsappTexto({
                    empresa,
                    cobranca,
                    tipo: 'VENCIMENTO_D0_PIX',
                    mensagem: textoPix
                });
            } catch (erro) {
                await registrarErro({
                    empresa,
                    cobranca,
                    canal: 'WHATSAPP',
                    tipo: 'VENCIMENTO_D0_PDF',
                    mensagem: legenda,
                    erro
                });
            }
        }

        if (!await jaEnviado(cobranca.id, 'EMAIL', 'VENCIMENTO_D0')) {
            try {
                await enviarEmail({
                    empresa,
                    cobranca,
                    tipo: 'VENCIMENTO_D0',
                    assunto: 'Sua mensalidade do SGOS vence hoje',
                    html,
                    pdf
                });
            } catch (erro) {
                await registrarErro({
                    empresa,
                    cobranca,
                    canal: 'EMAIL',
                    tipo: 'VENCIMENTO_D0',
                    mensagem: 'Boleto com vencimento hoje.',
                    erro
                });
            }
        }
    }

    async function executarRotina() {
        const [d1] = await pool.query(
            `SELECT id
             FROM empresa_cobrancas
             WHERE status_interno = 'PENDENTE'
               AND vencimento = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
             ORDER BY id`
        );

        const [d0] = await pool.query(
            `SELECT id
             FROM empresa_cobrancas
             WHERE status_interno = 'PENDENTE'
               AND vencimento = CURDATE()
             ORDER BY id`
        );

        for (const item of d1) {
            await enviarLembreteUmDiaAntes(item.id);
        }

        for (const item of d0) {
            await enviarVencimentoHoje(item.id);
        }

        if (d1.length || d0.length) {
            console.log('ROTINA DE NOTIFICAÇÕES ASAAS:', {
                lembretes_d1: d1.length,
                vencimentos_d0: d0.length
            });
        }

        return {
            lembretes_d1: d1.length,
            vencimentos_d0: d0.length
        };
    }

    return {
        executarRotina,
        enviarLembreteUmDiaAntes,
        enviarVencimentoHoje
    };
};
