const bcrypt = require("bcryptjs");

module.exports = (db) => {
  const express = require("express");
  const router = express.Router();

  // ===============================
  // LOGIN
  // ===============================
  router.post("/login", async (req, res) => {
    const { usuario, senha } = req.body;
    if (!usuario || !senha) return res.status(400).json({ erro: "Preencha usuário e senha" });

    try {
      // Buscar usuário
      const [users] = await db.query("SELECT * FROM usuarios WHERE usuario = ? LIMIT 1", [usuario]);
      if (!users.length) return res.status(401).json({ erro: "Usuário ou senha inválidos" });

      const user = users[0];
      const senhaValida = await bcrypt.compare(senha, user.senha);
      if (!senhaValida) return res.status(401).json({ erro: "Usuário ou senha inválidos" });

      // Verifica log ativo
      const [logsAtivos] = await db.query(
        "SELECT id FROM log_acessos WHERE usuario = ? AND logout IS NULL LIMIT 1",
        [usuario]
      );

      let logId;
      if (logsAtivos.length) {
        logId = logsAtivos[0].id;
      } else {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const [result] = await db.query(
          "INSERT INTO log_acessos (usuario, empresa_id, ip_origem, login, ultimo_ping, status) VALUES (?, ?, ?, NOW(), NOW(), 'ativo')",
          [usuario, user.empresa_id, ip]
        );
        logId = result.insertId;
      }

      res.json({
        ok: true,
        usuario: {
          id: user.id,
          nome: user.nome || user.usuario,
          cargo: user.cargo,
          empresa_id: user.empresa_id
        },
        log_id: logId
      });

    } catch (err) {
      console.error("ERRO LOGIN:", err);
      res.status(500).json({ erro: "Erro no servidor" });
    }
  });

  // ===============================
  // LOGOUT
  // ===============================
  router.post("/logout", async (req, res) => {
    const log_id = req.body?.log_id || req.query?.log_id;
    if (!log_id) return res.status(400).json({ erro: "log_id não informado" });

    try {
      await db.query("UPDATE log_acessos SET logout = NOW(), status = 'logout' WHERE id = ?", [log_id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: "Erro ao registrar logout" });
    }
  });

  return router;
};

  // ===============================
  // PING - manter usuário ativo
  // ===============================
  router.post("/ping", async (req, res) => {
    const { log_id } = req.body;
    if (!log_id) return res.status(400).json({ erro: "log_id não informado" });

    try {
      await db.query("UPDATE log_acessos SET ultimo_ping = NOW(), status = 'ativo' WHERE id = ?", [log_id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: "Erro no ping" });
    }
  });

  // ===============================
  // LISTAR LOGS
  // ===============================
  router.get("/logs", async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT id, usuario, empresa_id, ip_origem, login, logout, status FROM log_acessos ORDER BY login DESC LIMIT 100"
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: "Erro ao listar logs" });
    }
  });

  return router;
};