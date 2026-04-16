const db = require("../database");
const telegramService = require("./telegram.service");
const { enviarMensagem } = require("../whatsapp/whatsappService");

// ===============================
// 🔧 MAPA DE TÉCNICOS
// ===============================
async function getMapaTecnicos(empresa_id) {
    const [tecnicosDb] = await db.query(
        "SELECT id, nome FROM tecnicos WHERE empresa_id=?",
        [empresa_id]
    );

    const mapa = {};
    tecnicosDb.forEach(t => mapa[t.id] = t.nome);
    return mapa;
}

// ===============================
// 🆕 CRIAR OS
// ===============================
exports.criar = async (dados, usuario) => {

    if (!usuario || !usuario.empresa_id) {
        throw new Error("Usuário inválido");
    }

    const {
        nome,
        telefone,
        rua,
        bairro,
        referencia,
        tipo_servico,
        tecnico,
        agendamento,
        localidade,
        plano,
        id_cliente,
        login
    } = dados;

    const status = agendamento ? "agendado" : "aberto";

    const [result] = await db.query(`
    INSERT INTO ordens_servico 
    (
        nome,
        telefone,
        rua,
        bairro,
        referencia,
        tipo_servico,
        tecnico,
        agendamento,
        empresa_id,
        status,
        localidade,
        plano,
        id_cliente,
        login,
        criado_por,
        data_abertura
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
`, [
    nome,
    telefone,
    rua,
    bairro,
    referencia,
    tipo_servico,
    JSON.stringify(tecnico || []),
    agendamento || null,
    usuario.empresa_id,
    status,
    localidade || null,
    plano || null,
    id_cliente || null,   // 🔥 faltava
    login || null,        // 🔥 faltava
    usuario.id
]);

    return {
        sucesso: true,
        id: result.insertId
    };
};

// ===============================
// 📡 ENVIO DE NOTIFICAÇÕES
// ===============================
async function enviarNotificacao({ tipo, os, tecnicos, usuario }) {
    try {

        // 🔹 Garantir técnicos formatados
        const listaTecnicos = tecnicos.length ? tecnicos.join(", ") : "-";

        // 🔹 Endereço formatado
        const endereco = `${os.rua || "-"} - ${os.bairro || "-"}`;

        // ===============================
        // 📡 TELEGRAM
        // ===============================
        let mensagemTelegram = "";

        switch (tipo) {
            case "iniciar":
                mensagemTelegram = `🚀 *OS INICIADA*

👤 Cliente: ${os.nome}
📞 Telefone: ${os.telefone || "-"}
🛠 Serviço: ${os.tipo_servico_nome || "-"}
👨‍🔧 Técnico(s): ${listaTecnicos}
📍 Endereço: ${endereco}
📆 Agendamento: ${os.agendamento || "-"}`;
                break;

            case "ausente":
                mensagemTelegram = `🚫 *CLIENTE AUSENTE*

👤 Cliente: ${os.nome}
📞 Telefone: ${os.telefone || "-"}
👨‍🔧 Técnico(s): ${listaTecnicos}`;
                break;

            case "concluir":
                mensagemTelegram = `✅ *OS FINALIZADA*

👤 Cliente: ${os.nome}
📞 Telefone: ${os.telefone || "-"}
👨‍🔧 Técnico(s): ${listaTecnicos}`;
                break;
        }

        console.log(`📡 Telegram (${tipo}) OS ${os.id}`);
        await telegramService.enviarTelegramMsg(mensagemTelegram, os.id);

        // ===============================
        // 📲 WHATSAPP
        // ===============================
        if (os.telefone) {

            let mensagemWhats = "";

            switch (tipo) {

                case "iniciar":
                    mensagemWhats = `🚀 OLÁ, ${os.nome},

O seu atendimento de *${os.tipo_servico_nome || "serviço"}* será realizado em breve!

👨‍🔧 Técnico(s): ${listaTecnicos}

📍 A Nossa equipe já está na rota. Só aguardar!

Qualquer dúvida, estamos à disposição 😊`;
                    break;

                case "ausente":
                    mensagemWhats = `🚫 Olá ${os.nome},

Tentamos realizar seu atendimento, mas você não estava no local.

📍 Entre em contato para reagendar.

Estamos à disposição 👍`;
                    break;

                case "concluir":
                    mensagemWhats = `✅ Olá ${os.nome},

Seu atendimento foi finalizado com sucesso!

👨‍🔧 Técnico(s): ${listaTecnicos}

Obrigado por confiar em nosso serviço 🙌`;
                    break;
            }

            console.log(`📲 WhatsApp (${tipo}) → ${os.telefone}`);
            await enviarMensagem(usuario.empresa_id, os.telefone, mensagemWhats);
        }

    } catch (err) {
        console.error("❌ ERRO NOTIFICAÇÃO:", err);
    }
}

