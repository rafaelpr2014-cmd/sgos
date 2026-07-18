'use strict';

module.exports = function criarEscritoriosService(pool) {
  const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max);

  async function listar(empresaId, usuarioId, admin) {
    const filtros = ['e.empresa_id = ?'];
    const params = [empresaId];
    if (!admin) {
      filtros.push('EXISTS (SELECT 1 FROM escritorio_usuarios eu WHERE eu.empresa_id=e.empresa_id AND eu.escritorio_id=e.id AND eu.usuario_id=?)');
      params.push(usuarioId);
    }
    const [rows] = await pool.query(
      `SELECT e.*,
              COUNT(DISTINCT eu.usuario_id) AS total_responsaveis,
              GROUP_CONCAT(DISTINCT u.usuario ORDER BY u.usuario SEPARATOR ', ') AS responsaveis_nomes
         FROM escritorios e
         LEFT JOIN escritorio_usuarios eu ON eu.escritorio_id=e.id AND eu.empresa_id=e.empresa_id
         LEFT JOIN usuarios u ON u.id=eu.usuario_id AND u.empresa_id=e.empresa_id
        WHERE ${filtros.join(' AND ')}
        GROUP BY e.id
        ORDER BY e.ativo DESC, e.nome ASC`, params);
    return rows;
  }

  async function usuariosDisponiveis(empresaId) {
    const [rows] = await pool.query(
      `SELECT id, usuario, cargo, ativo
         FROM usuarios
        WHERE empresa_id = ? AND ativo = 1
        ORDER BY usuario ASC`, [empresaId]);
    return rows;
  }

  async function obter(empresaId, id) {
    const [[escritorio]] = await pool.query(
      `SELECT * FROM escritorios WHERE id=? AND empresa_id=? LIMIT 1`, [id, empresaId]);
    if (!escritorio) return null;
    const [responsaveis] = await pool.query(
      `SELECT eu.usuario_id, u.usuario, u.cargo
         FROM escritorio_usuarios eu
         JOIN usuarios u ON u.id=eu.usuario_id AND u.empresa_id=eu.empresa_id
        WHERE eu.empresa_id=? AND eu.escritorio_id=?
        ORDER BY u.usuario`, [empresaId, id]);
    return { ...escritorio, responsaveis };
  }

  async function salvar({ empresaId, usuarioId, usuarioNome, id, nome, descricao, ativo, responsaveis }) {
    nome = texto(nome, 150);
    descricao = texto(descricao, 500) || null;
    if (!nome) throw Object.assign(new Error('Informe o nome do escritório.'), { statusCode: 400 });
    const ids = [...new Set((Array.isArray(responsaveis) ? responsaveis : []).map(Number).filter(Number.isInteger))];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (ids.length) {
        const [validos] = await conn.query(`SELECT id FROM usuarios WHERE empresa_id=? AND ativo=1 AND id IN (?)`, [empresaId, ids]);
        if (validos.length !== ids.length) throw Object.assign(new Error('Um ou mais usuários selecionados são inválidos.'), { statusCode: 400 });
      }
      let escritorioId = Number(id) || 0;
      if (escritorioId) {
        const [r] = await conn.query(
          `UPDATE escritorios SET nome=?, descricao=?, ativo=?, atualizado_em=NOW() WHERE id=? AND empresa_id=?`,
          [nome, descricao, ativo ? 1 : 0, escritorioId, empresaId]);
        if (!r.affectedRows) throw Object.assign(new Error('Escritório não encontrado.'), { statusCode: 404 });
      } else {
        const [r] = await conn.query(
          `INSERT INTO escritorios (empresa_id,nome,descricao,ativo,cadastrado_por,cadastrado_por_nome,criado_em)
           VALUES (?,?,?,?,?,?,NOW())`, [empresaId, nome, descricao, ativo ? 1 : 0, usuarioId, usuarioNome]);
        escritorioId = r.insertId;
      }
      await conn.query(`DELETE FROM escritorio_usuarios WHERE empresa_id=? AND escritorio_id=?`, [empresaId, escritorioId]);
      for (const responsavelId of ids) {
        await conn.query(
          `INSERT INTO escritorio_usuarios (empresa_id,escritorio_id,usuario_id,cadastrado_por,criado_em)
           VALUES (?,?,?,?,NOW())`, [empresaId, escritorioId, responsavelId, usuarioId]);
      }
      await conn.commit();
      return { sucesso: true, id: escritorioId };
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Já existe um escritório com esse nome.'), { statusCode: 409 });
      throw e;
    } finally { conn.release(); }
  }

  async function excluir(empresaId, id) {
    const [[uso]] = await pool.query(
      `SELECT COUNT(*) total FROM financeiro_movimentacoes WHERE empresa_id=? AND escritorio_id=?`, [empresaId, id]);
    if (Number(uso.total) > 0) {
      await pool.query(`UPDATE escritorios SET ativo=0, atualizado_em=NOW() WHERE empresa_id=? AND id=?`, [empresaId, id]);
      return { sucesso: true, inativado: true };
    }
    const [r] = await pool.query(`DELETE FROM escritorios WHERE empresa_id=? AND id=?`, [empresaId, id]);
    if (!r.affectedRows) throw Object.assign(new Error('Escritório não encontrado.'), { statusCode: 404 });
    return { sucesso: true, inativado: false };
  }

  return { listar, usuariosDisponiveis, obter, salvar, excluir };
};
