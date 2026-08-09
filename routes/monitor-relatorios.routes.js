const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const { enviarMidiaCentral } = require('../services/whatsappService');

module.exports = (pool) => {
  const router = express.Router();

  function normalizarCargo(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  function somenteSuporteAdministrador(req, res, next) {
    if (Number(req.usuario?.empresa_id) !== 1 || normalizarCargo(req.usuario?.cargo) !== 'administrador') {
      return res.status(403).json({ erro: 'Acesso exclusivo para administradores do Suporte SGOS.' });
    }
    next();
  }

  router.use(somenteSuporteAdministrador);

  async function garantirTabelaMonitorConexoes() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitor_conexoes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        servico ENUM('whatsapp','email') NOT NULL,
        status ENUM('conectado','desconectado','erro') NOT NULL,
        tempo_ms INT UNSIGNED NULL,
        mensagem VARCHAR(500) NULL,
        detalhes LONGTEXT NULL,
        testado_por BIGINT NULL,
        testado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_monitor_conexoes_servico_data (servico, testado_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async function salvarTesteConexao({ servico, status, tempo_ms = null, mensagem = null, detalhes = null, usuario_id = null }) {
    await garantirTabelaMonitorConexoes();
    await pool.query(
      `INSERT INTO monitor_conexoes (servico, status, tempo_ms, mensagem, detalhes, testado_por, testado_em)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [servico, status, tempo_ms, mensagem, detalhes ? JSON.stringify(detalhes) : null, usuario_id]
    );
  }

  async function tabelaExiste(nome) {
    const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [nome]);
    return rows.length > 0;
  }

  async function colunasTabela(nome) {
    const [rows] = await pool.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [nome]);
    return new Set(rows.map(r => r.COLUMN_NAME));
  }

  function criarTransporter() {
    const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
    const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const secureEnv = String(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || '').toLowerCase();
    const secure = secureEnv ? ['1','true','sim','yes'].includes(secureEnv) : port === 465;
    if (!host || !user || !pass) throw new Error('Configuração SMTP incompleta no arquivo .env.');
    return { transporter: nodemailer.createTransport({ host, port, secure, auth:{user,pass}, connectionTimeout:12000, greetingTimeout:12000, socketTimeout:15000, tls:{rejectUnauthorized:String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true') !== 'false'} }), publicInfo:{host,port,secure,user:user.replace(/(^.).*(@.*$)/,'$1***$2')} };
  }

  function arquivoNovo(row) {
    if (!row?.caminho_arquivo) return null;
    const raiz = path.resolve(__dirname, '..');
    const absoluto = path.resolve(raiz, row.caminho_arquivo);
    if (!absoluto.startsWith(raiz + path.sep) || !fs.existsSync(absoluto) || !fs.statSync(absoluto).isFile()) return null;
    return absoluto;
  }

  function localizarArquivoLegado(row) {
    const nome = path.basename(String(row?.nome_arquivo || ''));
    if (!nome) return null;
    const raiz = path.resolve(__dirname, '..');
    const candidatos = [
      path.join(raiz, 'uploads', 'relatorios-monitor', nome),
      path.join(raiz, 'uploads', 'relatorios', nome),
      path.join(raiz, 'uploads', nome),
      path.join(raiz, 'public', 'relatorios', nome)
    ];
    return candidatos.find(a => fs.existsSync(a) && fs.statSync(a).isFile()) || null;
  }

  async function obterRegistroParaReenvio(fonte, id) {
    let row = null;
    let arquivo = null;

    if (fonte === 'novo') {
      const [rows] = await pool.query(`SELECT * FROM relatorios_logs WHERE id=? LIMIT 1`, [id]);
      row = rows[0] || null;
      arquivo = row ? arquivoNovo(row) : null;
    } else if (fonte === 'legado') {
      const [rows] = await pool.query(`SELECT * FROM relatorios_envios WHERE id=? LIMIT 1`, [id]);
      row = rows[0] || null;
      arquivo = row ? localizarArquivoLegado(row) : null;
    }

    return { row, arquivo };
  }

  async function atualizarResultadoReenvio(fonte, id, { sucesso, erro = null }) {
    try {
      if (fonte === 'novo' && await tabelaExiste('relatorios_logs')) {
        const cols = await colunasTabela('relatorios_logs');
        const sets = [];
        const params = [];
        if (cols.has('status')) { sets.push('status=?'); params.push(sucesso ? 'sucesso' : 'falha'); }
        if (cols.has('mensagem_erro')) { sets.push('mensagem_erro=?'); params.push(sucesso ? null : erro); }
        if (cols.has('erro')) { sets.push('erro=?'); params.push(sucesso ? null : erro); }
        if (cols.has('finalizado_em')) sets.push('finalizado_em=NOW()');
        if (sets.length) { params.push(id); await pool.query(`UPDATE relatorios_logs SET ${sets.join(', ')} WHERE id=?`, params); }
      } else if (fonte === 'legado' && await tabelaExiste('relatorios_envios')) {
        const cols = await colunasTabela('relatorios_envios');
        const sets = [];
        const params = [];
        if (cols.has('status')) { sets.push('status=?'); params.push(sucesso ? 'ENVIADO' : 'ERRO'); }
        if (cols.has('erro')) { sets.push('erro=?'); params.push(sucesso ? null : erro); }
        if (cols.has('enviado_em')) sets.push('enviado_em=NOW()');
        if (sets.length) { params.push(id); await pool.query(`UPDATE relatorios_envios SET ${sets.join(', ')} WHERE id=?`, params); }
      }
    } catch (err) {
      console.error('Falha ao atualizar resultado do reenvio:', err);
    }
  }

  router.get('/resumo', async (req, res) => {
    try {
      const periodo = Math.max(1, Math.min(3650, Number(req.query.dias || 30)));
      const empresaId = Number(req.query.empresa_id || 0);
      const canalFiltro = String(req.query.canal || '').toLowerCase();
      const statusFiltro = String(req.query.status || '').toLowerCase();
      const limite = Math.max(20, Math.min(2000, Number(req.query.limite || 500)));
      const registros = [];

      if (await tabelaExiste('relatorios_logs')) {
        let where = `WHERE rl.criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
        const params = [periodo];
        if (empresaId) { where += ' AND rl.empresa_id = ?'; params.push(empresaId); }
        if (canalFiltro) { where += ' AND LOWER(rl.canal) = ?'; params.push(canalFiltro); }
        if (statusFiltro) { where += ' AND LOWER(rl.status) = ?'; params.push(statusFiltro); }
        const [rows] = await pool.query(`
          SELECT rl.*, COALESCE(e.nome_provedor, CONCAT('Empresa ', rl.empresa_id)) AS empresa_nome
          FROM relatorios_logs rl LEFT JOIN empresa e ON e.id = rl.empresa_id
          ${where} ORDER BY rl.id DESC LIMIT ${limite}`, params);
        for (const r of rows) {
          const disponivel = !!arquivoNovo(r);
          registros.push({
            ...r, fonte:'novo', telefone:r.canal === 'whatsapp' ? r.destinatario : null,
            enviado_em:r.finalizado_em || r.criado_em,
            arquivo_disponivel:disponivel,
            arquivo_url:disponivel ? `/api/admin/monitor-relatorios/arquivo/novo/${r.id}` : null
          });
        }
      }

      if (await tabelaExiste('relatorios_envios')) {
        const cols = await colunasTabela('relatorios_envios');
        const colData = cols.has('enviado_em') ? 're.enviado_em' : (cols.has('created_at') ? 're.created_at' : 'NULL');
        let where = colData !== 'NULL' ? `WHERE ${colData} >= DATE_SUB(NOW(), INTERVAL ? DAY)` : 'WHERE 1=1';
        const params = colData !== 'NULL' ? [periodo] : [];
        if (empresaId && cols.has('empresa_id')) { where += ' AND re.empresa_id = ?'; params.push(empresaId); }
        if (canalFiltro && cols.has('canal')) { where += ' AND LOWER(re.canal) = ?'; params.push(canalFiltro); }
        const [rows] = await pool.query(`SELECT re.*, COALESCE(e.nome_provedor, CONCAT('Empresa ', re.empresa_id)) AS empresa_nome FROM relatorios_envios re LEFT JOIN empresa e ON e.id = re.empresa_id ${where} ORDER BY re.id DESC LIMIT ${limite}`, params);
        for (const r of rows) {
          const statusNorm = ['enviado','sucesso','success'].includes(String(r.status || '').toLowerCase()) ? 'sucesso' : ['erro','falha','failed'].includes(String(r.status || '').toLowerCase()) ? 'falha' : 'pendente';
          if (statusFiltro && statusNorm !== statusFiltro) continue;
          const canalNorm = String(r.canal || (r.cliente_telefone ? 'whatsapp' : 'email')).toLowerCase();
          if (canalFiltro && canalNorm !== canalFiltro) continue;
          const disponivel = !!localizarArquivoLegado(r);
          registros.push({
            ...r, fonte:'legado', canal:canalNorm, status:statusNorm,
            tipo_relatorio:r.tipo || r.tipo_relatorio || 'relatório', origem:'automatico',
            destinatario:r.cliente_telefone || r.cliente_email || r.email || null,
            telefone:r.cliente_telefone || null,
            enviado_em:r.enviado_em || r.created_at || null,
            criado_em:r.enviado_em || r.created_at || null,
            arquivo_disponivel:disponivel,
            arquivo_url:disponivel ? `/api/admin/monitor-relatorios/arquivo/legado/${r.id}` : null
          });
        }
      }

      registros.sort((a,b) => new Date(b.enviado_em || b.criado_em || 0) - new Date(a.enviado_em || a.criado_em || 0));
      const logs = registros.slice(0, limite);
      const totais = registros.reduce((a,r) => {
        a.total++; const c=String(r.canal||'').toLowerCase(); const st=String(r.status||'').toLowerCase();
        if(c==='email')a.email++; if(c==='whatsapp')a.whatsapp++; if(st==='sucesso')a.sucesso++; else if(st==='falha')a.falha++; else a.pendente++;
        if(Number(r.tempo_ms)>0){a.tempoTotal+=Number(r.tempo_ms);a.comTempo++;} return a;
      },{total:0,email:0,whatsapp:0,sucesso:0,falha:0,pendente:0,tempoTotal:0,comTempo:0});
      totais.tempo_medio_ms = totais.comTempo ? Math.round(totais.tempoTotal/totais.comTempo) : 0;
      delete totais.tempoTotal; delete totais.comTempo;
      const [empresas] = await pool.query(`SELECT id, nome_provedor FROM empresa ORDER BY nome_provedor`);
      return res.json({ok:true,periodo_dias:periodo,totais,logs,empresas});
    } catch(err){ console.error('Erro no monitor de relatórios:',err); return res.status(500).json({erro:err.message || 'Erro ao carregar monitor.'}); }
  });

  router.get('/arquivo/:fonte/:id', async (req,res) => {
    try {
      const id=Number(req.params.id); const fonte=String(req.params.fonte);
      if(!id) return res.status(400).json({erro:'ID inválido.'});
      let row, arquivo;
      if(fonte==='novo'){
        const [rows]=await pool.query(`SELECT nome_arquivo,caminho_arquivo FROM relatorios_logs WHERE id=? LIMIT 1`,[id]); row=rows[0]; arquivo=arquivoNovo(row);
      } else if(fonte==='legado'){
        const [rows]=await pool.query(`SELECT * FROM relatorios_envios WHERE id=? LIMIT 1`,[id]); row=rows[0]; arquivo=localizarArquivoLegado(row);
      }
      if(!row || !arquivo) return res.status(404).json({erro:'Arquivo PDF não está mais disponível no servidor.'});
      return res.download(arquivo, path.basename(row.nome_arquivo || arquivo));
    }catch(err){return res.status(500).json({erro:err.message});}
  });

  router.post('/reenviar/:fonte/:id', async (req, res) => {
    const inicio = Date.now();
    const fonte = String(req.params.fonte || '').toLowerCase();
    const id = Number(req.params.id);

    if (!['novo', 'legado'].includes(fonte) || !id) {
      return res.status(400).json({ erro: 'Registro de envio inválido.' });
    }

    try {
      const { row, arquivo } = await obterRegistroParaReenvio(fonte, id);
      if (!row) return res.status(404).json({ erro: 'Envio não encontrado.' });
      if (!arquivo) return res.status(404).json({ erro: 'O PDF deste relatório não está mais disponível no servidor.' });

      const canal = String(row.canal || (row.cliente_telefone ? 'whatsapp' : 'email')).toLowerCase();
      const destino = String(
        canal === 'whatsapp'
          ? (row.destinatario || row.cliente_telefone || row.telefone || '')
          : (row.destinatario || row.cliente_email || row.email || '')
      ).trim();

      if (!destino) return res.status(400).json({ erro: 'O registro não possui destinatário para reenvio.' });

      const nomeArquivo = path.basename(row.nome_arquivo || arquivo || 'relatorio.pdf');
      const tipo = row.tipo_relatorio || row.tipo || 'relatório';

      if (canal === 'whatsapp') {
        const buffer = fs.readFileSync(arquivo);
        const resultado = await enviarMidiaCentral(
          1,
          destino,
          buffer,
          nomeArquivo,
          `📊 Reenvio de ${tipo} - SGOS`
        );
        if (resultado && resultado.ok === false) {
          throw new Error(resultado.detail || resultado.error || 'Falha ao reenviar pelo WhatsApp.');
        }
      } else if (canal === 'email') {
        const { transporter } = criarTransporter();
        const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER;
        await transporter.sendMail({
          from,
          to: destino,
          subject: `Reenvio de ${tipo} - SGOS`,
          html: '<p>Segue novamente em anexo o relatório solicitado pelo SGOS.</p>',
          attachments: [{ filename: nomeArquivo, path: arquivo }]
        });
      } else {
        return res.status(400).json({ erro: `Canal de reenvio não suportado: ${canal || 'não informado'}.` });
      }

      await atualizarResultadoReenvio(fonte, id, { sucesso: true });
      return res.json({
        ok: true,
        mensagem: canal === 'whatsapp'
          ? 'Relatório reenviado pelo WhatsApp com sucesso.'
          : 'Relatório reenviado por e-mail com sucesso.',
        canal,
        destino,
        tempo_ms: Date.now() - inicio
      });
    } catch (err) {
      await atualizarResultadoReenvio(fonte, id, { sucesso: false, erro: err.message });
      console.error('Erro ao reenviar relatório:', err);
      return res.status(500).json({ erro: err.message || 'Erro ao reenviar relatório.', tempo_ms: Date.now() - inicio });
    }
  });

  router.get('/status-email', async (req,res)=>{
    const inicio=Date.now();
    try {
      const {transporter,publicInfo}=criarTransporter();
      await transporter.verify();
      const tempoMs=Date.now()-inicio;
      await salvarTesteConexao({servico:'email',status:'conectado',tempo_ms:tempoMs,mensagem:'SMTP autenticado e disponível.',detalhes:publicInfo,usuario_id:req.usuario?.id});
      return res.json({ok:true,status:'conectado',tempo_ms:tempoMs,configuracao:publicInfo,testado_em:new Date().toISOString()});
    } catch(err) {
      const tempoMs=Date.now()-inicio;
      await salvarTesteConexao({servico:'email',status:'desconectado',tempo_ms:tempoMs,mensagem:err.message,detalhes:{codigo:err.code||'smtp_error'},usuario_id:req.usuario?.id}).catch(()=>{});
      return res.status(503).json({ok:false,status:'desconectado',tempo_ms:tempoMs,codigo:err.code||'smtp_error',erro:err.message,testado_em:new Date().toISOString()});
    }
  });

  router.post('/registrar-status-whatsapp', async (req,res) => {
    try {
      const conectado = req.body?.conectado === true;
      const tempoMs = Math.max(0, Number(req.body?.tempo_ms || 0));
      const mensagem = String(req.body?.mensagem || (conectado ? 'WhatsApp conectado e pronto.' : 'WhatsApp desconectado.')).slice(0,500);
      await salvarTesteConexao({
        servico:'whatsapp',
        status: conectado ? 'conectado' : 'desconectado',
        tempo_ms: tempoMs,
        mensagem,
        detalhes:req.body?.detalhes || null,
        usuario_id:req.usuario?.id
      });
      return res.json({ok:true,testado_em:new Date().toISOString()});
    } catch(err) {
      return res.status(500).json({erro:err.message});
    }
  });

  router.get('/ultimos-testes', async (_req,res) => {
    try {
      await garantirTabelaMonitorConexoes();
      const [rows] = await pool.query(`
        SELECT mc.*
        FROM monitor_conexoes mc
        INNER JOIN (
          SELECT servico, MAX(id) AS id
          FROM monitor_conexoes
          GROUP BY servico
        ) ult ON ult.id = mc.id
        ORDER BY mc.servico
      `);
      const resultado={whatsapp:null,email:null};
      for(const row of rows) resultado[row.servico]=row;
      return res.json({ok:true,ultimos:resultado});
    } catch(err) {
      return res.status(500).json({erro:err.message});
    }
  });

  router.post('/testar-email', async (req,res)=>{const inicio=Date.now();try{const destino=String(req.body?.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino))return res.status(400).json({erro:'Informe um e-mail válido.'});const {transporter}=criarTransporter();const from=process.env.SMTP_FROM||process.env.EMAIL_FROM||process.env.SMTP_USER||process.env.EMAIL_USER;const info=await transporter.sendMail({from,to:destino,subject:'Teste de conexão SGOS',html:'<p>Teste de conexão do monitor administrativo de relatórios do SGOS.</p>'});return res.json({ok:true,mensagem:'E-mail de teste enviado.',message_id:info.messageId,tempo_ms:Date.now()-inicio});}catch(err){return res.status(500).json({erro:err.message,tempo_ms:Date.now()-inicio});}});

  router.get('/exportar.csv', async (req,res)=>{
    req.query.limite='2000';
    return res.status(501).send('Use a exportação da página; ela exporta exatamente os registros filtrados exibidos.');
  });

  return router;
};
