const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const db = require("../database");

// ===============================
// 🟢 CONFIG
// ===============================
const TELEGRAM_BOT_TOKEN = "8784255318:AAFcEDbs0-DBZv_omrqeKxKRYiOJqbSPiRY";
const TELEGRAM_CHAT_ID = "-5279504550";

let ultimoUpdateId = 0;
let aguardandoResposta = {};

// ===============================
// 📤 ENVIAR MENSAGEM
// ===============================
async function enviarTelegramMsg(mensagem, osId = null) {
    try {
        const body = {
            chat_id: TELEGRAM_CHAT_ID,
            text: mensagem,
            parse_mode: "Markdown"
        };

        if (osId) {
            body.reply_markup = {
                inline_keyboard: [
                    [
                        { text: "✅ OK", callback_data: `ok|${osId}` },
                        { text: "⚠️ Cliente Ausente", callback_data: `ausente|${osId}` }
                    ],
                    [
                        { text: "📆 Reagendar", callback_data: `reagendar|${osId}` },
                        { text: "❌ Inviabilidade", callback_data: `inviabilidade|${osId}` }
                    ]
                ]
            };
        }

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

    } catch (err) {
        console.error("Erro Telegram:", err.message);
    }
}

// ===============================
// 📎 DOWNLOAD DE ARQUIVO
// ===============================
async function baixarArquivoTelegram(file_id) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${file_id}`);
        const data = await res.json();

        if (!data.ok) throw new Error("Erro ao obter arquivo");

        const file_path = data.result.file_path;
        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file_path}`;

        const fileName = `${Date.now()}_${path.basename(file_path)}`;
        const destino = path.join(__dirname, "../uploads/inviabilidades", fileName);

        const fileResp = await fetch(url);
        const buffer = await fileResp.arrayBuffer();

        fs.writeFileSync(destino, Buffer.from(buffer));

        return `/uploads/inviabilidades/${fileName}`;

    } catch (err) {
        console.error("Erro download Telegram:", err);
        return null;
    }
}

// ===============================
// 🔘 RESPONDER CALLBACK
// ===============================
async function responderCallback(id, texto) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                callback_query_id: id,
                text: texto
            })
        });
    } catch (err) {
        console.error("Erro callback:", err);
    }
}

// ===============================
// 🔄 POLLING TELEGRAM
// ===============================
async function telegramPolling() {
    try {
        const resp = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${ultimoUpdateId + 1}&timeout=10`
        );

        const data = await resp.json();
        if (!data.ok) return;

        for (const update of data.result) {
            ultimoUpdateId = update.update_id;

            // ===============================
            // 🔘 BOTÕES
            // ===============================
            if (update.callback_query) {
                const callback = update.callback_query;
                const [acao, osId] = callback.data.split("|");
                const userId = callback.from.id;

                try {
                    await responderCallback(callback.id, "Processando...");

                    if (acao === "ok") {
                        await db.query(`
                            UPDATE ordens_servico
                            SET status='concluido', finalizado_em=NOW()
                            WHERE id=?
                        `, [osId]);

                        await responderCallback(callback.id, "✅ Finalizado!");
                    }

                    if (acao === "ausente") {
                        await db.query(`
                            UPDATE ordens_servico
                            SET status='cliente_ausente', finalizado_em=NOW()
                            WHERE id=?
                        `, [osId]);

                        await responderCallback(callback.id, "⚠️ Cliente ausente!");
                    }

                    if (acao === "reagendar") {
                        aguardandoResposta[userId] = {
                            tipo: "reagendar_data",
                            osId
                        };

                        await enviarTelegramMsg("📆 Envie a nova data:");
                    }

                    if (acao === "inviabilidade") {
                        aguardandoResposta[userId] = {
                            tipo: "inviabilidade_obs",
                            osId,
                            motivo: "OUTRO"
                        };

                        await enviarTelegramMsg("✍️ Envie motivo ou anexo:");
                    }

                } catch (err) {
                    console.error("Erro callback:", err);
                    await responderCallback(callback.id, "❌ Erro");
                }
            }
        }

    } catch (err) {
        console.error("Erro polling:", err.message);
    }
}

// ===============================
// ⏱️ LOOP
// ===============================
setInterval(telegramPolling, 3000);

// ===============================
// ⏱️ CRON
// ===============================
cron.schedule("* * * * *", async () => {
    try {
        const [ordens] = await db.query(`
            SELECT * FROM ordens_servico
            WHERE status='agendado'
            AND agendamento <= NOW()
        `);

        for (const os of ordens) {
            await enviarTelegramMsg(`🚀 OS automática:\nCliente: ${os.nome}`, os.id);

            await db.query(
                "UPDATE ordens_servico SET status='em_andamento' WHERE id=?",
                [os.id]
            );
        }

    } catch (err) {
        console.error("Erro CRON:", err);
    }
});

// ===============================
// EXPORT
// ===============================
module.exports = {
    enviarTelegramMsg
};