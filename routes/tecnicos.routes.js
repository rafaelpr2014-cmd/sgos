module.exports = (db, verificarAutenticacao) => {
  const express = require("express");
  const router = express.Router();

  // 🔹 LISTAR TECNICOS
  router.get("/", verificarAutenticacao, async (req, res) => {
    try {

      console.log("USUARIO LOGADO:", req.usuario);

      const [rows] = await db.query(`
        SELECT id, nome, empresa_id
        FROM tecnicos
        WHERE empresa_id = ?
      `, [req.usuario.empresa_id]);

      console.log("RESULTADO TECNICOS:", rows);

      res.json(rows);

    } catch (err) {
      console.error("ERRO TECNICOS:", err);
      res.status(500).json({ erro: err.message });
    }
  });

  return router;
};