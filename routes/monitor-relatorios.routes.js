const express = require('express');
const nodemailer = require('nodemailer');

module.exports = (pool) => {
  const router = express.Router();

  function normalizarCargo(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  function somenteSuporteSgosAdministrador(req, res, next) {
    if (!req.usuario) {
      return res.status(401).json({
        erro: 'Não autenticado.',
        codigo: 'NAO_AUTENTICADO'
      });
    }

    const empresaId = Number(req.usuario.empresa_id || 0);
    const administrador = normalizarCargo(req.usuario.cargo) === 'administrador';

    if (empresaId !== 1 || !administrador) {
      return res.status(403).json({
        erro: 'Acesso exclusivo ao Suporte SGOS: empresa 1 e cargo Administrador.',
        codigo: 'ACESSO_EXCLUSIVO_SUPORTE_SGOS'
      });
    }

    next();
  }

  async function tabelaExiste(nome) {
    const [rows] = await pool.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1
    `, [nome]);
    return rows.length > 0;
  }

  function criarTransporter() {
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const secureEnv = String(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || '').toLowerCase();
    const secure = secureEnv ? ['1', 'true', 'sim', 'yes'].includes(secureEnv) : port === 465;

    if (!host || !user || !pass) {
      const erro = new Error('Configuração SMTP incompleta no arquivo .env.');
      erro.codigo = 'smtp_config_incompleta';
      throw erro;
    }

    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 15000,
        tls: { rejectUnauthorized: String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true') !== 'false' }
      }),
      publicInfo: { host, port, secure, user: user.replace(/(^.).*(@.*$)/, '$1***$2') }
    };
  }

  router.use(somenteSuporteSgosAdministrador);

  router.get('/resumo', async (req, res) => {
    try {
      const periodo = Math.max(1, Math.min(365, Number(req.query.dias || 30)));
      const empresaId = Number(req.query.empresa_id || 0);
      const canal = String(req.query.canal || '').toLowerCase();
      const status = String(req.query.status || '').toLowerCase();
      const limite = Math.max(20, Math.min(1000, Number(req.query.limite || 300)));

      const existeLogs = await tabelaExiste('relatorios_logs');
      const existeLegado = await tabelaExiste('relatorios_envios');

      let logs = [];
      if (existeLogs) {
        let where = `WHERE rl.criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
        const params = [periodo];
        if (empresaId) { where += ' AND rl.empresa_id = ?'; params.push(empresaId); }
        if (canal) { where += ' AND rl.canal = ?'; params.push(canal); }
        if (status) { where += ' AND rl.status = ?'; params.push(status); }

        const [rows] = await pool.query(`
          SELECT rl.*, COALESCE(e.nome_provedor, CONCAT('Empresa ', rl.empresa_id)) AS empresa_nome
          FROM relatorios_logs rl
          LEFT JOIN empresa e ON e.id = rl.empresa_id
          ${where}
          ORDER BY rl.id DESC LIMIT ${limite}
        `, params);
        logs = rows;
      }

      let legado = [];
      if (existeLegado) {
        try {
          const [rows] = await pool.query(`
            SELECT re.*, COALESCE(e.nome_provedor, CONCAT('Empresa ', re.empresa_id)) AS empresa_nome
            FROM relatorios_envios re
            LEFT JOIN empresa e ON e.id = re.empresa_id
            ORDER BY re.id DESC LIMIT 300
          `);
          legado = rows;
        } catch (_) { legado = []; }
      }

      const [empresas] = await pool.query(`SELECT id, nome_provedor FROM empresa ORDER BY nome_provedor`);

      const totais = logs.reduce((acc, item) => {
        acc.total++;
        const c = String(item.canal || '').toLowerCase();
        const s = String(item.status || '').toLowerCase();
        if (c === 'email') acc.email++;
        if (c === 'whatsapp') acc.whatsapp++;
        if (s === 'sucesso') acc.sucesso++;
        else if (s === 'falha') acc.falha++;
        else if (s === 'processando' || s === 'pendente') acc.pendente++;
        acc.tempoTotal += Number(item.tempo_ms || 0);
        return acc;
      }, { total: 0, email: 0, whatsapp: 0, sucesso: 0, falha: 0, pendente: 0, tempoTotal: 0 });
      totais.tempo_medio_ms = totais.total ? Math.round(totais.tempoTotal / totais.total) : 0;
      delete totais.tempoTotal;

      return res.json({ ok: true, periodo_dias: periodo, totais, logs, legado, empresas });
    } catch (err) {
      console.error('Erro no monitor de relatórios:', err);
      return res.status(500).json({ erro: err.message || 'Erro ao carregar monitor.' });
    }
  });

  router.get('/status-email', async (_req, res) => {
    const inicio = Date.now();
    try {
      const { transporter, publicInfo } = criarTransporter();
      await transporter.verify();
      return res.json({ ok: true, status: 'conectado', tempo_ms: Date.now() - inicio, configuracao: publicInfo });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        status: 'desconectado',
        tempo_ms: Date.now() - inicio,
        codigo: err.codigo || err.code || 'smtp_error',
        erro: err.message || 'Falha na conexão SMTP.'
      });
    }
  });

  router.post('/testar-email', async (req, res) => {
    const inicio = Date.now();
    try {
      const destino = String(req.body?.email || '').trim();
      if (!destino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
        return res.status(400).json({ erro: 'Informe um e-mail válido para o teste.' });
      }
      const { transporter } = criarTransporter();
      const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER;
      const info = await transporter.sendMail({
        from,
        to: destino,
        subject: 'Teste de conexão SGOS',
        text: 'Este é um teste de conexão do monitor administrativo de relatórios do SGOS.',
        html: '<p>Este é um <strong>teste de conexão</strong> do monitor administrativo de relatórios do SGOS.</p>'
      });
      return res.json({ ok: true, mensagem: 'E-mail de teste enviado.', message_id: info.messageId, tempo_ms: Date.now() - inicio });
    } catch (err) {
      return res.status(500).json({ ok: false, erro: err.message || 'Falha ao enviar e-mail de teste.', tempo_ms: Date.now() - inicio });
    }
  });

  router.get('/exportar.csv', async (_req, res) => {
    try {
      if (!(await tabelaExiste('relatorios_logs'))) return res.status(404).send('Tabela relatorios_logs não encontrada.');
      const [rows] = await pool.query(`
        SELECT id, empresa_id, tipo_relatorio, origem, canal, destinatario, status,
               tentativa, tempo_ms, mensagem_erro, criado_em, finalizado_em
        FROM relatorios_logs ORDER BY id DESC LIMIT 10000
      `);
      const campos = ['id','empresa_id','tipo_relatorio','origem','canal','destinatario','status','tentativa','tempo_ms','mensagem_erro','criado_em','finalizado_em'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [campos.join(';'), ...rows.map(r => campos.map(c => esc(r[c])).join(';'))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="logs-relatorios-sgos.csv"');
      return res.send('\ufeff' + csv);
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  });

  return router;
};
