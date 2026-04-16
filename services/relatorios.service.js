const nodemailer = require("nodemailer");

async function enviarRelatorio(email, pdfBuffer, assunto) {

    console.log("📩 [RELATÓRIO] Iniciando envio de e-mail...");
    console.log("➡️ Destinatário:", email);
    console.log("➡️ Assunto:", assunto);
    console.log("➡️ PDF tamanho:", pdfBuffer ? pdfBuffer.length : 0);

    const transporter = nodemailer.createTransport({
        host: "smtps.uol.com.br",
        port: 587,
        secure: false,
        auth: {
            user: "suporte.sgos@uol.com.br",
            pass: "Rpr!@#2793"
        }
    });

    try {

        await transporter.verify();
        console.log("✅ SMTP conectado");

        const info = await transporter.sendMail({
            from: '"SGOS" <suporte.sgos@uol.com.br>',
            to: email,
            subject: assunto,
            html: "<p>Segue o relatório em anexo.</p>",

            // 🔥 AQUI É O MAIS IMPORTANTE
            attachments: [
                {
                    filename: "relatorio.pdf",
                    content: pdfBuffer,
                    contentType: "application/pdf"
                }
            ]
        });

        console.log("📨 EMAIL ENVIADO!");
        return info;

    } catch (err) {
        console.error("❌ ERRO AO ENVIAR EMAIL:");
        console.error(err);
        throw err;
    }
}

module.exports = {
    enviarRelatorio
};