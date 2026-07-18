const express = require('express');
const router = express.Router();
const pool = require('../database');

function normalizarCargo(valor) {
  return String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getEmpresaId(req) { return Number(req.usuario?.empresa_id || req.user?.empresa_id || req.session?.user?.empresa_id || req.session?.usuario?.empresa_id || 0); }
function getUsuarioId(req) { return Number(req.usuario?.id || req.user?.id || req.session?.user?.id || req.session?.usuario?.id || req.headers['x-usuario-id'] || 0); }
function getUsuarioNome(req) { return String(req.usuario?.usuario || req.user?.usuario || req.session?.user?.usuario || req.session?.usuario?.usuario || 'Sistema'); }
function getCargo(req) { return normalizarCargo(req.usuario?.cargo || req.user?.cargo || req.session?.user?.cargo || req.session?.usuario?.cargo || ''); }
function inteiroNaoNegativo(valor, padrao = 0) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) return padrao;
  return n;
}
function inteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
function normalizarIds(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return [...new Set(lista.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 3);
}

async function carregarUsuarioEstoque(req, res, next) {
  try {
    if (req.usuario?.id && req.usuario?.empresa_id) return next();
    const usuarioId = getUsuarioId(req);
    if (!usuarioId) return res.status(401).json({ erro: 'Usuário não autenticado.' });
    const [rows] = await pool.query('SELECT id, usuario, cargo, empresa_id, ativo FROM usuarios WHERE id = ? LIMIT 1', [usuarioId]);
    const usuario = rows?.[0];
    if (!usuario || Number(usuario.ativo) === 0) return res.status(401).json({ erro: 'Usuário inválido ou inativo.' });
    req.usuario = usuario;
    next();
  } catch (error) {
    console.error('Erro ao identificar usuário do estoque:', error);
    res.status(500).json({ erro: 'Erro ao validar usuário.' });
  }
}
function somenteAdmin(req, res, next) {
  if (!['administrador', 'admin'].includes(getCargo(req))) return res.status(403).json({ erro: 'Acesso permitido apenas para administradores.' });
  next();
}
router.use(carregarUsuarioEstoque);

async function registrarLog(conn, req, acao, produto, detalhes = {}) {
  await conn.query(
    `INSERT INTO estoque_logs
      (empresa_id, produto_id, produto_nome, acao, usuario_id, usuario_nome, dados_anteriores, dados_novos, descricao, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [getEmpresaId(req), produto?.id || null, produto?.nome || null, acao, getUsuarioId(req), getUsuarioNome(req),
     detalhes.antes ? JSON.stringify(detalhes.antes) : null, detalhes.depois ? JSON.stringify(detalhes.depois) : null,
     detalhes.descricao || null]
  );
}

async function criarLembretesEstoqueBaixo(conn, empresaId, produto) {
  if (Number(produto.quantidade) > Number(produto.estoque_minimo)) return;
  const titulo = `Estoque baixo: ${produto.nome}`;
  const mensagem = `${produto.nome} está com ${produto.quantidade} unidade(s). Estoque mínimo: ${produto.estoque_minimo}.`;
  const [admins] = await conn.query("SELECT id FROM usuarios WHERE empresa_id = ? AND LOWER(cargo) IN ('administrador','admin') AND ativo = 1", [empresaId]);
  for (const admin of admins) {
    const [existente] = await conn.query(
      `SELECT id FROM lembretes WHERE empresa_id = ? AND destinatario_id = ? AND origem = 'estoque' AND referencia_id = ? AND lido = 0 AND criado_em >= DATE_SUB(NOW(), INTERVAL 12 HOUR) LIMIT 1`,
      [empresaId, admin.id, produto.id]
    ).catch(() => [[]]);
    if (existente.length) continue;
    await conn.query(
      `INSERT INTO lembretes (empresa_id, titulo, mensagem, destinatario_id, remetente_id, origem, referencia_id, lido, criado_em)
       VALUES (?, ?, ?, ?, NULL, 'estoque', ?, 0, NOW())`,
      [empresaId, titulo, mensagem, admin.id, produto.id]
    ).catch(() => null);
  }
}

router.get('/resumo', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const [[resumo]] = await pool.query(
      `SELECT COUNT(*) total_produtos, COALESCE(SUM(quantidade),0) total_unidades,
              SUM(CASE WHEN quantidade <= estoque_minimo THEN 1 ELSE 0 END) estoque_baixo,
              SUM(CASE WHEN quantidade = 0 THEN 1 ELSE 0 END) sem_estoque
       FROM estoque_produtos WHERE empresa_id = ? AND ativo = 1`, [empresaId]);
    const [alertas] = await pool.query(
      `SELECT p.id,p.nome,p.quantidade,p.estoque_minimo,p.unidade_medida,p.escritorio_id,e.nome escritorio_nome FROM estoque_produtos p LEFT JOIN escritorios e ON e.id=p.escritorio_id AND e.empresa_id=p.empresa_id
       WHERE p.empresa_id=? AND p.ativo=1 AND p.quantidade<=p.estoque_minimo ORDER BY p.quantidade,p.nome`, [empresaId]);
    res.json({ resumo, alertas });
  } catch (error) { console.error('Erro resumo estoque:', error); res.status(500).json({ erro: 'Erro ao carregar resumo do estoque.' }); }
});

router.get('/produtos', somenteAdmin, async (req, res) => {
  try {
    const empresaId = getEmpresaId(req), termo = String(req.query.busca || '').trim(), escritorioId = Number(req.query.escritorio_id || 0);
    const filtros = ['p.empresa_id=?','p.ativo=1'], params=[empresaId];
    if (termo) { filtros.push('(p.nome LIKE ? OR p.codigo LIKE ? OR p.categoria LIKE ? OR e.nome LIKE ?)'); const like=`%${termo}%`; params.push(like,like,like,like); }
    if (escritorioId) { filtros.push('p.escritorio_id=?'); params.push(escritorioId); }
    if (String(req.query.estoque_baixo || '') === '1') filtros.push('p.quantidade<=p.estoque_minimo');
    const [produtos] = await pool.query(
      `SELECT p.*,e.nome escritorio_nome,u.usuario cadastrado_por_nome,
       CASE WHEN p.quantidade=0 THEN 'sem_estoque' WHEN p.quantidade<=p.estoque_minimo THEN 'baixo' ELSE 'normal' END nivel_estoque
       FROM estoque_produtos p LEFT JOIN escritorios e ON e.id=p.escritorio_id AND e.empresa_id=p.empresa_id LEFT JOIN usuarios u ON u.id=p.cadastrado_por
       WHERE ${filtros.join(' AND ')} ORDER BY p.nome`, params);
    res.json(produtos);
  } catch (error) { console.error('Erro listar produtos:', error); res.status(500).json({ erro: 'Erro ao listar produtos.' }); }
});

router.post('/produtos', somenteAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const empresaId=getEmpresaId(req), usuarioId=getUsuarioId(req);
    const { nome,codigo,categoria,unidade_medida='unidade',observacao='' }=req.body||{}; const escritorioId=Number(req.body?.escritorio_id||0);
    if (!String(nome||'').trim()) return res.status(400).json({ erro:'Informe o nome do produto.' });
    if (!escritorioId) return res.status(400).json({ erro:'Informe o escritório.' });
    const [[escritorio]]=await conn.query('SELECT id,nome FROM escritorios WHERE id=? AND empresa_id=? AND ativo=1',[escritorioId,empresaId]);
    if(!escritorio) return res.status(400).json({erro:'Escritório inválido.'});
    const quantidade=inteiroNaoNegativo(req.body?.quantidade_inicial,0), minimo=inteiroNaoNegativo(req.body?.estoque_minimo,5);
    if (Number(req.body?.quantidade_inicial) !== quantidade || Number(req.body?.estoque_minimo) !== minimo) return res.status(400).json({ erro:'Quantidade e estoque mínimo devem ser números inteiros.' });
    await conn.beginTransaction();
    const [result]=await conn.query(
      `INSERT INTO estoque_produtos (empresa_id,escritorio_id,nome,codigo,categoria,unidade_medida,localidade,quantidade,estoque_minimo,observacao,cadastrado_por,ativo,criado_em,atualizado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,NOW(),NOW())`,
      [empresaId,escritorioId,String(nome).trim(),String(codigo||'').trim()||null,String(categoria||'').trim()||null,String(unidade_medida).trim(),escritorio.nome,quantidade,minimo,String(observacao||'').trim()||null,usuarioId]);
    const produto={id:result.insertId,nome:String(nome).trim(),quantidade,estoque_minimo:minimo};
    await registrarLog(conn,req,'produto_adicionado',produto,{depois:{nome,codigo,categoria,unidade_medida,escritorio_id:escritorioId,escritorio_nome:escritorio.nome,quantidade,estoque_minimo:minimo,observacao},descricao:'Produto adicionado ao estoque.'});
    if (quantidade>0) await conn.query(
      `INSERT INTO estoque_movimentacoes (empresa_id,escritorio_id,produto_id,tipo,quantidade,quantidade_anterior,quantidade_atual,motivo,usuario_id,usuario_nome,origem,criado_em)
       VALUES (?,?,?,'entrada',?,0,?,'Estoque inicial',?,?,'manual',NOW())`, [empresaId,escritorioId,result.insertId,quantidade,quantidade,usuarioId,getUsuarioNome(req)]);
    await criarLembretesEstoqueBaixo(conn,empresaId,produto); await conn.commit();
    res.status(201).json({sucesso:true,id:result.insertId});
  } catch(error){await conn.rollback();console.error('Erro cadastrar produto:',error);res.status(500).json({erro:error.code==='ER_DUP_ENTRY'?'Já existe produto com esse código.':'Erro ao cadastrar produto.'});} finally{conn.release();}
});

router.put('/produtos/:id', somenteAdmin, async (req,res)=>{
  const conn=await pool.getConnection();
  try{
    const empresaId=getEmpresaId(req), id=Number(req.params.id), {nome,codigo,categoria,unidade_medida,observacao}=req.body||{}, escritorioId=Number(req.body?.escritorio_id||0);
    if(!String(nome||'').trim()||!escritorioId) return res.status(400).json({erro:'Informe nome e escritório.'});
    const minimo=inteiroNaoNegativo(req.body?.estoque_minimo,0);
    if(Number(req.body?.estoque_minimo)!==minimo) return res.status(400).json({erro:'O estoque mínimo deve ser um número inteiro.'});
    await conn.beginTransaction();
    const [rows]=await conn.query('SELECT * FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1 FOR UPDATE',[id,empresaId]);
    if(!rows.length){await conn.rollback();return res.status(404).json({erro:'Produto não encontrado.'});}
    const antes=rows[0];
    const [[escritorio]]=await conn.query('SELECT id,nome FROM escritorios WHERE id=? AND empresa_id=? AND ativo=1',[escritorioId,empresaId]); if(!escritorio){await conn.rollback();return res.status(400).json({erro:'Escritório inválido.'});}
    const depois={nome:String(nome).trim(),codigo:String(codigo||'').trim()||null,categoria:String(categoria||'').trim()||null,unidade_medida:String(unidade_medida||'unidade').trim(),escritorio_id:escritorioId,escritorio_nome:escritorio.nome,localidade:escritorio.nome,estoque_minimo:minimo,observacao:String(observacao||'').trim()||null};
    await conn.query(`UPDATE estoque_produtos SET nome=?,codigo=?,categoria=?,unidade_medida=?,escritorio_id=?,localidade=?,estoque_minimo=?,observacao=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?`,[depois.nome,depois.codigo,depois.categoria,depois.unidade_medida,depois.escritorio_id,depois.localidade,depois.estoque_minimo,depois.observacao,id,empresaId]);
    await registrarLog(conn,req,'produto_editado',{id,nome:depois.nome},{antes,depois,descricao:'Cadastro do produto alterado.'});
    await conn.commit(); res.json({sucesso:true});
  }catch(error){await conn.rollback();console.error('Erro editar produto:',error);res.status(500).json({erro:'Erro ao editar produto.'});}finally{conn.release();}
});

router.delete('/produtos/:id', somenteAdmin, async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    const empresaId=getEmpresaId(req),id=Number(req.params.id); await conn.beginTransaction();
    const [rows]=await conn.query('SELECT * FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1 FOR UPDATE',[id,empresaId]);
    if(!rows.length){await conn.rollback();return res.status(404).json({erro:'Produto não encontrado.'});}
    await conn.query('UPDATE estoque_produtos SET ativo=0,atualizado_em=NOW() WHERE id=? AND empresa_id=?',[id,empresaId]);
    await registrarLog(conn,req,'produto_excluido',{id,nome:rows[0].nome},{antes:rows[0],descricao:'Produto removido da lista ativa; histórico preservado.'});
    await conn.commit();res.json({sucesso:true});
  }catch(error){await conn.rollback();console.error('Erro remover produto:',error);res.status(500).json({erro:'Erro ao remover produto.'});}finally{conn.release();}
});

async function salvarTecnicos(conn,movimentacaoId,empresaId,ids){
  await conn.query('DELETE FROM estoque_movimentacao_tecnicos WHERE movimentacao_id=?',[movimentacaoId]);
  if(!ids.length)return;
  const [validos]=await conn.query('SELECT id,nome FROM tecnicos WHERE empresa_id=? AND id IN (?)',[empresaId,ids]);
  for(const t of validos) await conn.query('INSERT INTO estoque_movimentacao_tecnicos (movimentacao_id,tecnico_id,tecnico_nome) VALUES (?,?,?)',[movimentacaoId,t.id,t.nome]);
}

async function recalcularHistoricoProduto(conn, produtoId, empresaId) {
  const [movs] = await conn.query(
    'SELECT id,tipo,quantidade FROM estoque_movimentacoes WHERE produto_id=? AND empresa_id=? ORDER BY criado_em ASC,id ASC FOR UPDATE',
    [produtoId, empresaId]
  );
  let saldo = 0;
  for (const mov of movs) {
    const anterior = saldo;
    if (mov.tipo === 'entrada') saldo += Number(mov.quantidade);
    else if (mov.tipo === 'saida') saldo -= Number(mov.quantidade);
    else saldo = Number(mov.quantidade);
    if (saldo < 0) throw Object.assign(new Error('A alteração deixaria o estoque negativo em uma movimentação posterior.'), { statusCode: 400 });
    await conn.query('UPDATE estoque_movimentacoes SET quantidade_anterior=?,quantidade_atual=? WHERE id=?', [anterior, saldo, mov.id]);
  }
  await conn.query('UPDATE estoque_produtos SET quantidade=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?', [saldo, produtoId, empresaId]);
  return saldo;
}

router.post('/movimentacoes', somenteAdmin, async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    const empresaId=getEmpresaId(req),usuarioId=getUsuarioId(req),produtoId=Number(req.body?.produto_id),movimento=String(req.body?.tipo||'').toLowerCase(),qtd=inteiroPositivo(req.body?.quantidade),tecnicos=normalizarIds(req.body?.tecnicos_ids);
    if(!['entrada','saida','ajuste'].includes(movimento))return res.status(400).json({erro:'Tipo inválido.'});
    if(!produtoId||!qtd)return res.status(400).json({erro:'A quantidade deve ser um número inteiro maior que zero.'});
    if(movimento==='saida'&&!tecnicos.length)return res.status(400).json({erro:'Selecione ao menos um técnico.'});
    await conn.beginTransaction(); const [rows]=await conn.query('SELECT * FROM estoque_produtos WHERE id=? AND empresa_id=? AND ativo=1 FOR UPDATE',[produtoId,empresaId]);
    if(!rows.length){await conn.rollback();return res.status(404).json({erro:'Produto não encontrado.'});}
    const p=rows[0],anterior=Number(p.quantidade);let atual=movimento==='entrada'?anterior+qtd:movimento==='saida'?anterior-qtd:qtd;
    if(atual<0){await conn.rollback();return res.status(400).json({erro:`Estoque insuficiente. Disponível: ${anterior}.`});}
    await conn.query('UPDATE estoque_produtos SET quantidade=?,atualizado_em=NOW() WHERE id=? AND empresa_id=?',[atual,produtoId,empresaId]);
    const [mov]=await conn.query(`INSERT INTO estoque_movimentacoes (empresa_id,escritorio_id,produto_id,tipo,quantidade,quantidade_anterior,quantidade_atual,motivo,observacao,usuario_id,usuario_nome,origem,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',NOW())`,[empresaId,p.escritorio_id,produtoId,movimento,qtd,anterior,atual,String(req.body?.motivo||'').trim()||'Movimentação de estoque',String(req.body?.observacao||'').trim()||null,usuarioId,getUsuarioNome(req)]);
    await salvarTecnicos(conn,mov.insertId,empresaId,tecnicos);
    await registrarLog(conn,req,`movimentacao_${movimento}`,{id:produtoId,nome:p.nome},{depois:{movimentacao_id:mov.insertId,tipo:movimento,quantidade:qtd,anterior,atual},descricao:`${movimento} de ${qtd} unidade(s).`});
    await criarLembretesEstoqueBaixo(conn,empresaId,{id:p.id,nome:p.nome,quantidade:atual,estoque_minimo:p.estoque_minimo});
    await conn.commit();res.json({sucesso:true,id:mov.insertId,quantidade_atual:atual});
  }catch(error){await conn.rollback();console.error('Erro movimentar estoque:',error);res.status(500).json({erro:'Erro ao registrar movimentação.'});}finally{conn.release();}
});

router.put('/movimentacoes/:id', somenteAdmin, async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    const empresaId=getEmpresaId(req),id=Number(req.params.id),novoTipo=String(req.body?.tipo||'').toLowerCase(),novaQtd=inteiroPositivo(req.body?.quantidade),tecnicos=normalizarIds(req.body?.tecnicos_ids);
    if(!['entrada','saida','ajuste'].includes(novoTipo)||!novaQtd)return res.status(400).json({erro:'Tipo ou quantidade inválidos. Use números inteiros.'});
    if(novoTipo==='saida'&&!tecnicos.length)return res.status(400).json({erro:'Selecione ao menos um técnico.'});
    await conn.beginTransaction();
    const [movs]=await conn.query('SELECT * FROM estoque_movimentacoes WHERE id=? AND empresa_id=? FOR UPDATE',[id,empresaId]);
    if(!movs.length){await conn.rollback();return res.status(404).json({erro:'Movimentação não encontrada.'});}
    const antiga=movs[0];
    const [ps]=await conn.query('SELECT * FROM estoque_produtos WHERE id=? AND empresa_id=? FOR UPDATE',[antiga.produto_id,empresaId]);
    if(!ps.length){await conn.rollback();return res.status(404).json({erro:'Produto não encontrado.'});}
    const p=ps[0];
    await conn.query(`UPDATE estoque_movimentacoes SET tipo=?,quantidade=?,motivo=?,observacao=?,usuario_id=?,usuario_nome=? WHERE id=? AND empresa_id=?`,[novoTipo,novaQtd,String(req.body?.motivo||'').trim()||'Movimentação editada',String(req.body?.observacao||'').trim()||null,getUsuarioId(req),getUsuarioNome(req),id,empresaId]);
    await salvarTecnicos(conn,id,empresaId,tecnicos);
    const novoSaldo=await recalcularHistoricoProduto(conn,p.id,empresaId);
    const [atualizada]=await conn.query('SELECT * FROM estoque_movimentacoes WHERE id=?',[id]);
    await registrarLog(conn,req,'movimentacao_editada',{id:p.id,nome:p.nome},{antes:antiga,depois:atualizada[0],descricao:`Movimentação #${id} editada; histórico e saldo recalculados.`});
    await conn.commit();res.json({sucesso:true,quantidade_atual:novoSaldo});
  }catch(error){await conn.rollback();console.error('Erro editar movimentação:',error);res.status(error.statusCode||500).json({erro:error.statusCode?error.message:'Erro ao editar movimentação.'});}finally{conn.release();}
});

