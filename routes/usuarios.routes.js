module.exports = (db, verificarAutenticacao) => {
  const express = require("express");
  const router = express.Router();
  const bcrypt = require("bcryptjs");
  const SALT_ROUNDS = 10;

  function isAdmin(usuario) {
    return String(usuario?.cargo || "").trim().toLowerCase() === "administrador";
  }

  function idsValidos(lista) {
    return [...new Set((Array.isArray(lista) ? lista : [])
      .map(Number)
      .filter(id => Number.isInteger(id) && id > 0))];
  }

  async function validarIdsEmpresa(conn, tabela, ids, empresaId) {
    if (!ids.length) return [];
    const [rows] = await conn.query(
      `SELECT id FROM ${tabela} WHERE empresa_id = ? AND id IN (?)`,
      [empresaId, ids]
    );
    const encontrados = rows.map(r => Number(r.id));
    if (encontrados.length !== ids.length) {
      const set = new Set(encontrados);
      const invalidos = ids.filter(id => !set.has(id));
      const erro = new Error(`Existem vínculos inválidos para esta empresa: ${invalidos.join(", ")}`);
      erro.status = 400;
      throw erro;
    }
    return encontrados;
  }

  async function salvarVinculos(conn, usuarioId, empresaId, localidades, tecnicos) {
    const locIds = idsValidos(localidades);
    const tecIds = idsValidos(tecnicos);

    await validarIdsEmpresa(conn, "localidades", locIds, empresaId);
    await validarIdsEmpresa(conn, "tecnicos", tecIds, empresaId);

    await conn.query(
      "DELETE FROM usuario_localidades WHERE usuario_id = ? AND (empresa_id = ? OR empresa_id IS NULL)",
      [usuarioId, empresaId]
    );
    await conn.query(
      "DELETE FROM usuario_tecnicos WHERE usuario_id = ? AND (empresa_id = ? OR empresa_id IS NULL)",
      [usuarioId, empresaId]
    );

    if (locIds.length) {
      const valores = locIds.map(id => [usuarioId, empresaId, id]);
      await conn.query(
        "INSERT INTO usuario_localidades (usuario_id, empresa_id, localidade_id) VALUES ?",
        [valores]
      );
    }

    if (tecIds.length) {
      const valores = tecIds.map(id => [usuarioId, empresaId, id]);
      await conn.query(
        "INSERT INTO usuario_tecnicos (usuario_id, empresa_id, tecnico_id) VALUES ?",
        [valores]
      );
    }
  }

  router.get("/me", verificarAutenticacao, (req, res) => {
    res.json(req.usuario);
  });

  router.get("/", verificarAutenticacao, async (req, res) => {
    try {
      const { id: userId, empresa_id } = req.usuario;

      let where = "u.empresa_id = ?";
      const params = [empresa_id];

      if (!isAdmin(req.usuario)) {
        where += ` AND (
          u.id = ?
          OR EXISTS (
            SELECT 1 FROM usuario_localidades ul_alvo
            INNER JOIN usuario_localidades ul_logado
              ON ul_logado.localidade_id = ul_alvo.localidade_id
             AND ul_logado.empresa_id = ul_alvo.empresa_id
            WHERE ul_alvo.usuario_id = u.id
              AND ul_alvo.empresa_id = ?
              AND ul_logado.usuario_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM usuario_tecnicos ut_alvo
            INNER JOIN usuario_tecnicos ut_logado
              ON ut_logado.tecnico_id = ut_alvo.tecnico_id
             AND ut_logado.empresa_id = ut_alvo.empresa_id
            WHERE ut_alvo.usuario_id = u.id
              AND ut_alvo.empresa_id = ?
              AND ut_logado.usuario_id = ?
          )
        )`;
        params.push(userId, empresa_id, userId, empresa_id, userId);
      }

      const [usuarios] = await db.query(
        `SELECT
           u.id, u.usuario, u.cargo, u.telefone, u.email, u.ativo,
           COALESCE((
             SELECT JSON_ARRAYAGG(ul.localidade_id)
             FROM usuario_localidades ul
             WHERE ul.usuario_id = u.id AND ul.empresa_id = u.empresa_id
           ), JSON_ARRAY()) AS localidades,
           COALESCE((
             SELECT JSON_ARRAYAGG(ut.tecnico_id)
             FROM usuario_tecnicos ut
             WHERE ut.usuario_id = u.id AND ut.empresa_id = u.empresa_id
           ), JSON_ARRAY()) AS tecnicos
         FROM usuarios u
         WHERE ${where}
         ORDER BY u.usuario`,
        params
      );

      const normalizados = usuarios.map(u => ({
        ...u,
        localidades: typeof u.localidades === "string" ? JSON.parse(u.localidades || "[]") : (u.localidades || []),
        tecnicos: typeof u.tecnicos === "string" ? JSON.parse(u.tecnicos || "[]") : (u.tecnicos || [])
      }));

      res.json(normalizados);
    } catch (err) {
      console.error("ERRO LISTAR USUÁRIOS:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  router.get("/tecnicos", verificarAutenticacao, async (req, res) => {
    try {
      let sql = `SELECT t.id, t.nome, t.ativo
                 FROM tecnicos t
                 WHERE t.empresa_id = ?`;
      const params = [req.usuario.empresa_id];

      if (!isAdmin(req.usuario)) {
        sql += ` AND EXISTS (
          SELECT 1 FROM usuario_tecnicos ut
          WHERE ut.usuario_id = ?
            AND ut.empresa_id = t.empresa_id
            AND ut.tecnico_id = t.id
        )`;
        params.push(req.usuario.id);
      }

      sql += " ORDER BY t.nome";
      const [rows] = await db.query(sql, params);
      res.json(rows);
    } catch (err) {
      console.error("ERRO TÉCNICOS:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  router.get("/localidades", verificarAutenticacao, async (req, res) => {
    try {
      let sql = `SELECT l.id, l.nome, l.vlan
                 FROM localidades l
                 WHERE l.empresa_id = ?`;
      const params = [req.usuario.empresa_id];

      if (!isAdmin(req.usuario)) {
        sql += ` AND EXISTS (
          SELECT 1 FROM usuario_localidades ul
          WHERE ul.usuario_id = ?
            AND ul.empresa_id = l.empresa_id
            AND ul.localidade_id = l.id
        )`;
        params.push(req.usuario.id);
      }

      sql += " ORDER BY l.nome";
      const [rows] = await db.query(sql, params);
      res.json(rows);
    } catch (err) {
      console.error("ERRO LOCALIDADES:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  router.post("/", verificarAutenticacao, async (req, res) => {
    if (!isAdmin(req.usuario)) return res.status(403).json({ erro: "Acesso negado" });

    const { usuario, senha, cargo, telefone, email, localidades = [], tecnicos = [] } = req.body;
    if (!usuario || !senha) return res.status(400).json({ erro: "Usuário e senha obrigatórios" });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const hashSenha = await bcrypt.hash(String(senha), SALT_ROUNDS);

      const [result] = await conn.query(
        `INSERT INTO usuarios
          (usuario, senha, cargo, telefone, email, ativo, empresa_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [String(usuario).trim(), hashSenha, cargo, telefone || null, email || null, req.usuario.empresa_id]
      );

      await salvarVinculos(
        conn,
        result.insertId,
        req.usuario.empresa_id,
        localidades,
        tecnicos
      );

      await conn.commit();
      res.json({ sucesso: true, id: result.insertId });
    } catch (err) {
      await conn.rollback();
      console.error("ERRO CRIAR USUÁRIO:", err);
      res.status(err.status || 500).json({ erro: err.message });
    } finally {
      conn.release();
    }
  });

  router.put("/:id", verificarAutenticacao, async (req, res) => {
    if (!isAdmin(req.usuario)) return res.status(403).json({ erro: "Acesso negado" });

    const id = Number(req.params.id);
    const { usuario, senha, cargo, telefone, email, localidades = [], tecnicos = [] } = req.body;
    if (!id || !usuario) return res.status(400).json({ erro: "Dados do usuário inválidos" });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [existente] = await conn.query(
        "SELECT id FROM usuarios WHERE id = ? AND empresa_id = ? LIMIT 1",
        [id, req.usuario.empresa_id]
      );
      if (!existente.length) {
        const erro = new Error("Usuário não encontrado.");
        erro.status = 404;
        throw erro;
      }

      if (senha && String(senha).trim()) {
        const hashSenha = await bcrypt.hash(String(senha), SALT_ROUNDS);
        await conn.query(
          `UPDATE usuarios
           SET usuario = ?, senha = ?, cargo = ?, telefone = ?, email = ?
           WHERE id = ? AND empresa_id = ?`,
          [String(usuario).trim(), hashSenha, cargo, telefone || null, email || null, id, req.usuario.empresa_id]
        );
      } else {
        await conn.query(
          `UPDATE usuarios
           SET usuario = ?, cargo = ?, telefone = ?, email = ?
           WHERE id = ? AND empresa_id = ?`,
          [String(usuario).trim(), cargo, telefone || null, email || null, id, req.usuario.empresa_id]
        );
      }

      await salvarVinculos(conn, id, req.usuario.empresa_id, localidades, tecnicos);

      await conn.commit();
      res.json({ sucesso: true });
    } catch (err) {
      await conn.rollback();
      console.error("ERRO UPDATE USUÁRIO:", err);
      res.status(err.status || 500).json({ erro: err.message });
    } finally {
      conn.release();
    }
  });

  router.post("/resetar-senha/:id", verificarAutenticacao, async (req, res) => {
    const { senha } = req.body;
    if (!senha) return res.status(400).json({ erro: "Senha obrigatória" });
    if (!isAdmin(req.usuario)) return res.status(403).json({ erro: "Acesso negado" });

    try {
      const hashSenha = await bcrypt.hash(String(senha), SALT_ROUNDS);
      const [resultado] = await db.query(
        "UPDATE usuarios SET senha = ? WHERE id = ? AND empresa_id = ?",
        [hashSenha, req.params.id, req.usuario.empresa_id]
      );
      if (!resultado.affectedRows) return res.status(404).json({ erro: "Usuário não encontrado." });
      res.json({ sucesso: true });
    } catch (err) {
      console.error("ERRO RESET SENHA:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  router.post("/toggle/:id", verificarAutenticacao, async (req, res) => {
    if (!isAdmin(req.usuario)) return res.status(403).json({ erro: "Acesso negado" });

    try {
      const [rows] = await db.query(
        "SELECT ativo FROM usuarios WHERE id = ? AND empresa_id = ? LIMIT 1",
        [req.params.id, req.usuario.empresa_id]
      );
      if (!rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });

      await db.query(
        "UPDATE usuarios SET ativo = ? WHERE id = ? AND empresa_id = ?",
        [rows[0].ativo ? 0 : 1, req.params.id, req.usuario.empresa_id]
      );
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  });

  router.delete("/:id", verificarAutenticacao, async (req, res) => {
    if (!isAdmin(req.usuario)) return res.status(403).json({ erro: "Acesso negado" });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "DELETE FROM usuario_localidades WHERE usuario_id = ? AND (empresa_id = ? OR empresa_id IS NULL)",
        [req.params.id, req.usuario.empresa_id]
      );
      await conn.query(
        "DELETE FROM usuario_tecnicos WHERE usuario_id = ? AND (empresa_id = ? OR empresa_id IS NULL)",
        [req.params.id, req.usuario.empresa_id]
      );
      const [resultado] = await conn.query(
        "DELETE FROM usuarios WHERE id = ? AND empresa_id = ?",
        [req.params.id, req.usuario.empresa_id]
      );
      if (!resultado.affectedRows) {
        const erro = new Error("Usuário não encontrado.");
        erro.status = 404;
        throw erro;
      }
      await conn.commit();
      res.json({ sucesso: true });
    } catch (err) {
      await conn.rollback();
      res.status(err.status || 500).json({ erro: err.message });
    } finally {
      conn.release();
    }
  });

  return router;
};
