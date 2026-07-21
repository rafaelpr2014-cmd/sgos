/*
  Adapte este bloco dentro da rota existente de ordens_servico.
  Ele usa transação, preserva a OS antiga e cria uma nova OS em aberto.
*/
router.post('/:id/reciclar', async (req, res) => {
  const conexao = await pool.getConnection();
  try {
    const usuarioId = Number(req.headers['x-usuario-id']);
    const osId = Number(req.params.id);
    if (!usuarioId || !osId) return res.status(400).json({ erro: 'Dados inválidos.' });

    await conexao.beginTransaction();

    const [[usuario]] = await conexao.query(
      'SELECT id, empresa_id FROM usuarios WHERE id = ? LIMIT 1',
      [usuarioId]
    );
    if (!usuario) throw new Error('Usuário não encontrado.');

    const [[original]] = await conexao.query(
      'SELECT * FROM ordens_servico WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE',
      [osId, usuario.empresa_id]
    );
    if (!original) return res.status(404).json({ erro: 'OS não encontrada.' });

    const raizId = Number(original.os_raiz_id || original.id);
    const [[seq]] = await conexao.query(
      'SELECT COALESCE(MAX(numero_reciclagem), 0) + 1 AS proxima FROM ordens_servico WHERE empresa_id = ? AND os_raiz_id = ?',
      [usuario.empresa_id, raizId]
    );

    const ignorar = new Set([
      'id','os_raiz_id','reciclada_de_id','numero_reciclagem','reciclada_em','reciclada_por',
      'status','criado_em','atualizado_em','iniciado_em','finalizado_em','concluido_em',
      'iniciado_por','finalizado_por','atualizado_por','anexo_path'
    ]);

    const dados = {};
    for (const [campo, valor] of Object.entries(original)) {
      if (!ignorar.has(campo)) dados[campo] = valor;
    }

    Object.assign(dados, {
      empresa_id: usuario.empresa_id,
      os_raiz_id: raizId,
      reciclada_de_id: original.id,
      numero_reciclagem: Number(seq.proxima),
      reciclada_em: new Date(),
      reciclada_por: usuarioId,
      status: 'aberto',
      criado_em: new Date(),
      atualizado_em: new Date(),
      agendamento: null,
      agendamento_envio: null
    });

    const campos = Object.keys(dados);
    const valores = campos.map(c => dados[c]);
    const marcadores = campos.map(() => '?').join(',');
    const [insert] = await conexao.query(
      `INSERT INTO ordens_servico (${campos.map(c => `\`${c}\``).join(',')}) VALUES (${marcadores})`,
      valores
    );

    // Copie tabelas filhas, caso existam, sem movimentar estoque novamente.
    // Exemplo: materiais/equipamentos apenas como referência histórica da nova OS.
    // Ajuste os nomes conforme seu banco.
    try {
      await conexao.query(`
        INSERT INTO ordens_servico_materiais
          (ordem_servico_id, produto_id, quantidade, origem, modalidade, valor_unitario, desconto, valor_total)
        SELECT ?, produto_id, quantidade, origem, modalidade, valor_unitario, desconto, valor_total
        FROM ordens_servico_materiais
        WHERE ordem_servico_id = ?
      `, [insert.insertId, original.id]);
    } catch (e) {
      console.warn('Tabela de materiais não copiada:', e.message);
    }

    await conexao.commit();
    res.status(201).json({
      sucesso: true,
      os_original_id: original.id,
      os_raiz_id: raizId,
      nova_os_id: insert.insertId,
      numero_reciclagem: Number(seq.proxima)
    });
  } catch (erro) {
    await conexao.rollback();
    console.error('Erro ao reciclar OS:', erro);
    res.status(500).json({ erro: erro.message || 'Erro ao reciclar OS.' });
  } finally {
    conexao.release();
  }
});

router.get('/recorrencias', async (req, res) => {
  try {
    const usuarioId = Number(req.headers['x-usuario-id']);
    const [[usuario]] = await pool.query('SELECT empresa_id FROM usuarios WHERE id = ? LIMIT 1', [usuarioId]);
    if (!usuario) return res.status(401).json({ erro: 'Não autorizado.' });

    const periodo = String(req.query.periodo || 'mes_atual');
    let dataSql = '';
    if (periodo === 'mes_atual') dataSql = 'AND o.criado_em >= DATE_FORMAT(CURRENT_DATE, "%Y-%m-01")';
    if (periodo === '30_dias') dataSql = 'AND o.criado_em >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    if (periodo === '90_dias') dataSql = 'AND o.criado_em >= DATE_SUB(NOW(), INTERVAL 90 DAY)';

    const [ordens] = await pool.query(`
      SELECT o.*, l.nome AS localidade_nome, ts.nome AS tipo_servico_nome,
             ur.nome AS reciclada_por_nome
      FROM ordens_servico o
      LEFT JOIN localidades l ON l.id = o.localidade
      LEFT JOIN tipos_servico ts ON ts.id = o.tipo_servico
      LEFT JOIN usuarios ur ON ur.id = o.reciclada_por
      WHERE o.empresa_id = ? ${dataSql}
      ORDER BY COALESCE(o.os_raiz_id, o.id), o.numero_reciclagem, o.criado_em
    `, [usuario.empresa_id]);

    res.json(ordens);
  } catch (erro) {
    console.error('Erro ao listar recorrências:', erro);
    res.status(500).json({ erro: 'Erro ao listar recorrências.' });
  }
});