router.delete('/movimentacoes/:id', somenteAdmin, async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    const empresaId=getEmpresaId(req),id=Number(req.params.id);await conn.beginTransaction();
    const [movs]=await conn.query('SELECT * FROM estoque_movimentacoes WHERE id=? AND empresa_id=? FOR UPDATE',[id,empresaId]);
    if(!movs.length){await conn.rollback();return res.status(404).json({erro:'Movimentação não encontrada.'});}
    const mov=movs[0];const [ps]=await conn.query('SELECT * FROM estoque_produtos WHERE id=? AND empresa_id=? FOR UPDATE',[mov.produto_id,empresaId]);
    if(!ps.length){await conn.rollback();return res.status(404).json({erro:'Produto não encontrado.'});}
    const p=ps[0];
    await conn.query('DELETE FROM estoque_movimentacoes WHERE id=? AND empresa_id=?',[id,empresaId]);
    const revertido=await recalcularHistoricoProduto(conn,p.id,empresaId);
    await registrarLog(conn,req,'movimentacao_excluida',{id:p.id,nome:p.nome},{antes:mov,depois:{saldo_recalculado:revertido},descricao:`Movimentação #${id} excluída; histórico e saldo recalculados.`});
    await conn.commit();res.json({sucesso:true,quantidade_atual:revertido});
  }catch(error){await conn.rollback();console.error('Erro excluir movimentação:',error);res.status(error.statusCode||500).json({erro:error.statusCode?error.message:'Erro ao excluir movimentação.'});}finally{conn.release();}
});

