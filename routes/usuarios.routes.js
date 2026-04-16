module.exports = (db, verificarAutenticacao) => {
  const express = require("express");
  const router = express.Router();
  const bcrypt = require("bcryptjs");
  const SALT_ROUNDS = 10;

  // ===============================
  // 🔹 USUÁRIO LOGADO
  // ===============================
  router.get("/me", verificarAutenticacao, (req, res) => {
    res.json(req.usuario);
  });

  // ===============================
  // 🔹 LISTAR USUÁRIOS
  // ===============================
  router.get("/", verificarAutenticacao, async (req, res) => {
    try {
      const { id: userId, cargo, empresa_id } = req.usuario;

      let query = `SELECT id, usuario, cargo, telefone, email, ativo 
                   FROM usuarios WHERE empresa_id = ?`;
      let params = [empresa_id];

      // 🔹 Se não for administrador, aplica filtros por localidades e técnicos
      if (cargo.toLowerCase() !== "administrador") {
        const [locs] = await db.query(
          "SELECT localidade_id FROM usuario_localidades WHERE usuario_id=?",
          [userId]
        );
        const [tecs] = await db.query(
          "SELECT tecnico_id FROM usuario_tecnicos WHERE usuario_id=?",
          [userId]
        );

        const locIds = locs.map(l => l.localidade_id);
        const tecIds = tecs.map(t => t.tecnico_id);

        if (locIds.length || tecIds.length) {
          query += `
            AND (id IN (SELECT usuario_id FROM usuario_localidades WHERE localidade_id IN (?))
                 OR id IN (SELECT usuario_id FROM usuario_tecnicos WHERE tecnico_id IN (?)))`;
          params.push(locIds.length ? locIds : [0]);
          params.push(tecIds.length ? tecIds : [0]);
        } else {
          return res.json([]); // nenhum acesso permitido
        }
      }

      query += " ORDER BY usuario";
      const [usuarios] = await db.query(query, params);
      res.json(usuarios);

    } catch (err) {
      console.error("ERRO LISTAR USUÁRIOS:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 LISTAR TÉCNICOS
  // ===============================
  router.get("/tecnicos", verificarAutenticacao, async (req, res) => {
    try {
      const { cargo, id: userId, empresa_id } = req.usuario;
      let query = "SELECT id, usuario AS nome, cargo FROM tecnicos WHERE empresa_id=?";
      let params = [empresa_id];

      if (cargo.toLowerCase() !== "administrador") {
        const [tecs] = await db.query(
          "SELECT tecnico_id FROM usuario_tecnicos WHERE usuario_id=?",
          [userId]
        );
        const tecIds = tecs.map(t => t.tecnico_id);
        if (tecIds.length) {
          query += " AND id IN (?)";
          params.push(tecIds);
        } else return res.json([]);
      }

      query += " ORDER BY usuario";
      const [rows] = await db.query(query, params);
      res.json(rows);

    } catch (err) {
      console.error("ERRO TECNICOS:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 LISTAR LOCALIDADES
  // ===============================
  router.get("/localidades", verificarAutenticacao, async (req, res) => {
    try {
      const { cargo, id: userId, empresa_id } = req.usuario;
      let query = "SELECT id, nome FROM localidades WHERE empresa_id=?";
      let params = [empresa_id];

      if (cargo.toLowerCase() !== "administrador") {
        const [locs] = await db.query(
          "SELECT localidade_id FROM usuario_localidades WHERE usuario_id=?",
          [userId]
        );
        const locIds = locs.map(l => l.localidade_id);
        if (locIds.length) {
          query += " AND id IN (?)";
          params.push(locIds);
        } else return res.json([]);
      }

      query += " ORDER BY nome";
      const [rows] = await db.query(query, params);
      res.json(rows);

    } catch (err) {
      console.error("ERRO LISTAR LOCALIDADES:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 CRIAR USUÁRIO
  // ===============================
  router.post("/", verificarAutenticacao, async (req, res) => {
    const { usuario, senha, cargo, telefone, email, localidades = [], tecnicos = [] } = req.body;

    if (!usuario || !senha) return res.status(400).json({ erro: "Usuário e senha obrigatórios" });

    try {
      const hashSenha = await bcrypt.hash(senha, SALT_ROUNDS);

      const [result] = await db.query(
        `INSERT INTO usuarios 
          (usuario, senha, cargo, telefone, email, ativo, empresa_id) 
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [usuario, hashSenha, cargo, telefone, email, req.usuario.empresa_id]
      );

      const userId = result.insertId;

      // 🔹 VÍNCULOS (Atendente ou Técnicos)
      if (localidades.length) {
        const locValues = localidades.map(loc => [userId, loc]);
        await db.query(
          "INSERT INTO usuario_localidades (usuario_id, localidade_id) VALUES ?",
          [locValues]
        );
      }
      if (tecnicos.length) {
        const tecValues = tecnicos.map(tec => [userId, tec]);
        await db.query(
          "INSERT INTO usuario_tecnicos (usuario_id, tecnico_id) VALUES ?",
          [tecValues]
        );
      }

      res.json({ sucesso: true });

    } catch (err) {
      console.error("ERRO CRIAR USUÁRIO:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 ATUALIZAR USUÁRIO
  // ===============================
  router.put("/:id", verificarAutenticacao, async (req, res) => {
    const { id } = req.params;
    const { cargo } = req.usuario;

    try {
      if (cargo.toLowerCase() !== "administrador") {
        return res.status(403).json({ erro: "Acesso negado" });
      }

      await db.query(
        `UPDATE usuarios 
         SET usuario=?, cargo=?, telefone=?, email=? 
         WHERE id=? AND empresa_id=?`,
        [
          req.body.usuario,
          req.body.cargo,
          req.body.telefone,
          req.body.email,
          id,
          req.usuario.empresa_id
        ]
      );

      res.json({ sucesso: true });

    } catch (err) {
      console.error("ERRO UPDATE USUÁRIO:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 RESETAR SENHA
  // ===============================
  router.post("/resetar-senha/:id", verificarAutenticacao, async (req, res) => {
    const { id } = req.params;
    const { senha } = req.body;
    const { cargo, empresa_id } = req.usuario;

    if (!senha) return res.status(400).json({ erro: "Senha obrigatória" });
    if (cargo.toLowerCase() !== "administrador") return res.status(403).json({ erro: "Acesso negado" });

    try {
      const hashSenha = await bcrypt.hash(senha, SALT_ROUNDS);
      await db.query("UPDATE usuarios SET senha=? WHERE id=? AND empresa_id=?", [hashSenha, id, empresa_id]);
      res.json({ sucesso: true });
    } catch (err) {
      console.error("ERRO RESET SENHA:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 ATIVAR / DESATIVAR USUÁRIO
  // ===============================
  router.post("/toggle/:id", verificarAutenticacao, async (req, res) => {
    const { id } = req.params;
    const { cargo, empresa_id } = req.usuario;

    if (cargo.toLowerCase() !== "administrador") return res.status(403).json({ erro: "Acesso negado" });

    try {
      const [user] = await db.query("SELECT ativo FROM usuarios WHERE id=? AND empresa_id=?", [id, empresa_id]);
      if (!user.length) return res.status(404).json({ erro: "Usuário não encontrado" });

      const novoStatus = user[0].ativo ? 0 : 1;
      await db.query("UPDATE usuarios SET ativo=? WHERE id=? AND empresa_id=?", [novoStatus, id, empresa_id]);
      res.json({ sucesso: true });

    } catch (err) {
      console.error("ERRO TOGGLE USUÁRIO:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  // ===============================
  // 🔹 DELETAR USUÁRIO
  // ===============================
  router.delete("/:id", verificarAutenticacao, async (req, res) => {
    const { id } = req.params;
    const { cargo, empresa_id } = req.usuario;

    if (cargo.toLowerCase() !== "administrador") return res.status(403).json({ erro: "Acesso negado" });

    try {
      const [result] = await db.query("DELETE FROM usuarios WHERE id=? AND empresa_id=?", [id, empresa_id]);
      if (result.affectedRows === 0) return res.status(404).json({ erro: "Usuário não encontrado" });
      res.json({ sucesso: true });
    } catch (err) {
      console.error("ERRO DELETE USUÁRIO:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  return router;
};