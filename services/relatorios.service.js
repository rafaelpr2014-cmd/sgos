const nodemailer = require("nodemailer");

async function enviarRelatorio(email, pdfBase64, assunto) {

    console.log("📩 [RELATÓRIO] Iniciando envio de e-mail...");
    console.log("➡️ Destinatário:", email);
    console.log("➡️ Assunto:", assunto);

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
port: process.env.SMTP_PORT,
auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
}
    });

    try {

        await transporter.verify();
        console.log("✅ SMTP conectado");

        // 🔥 CONVERTE BASE64 → BUFFER
       let pdfBuffer;

// 🔥 caso já venha Buffer
if (Buffer.isBuffer(pdfBase64)) {
    pdfBuffer = pdfBase64;
}

// 🔥 caso venha string
else if (typeof pdfBase64 === "string") {

    const base64Clean = pdfBase64
        .replace(/^data:application\/pdf;base64,/, "");

    pdfBuffer = Buffer.from(base64Clean, "base64");
}

// 🔥 caso venha objeto errado (muito comum no seu fluxo atual)
else if (pdfBase64 && typeof pdfBase64 === "object" && pdfBase64.pdfBase64) {

    const base64Clean = pdfBase64.pdfBase64
        .replace(/^data:application\/pdf;base64,/, "");

    pdfBuffer = Buffer.from(base64Clean, "base64");
}

// ❌ inválido
else {
    console.log("DEBUG pdfBase64:", pdfBase64);
    throw new Error("Formato de PDF inválido");
}

        const info = await transporter.sendMail({
            from: '"SGOS" <suporte.sgos@uol.com.br>',
            to: email,
            subject: assunto,
            html: "<p>Segue o relatório em anexo.</p>",

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