// ===============================
// 🚀 INICIAR OS
// ===============================
exports.iniciarOS = async (id, usuario) => {

    if (!usuario) throw new Error("Usuário inválido");

    await db.query(`
        UPDATE ordens_servico
        SET status='em_andamento',
            iniciado_em=NOW(),
            enviado_por=?
        WHERE id=? AND empresa_id=?
    `, [usuario.usuario, id, usuario.empresa_id]);

    const [rows] = await db.query(`
        SELECT os.*, ts.nome AS tipo_servico_nome
        FROM ordens_servico os
        LEFT JOIN tipos_servico ts ON os.tipo_servico = ts.id
        WHERE os.id=? AND os.empresa_id=?
    `, [id, usuario.empresa_id]);

    const os = rows[0];
    if (!os) throw new Error("OS não encontrada");

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];
    try {
        tecnicos = JSON.parse(os.tecnico || "[]").map(id => mapa[id] || id);
    } catch {}

    await enviarNotificacao({ tipo: "iniciar", os, tecnicos, usuario });

    return { sucesso: true };
};

// ===============================
// 🚫 CLIENTE AUSENTE
// ===============================
exports.clienteAusente = async (id, usuario) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='cliente_ausente',
            finalizado_em=NOW(),
            finalizado_por=?
        WHERE id=? AND empresa_id=?
    `, [usuario.usuario, id, usuario.empresa_id]);

    const [rows] = await db.query(`
        SELECT os.*, ts.nome AS tipo_servico_nome
        FROM ordens_servico os
        LEFT JOIN tipos_servico ts ON os.tipo_servico = ts.id
        WHERE os.id=? AND os.empresa_id=?
    `, [id, usuario.empresa_id]);

    const os = rows[0];
    if (!os) throw new Error("OS não encontrada");

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];
    try {
        tecnicos = JSON.parse(os.tecnico || "[]").map(id => mapa[id] || id);
    } catch {}

    await enviarNotificacao({ tipo: "ausente", os, tecnicos, usuario });

    return { sucesso: true };
};

// ===============================
// ✅ CONCLUIR OS
// ===============================
exports.concluirOS = async (id, usuario) => {

    await db.query(`
        UPDATE ordens_servico
        SET status='concluido',
            finalizado_em=NOW(),
            finalizado_por=?
        WHERE id=? AND empresa_id=?
    `, [usuario.usuario, id, usuario.empresa_id]);

    const [rows] = await db.query(`
        SELECT os.*, ts.nome AS tipo_servico_nome
        FROM ordens_servico os
        LEFT JOIN tipos_servico ts ON os.tipo_servico = ts.id
        WHERE os.id=? AND os.empresa_id=?
    `, [id, usuario.empresa_id]);

    const os = rows[0];
    if (!os) throw new Error("OS não encontrada");

    const mapa = await getMapaTecnicos(usuario.empresa_id);

    let tecnicos = [];
    try {
        tecnicos = JSON.parse(os.tecnico || "[]").map(id => mapa[id] || id);
    } catch {}

    await enviarNotificacao({ tipo: "concluir", os, tecnicos, usuario });

    return { sucesso: true };
};