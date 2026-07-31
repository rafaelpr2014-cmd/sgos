async function iniciarLog(pool, dados = {}) {
  const [resultado] = await pool.query(`
    INSERT INTO relatorios_logs
      (empresa_id, usuario_id, tipo_relatorio, origem, canal, destinatario,
       assunto, nome_arquivo, caminho_arquivo, status, tentativa, iniciado_em, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processando', ?, NOW(), NOW())
  `, [
    Number(dados.empresa_id || 0),
    dados.usuario_id ? Number(dados.usuario_id) : null,
    String(dados.tipo_relatorio || 'manual').slice(0, 30),
    ['manual','automatico','teste','legado'].includes(dados.origem) ? dados.origem : 'manual',
    dados.canal === 'whatsapp' ? 'whatsapp' : 'email',
    dados.destinatario ? String(dados.destinatario).slice(0, 255) : null,
    dados.assunto ? String(dados.assunto).slice(0, 255) : null,
    dados.nome_arquivo ? String(dados.nome_arquivo).slice(0, 255) : null,
    dados.caminho_arquivo ? String(dados.caminho_arquivo).slice(0, 500) : null,
    Math.max(1, Number(dados.tentativa || 1))
  ]);
  return { id: resultado.insertId, inicio: Date.now() };
}

async function finalizarLog(pool, controle, sucesso, dados = {}) {
  if (!controle?.id) return;
  const tempoMs = Math.max(0, Date.now() - Number(controle.inicio || Date.now()));
  await pool.query(`
    UPDATE relatorios_logs
       SET status = ?, tempo_ms = ?, resposta_provedor = ?, codigo_erro = ?,
           mensagem_erro = ?, detalhes = ?, finalizado_em = NOW()
     WHERE id = ?
  `, [
    sucesso ? 'sucesso' : 'falha',
    tempoMs,
    dados.resposta ? String(dados.resposta).slice(0, 65000) : null,
    dados.codigo ? String(dados.codigo).slice(0, 100) : null,
    dados.erro ? String(dados.erro).slice(0, 65000) : null,
    dados.detalhes ? JSON.stringify(dados.detalhes).slice(0, 65000) : null,
    controle.id
  ]);
}

module.exports = { iniciarLog, finalizarLog };