router.get('/movimentacoes', somenteAdmin, async(req,res)=>{
  try{
    const empresaId=getEmpresaId(req),{tipo,produto_id,escritorio_id,data_inicio,data_fim,usuario,tecnico_id}=req.query,f=['m.empresa_id=?'],p=[empresaId];
    if(tipo&&['entrada','saida','ajuste'].includes(tipo)){f.push('m.tipo=?');p.push(tipo);} if(escritorio_id){f.push('p.escritorio_id=?');p.push(Number(escritorio_id));} if(produto_id){f.push('m.produto_id=?');p.push(Number(produto_id));}
    if(data_inicio){f.push('DATE(m.criado_em)>=?');p.push(data_inicio);} if(data_fim){f.push('DATE(m.criado_em)<=?');p.push(data_fim);}
    if(usuario){f.push('m.usuario_nome LIKE ?');p.push(`%${usuario}%`);} if(tecnico_id){f.push('EXISTS(SELECT 1 FROM estoque_movimentacao_tecnicos x WHERE x.movimentacao_id=m.id AND x.tecnico_id=?)');p.push(Number(tecnico_id));}
    const [rows]=await pool.query(`SELECT m.*,p.nome produto_nome,p.codigo produto_codigo,p.escritorio_id,e.nome escritorio_nome,GROUP_CONCAT(mt.tecnico_nome ORDER BY mt.tecnico_nome SEPARATOR ', ') tecnicos_nomes FROM estoque_movimentacoes m JOIN estoque_produtos p ON p.id=m.produto_id LEFT JOIN escritorios e ON e.id=p.escritorio_id AND e.empresa_id=p.empresa_id LEFT JOIN estoque_movimentacao_tecnicos mt ON mt.movimentacao_id=m.id WHERE ${f.join(' AND ')} GROUP BY m.id ORDER BY m.criado_em DESC LIMIT 2000`,p);res.json(rows);
  }catch(error){console.error('Erro histórico:',error);res.status(500).json({erro:'Erro ao carregar histórico.'});}
});

router.get('/logs', somenteAdmin, async(req,res)=>{
  try{
    const empresaId=getEmpresaId(req),{acao,produto_id,data_inicio,data_fim}=req.query,f=['l.empresa_id=?'],p=[empresaId];
    if(acao){f.push('l.acao=?');p.push(acao);} if(produto_id){f.push('l.produto_id=?');p.push(Number(produto_id));}
    if(data_inicio){f.push('DATE(l.criado_em)>=?');p.push(data_inicio);} if(data_fim){f.push('DATE(l.criado_em)<=?');p.push(data_fim);}
    const [rows]=await pool.query(`SELECT l.* FROM estoque_logs l WHERE ${f.join(' AND ')} ORDER BY l.criado_em DESC LIMIT 3000`,p);res.json(rows);
  }catch(error){console.error('Erro logs estoque:',error);res.status(500).json({erro:'Erro ao carregar logs do estoque.'});}
});

module.exports=router;
