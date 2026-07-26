// routes/site-contato.routes.js
const express = require("express");
const nodemailer = require("nodemailer");
const router = express.Router();

router.post("/contato", async (req, res) => {
  try {
    const { nome, telefone, email, empresa, aceite, origem } = req.body || {};

    if (!nome || !telefone || !email || !empresa || aceite !== true) {
      return res.status(400).json({ erro: "Preencha todos os campos obrigatórios." });
    }

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) {
      return res.status(400).json({ erro: "Informe um e-mail válido." });
    }

    const smtpPort = Number(process.env.SMTP_PORT || 587);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const agora = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });

    await transporter.sendMail({
      from: `"Site SGOS" <${process.env.SMTP_USER}>`,
      to: "suporte.sgos@uol.com.br",
      replyTo: email,
      subject: `Novo contato pelo site — ${empresa}`,
      text: [
        "NOVO INTERESSADO NO SGOS",
        "",
        `Nome completo: ${nome}`,
        `Telefone / WhatsApp: ${telefone}`,
        `E-mail: ${email}`,
        `Empresa: ${empresa}`,
        `Origem: ${origem || "sgos.net.br"}`,
        `Recebido em: ${agora}`
      ].join("\n"),
      html: `
        <h2>Novo interessado no SGOS</h2>
        <p><strong>Nome completo:</strong> ${escapeHtml(nome)}</p>
        <p><strong>Telefone / WhatsApp:</strong> ${escapeHtml(telefone)}</p>
        <p><strong>E-mail:</strong> ${escapeHtml(email)}</p>
        <p><strong>Empresa:</strong> ${escapeHtml(empresa)}</p>
        <p><strong>Origem:</strong> ${escapeHtml(origem || "sgos.net.br")}</p>
        <p><strong>Recebido em:</strong> ${escapeHtml(agora)}</p>
      `
    });

    return res.json({ sucesso: true });
  } catch (erro) {
    console.error("Erro ao enviar contato do site:", erro);
    return res.status(500).json({ erro: "Não foi possível enviar a solicitação agora." });
  }
});

function escapeHtml(valor = "") {
  return String(valor).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

module.exports = router;
