// gerar-hash.js
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const dbConfig = {
  host: "metro.proxy.rlwy.net",
  user: "root",
  password: "pvwdMUHaBcUnRPFvRCIgoVWdAADxafkf",
  database: "railway",
  port: 33435
};

const novoUsuario = "admin";
const novaSenha = "Rpr!@#2793";
const novoCargo = "Administrador";
const novoTelefone = "73998069552";
const novoEmail = "rafaelpr2014@gmail.com";

async function criarUsuario() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const hash = await bcrypt.hash(novaSenha, 10);

    await connection.execute(
      "INSERT INTO usuarios (usuario, senha, cargo, ativo, telefone, email) VALUES (?, ?, ?, 1, ?, ?)",
      [novoUsuario, hash, novoCargo, novoTelefone, novoEmail]
    );

    console.log(`✅ Usuário "${novoUsuario}" criado com sucesso!`);
    await connection.end();
  } catch (err) {
    console.error("❌ Erro ao criar usuário:", err.message);
  }
}

criarUsuario();