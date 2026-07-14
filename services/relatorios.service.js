const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function dataBR(data) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date(data));
}

function inicioDoDia(data) {
    const d = new Date(data);
    d.setHours(0, 0, 0, 0);
    return d;
}

function fimDoDia(data) {
    const d = new Date(data);
    d.setHours(23, 59, 59, 999);
    return d;
}

function obterPeriodo(tipo, referencia = new Date()) {
    const ref = new Date(referencia);
    let inicio;
    let fim;

    if (tipo === "diario") {
        inicio = inicioDoDia(ref);
        fim = fimDoDia(ref);
    } else if (tipo === "semanal") {
        fim = fimDoDia(ref);
        inicio = inicioDoDia(ref);
        inicio.setDate(inicio.getDate() - 6);
    } else if (tipo === "mensal") {
        inicio = new Date(ref.getFullYear(), ref.getMonth() - 1, 1, 0, 0, 0, 0);
        fim = new Date(ref.getFullYear(), ref.getMonth(), 0, 23, 59, 59, 999);
    } else {
        throw new Error(`Periodicidade inválida: ${tipo}`);
    }

    return { inicio, fim };
}

function nomeEmpresa(empresa) {
    return empresa.nome_provedor || empresa.nome_fantasia || empresa.nome_completo || `Empresa ${empresa.id}`;
}

function limparNomeArquivo(valor) {
    return String(valor || "Empresa")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

function montarNomeArquivo(tipo, inicio, fim, empresa) {
    const nome = limparNomeArquivo(nomeEmpresa(empresa));
    const titulo = tipo === "diario" ? "Relatorio Diario" : tipo === "semanal" ? "Relatorio Semanal" : "Relatorio Mensal";
    const periodo = tipo === "diario" ? dataBR(inicio) : `${dataBR(inicio)} a ${dataBR(fim)}`;
    return `${titulo} ${periodo} - ${nome}.pdf`;
}

async function buscarEmpresa(pool, empresaId) {
    const [rows] = await pool.query("SELECT * FROM empresa WHERE id = ? LIMIT 1", [empresaId]);
    if (!rows.length) throw new Error("Empresa não encontrada");
    return rows[0];
}

async function buscarOrdens(pool, empresaId, inicio, fim) {
    const [rows] = await pool.query(`
        SELECT
            os.id,
            os.cliente,
            os.status,
            os.data_abertura,
            os.finalizado_em,
            os.agendamento,
            COALESCE(l.nome, os.localidade) AS localidade_nome,
            COALESCE(ts.nome, os.tipo_servico) AS tipo_servico_nome
        FROM ordens_servico os
        LEFT JOIN localidades l ON l.id = os.localidade AND l.empresa_id = os.empresa_id
        LEFT JOIN tipos_servico ts ON ts.id = os.tipo_servico AND ts.empresa_id = os.empresa_id
        WHERE os.empresa_id = ?
          AND (
            (os.data_abertura BETWEEN ? AND ?)
            OR (os.finalizado_em BETWEEN ? AND ?)
            OR (os.agendamento BETWEEN ? AND ?)
          )
        ORDER BY os.id DESC
    `, [empresaId, inicio, fim, inicio, fim, inicio, fim]);
    return rows;
}

function contarStatus(ordens) {
    const resumo = { total: ordens.length, abertas: 0, andamento: 0, concluidas: 0, ausentes: 0, inviabilidades: 0 };
    for (const os of ordens) {
        const status = String(os.status || "").toLowerCase();
        if (["concluido", "concluida", "finalizado", "finalizada"].includes(status)) resumo.concluidas++;
        else if (["em_andamento", "andamento", "execucao"].includes(status)) resumo.andamento++;
        else if (status.includes("ausente")) resumo.ausentes++;
        else if (status.includes("inviab")) resumo.inviabilidades++;
        else resumo.abertas++;
    }
    return resumo;
}

function adicionarCabecalho(doc, empresa, tipo, inicio, fim) {
    const logo = empresa.logo ? path.join(__dirname, "../uploads/logos", path.basename(empresa.logo)) : null;
    if (logo && fs.existsSync(logo)) {
        try { doc.image(logo, 430, 36, { fit: [110, 55], align: "right" }); } catch (_) {}
    }

    doc.font("Helvetica-Bold").fontSize(17).text(nomeEmpresa(empresa), 45, 42, { width: 360 });
    doc.font("Helvetica").fontSize(9).fillColor("#475569");
    doc.text(`CNPJ/CPF: ${empresa.cnpj || empresa.cpf || "-"}`, 45, 67);
    doc.text(`Telefone: ${empresa.telefone || "-"}  |  E-mail: ${empresa.email || "-"}`, 45, 81);

    const titulo = tipo === "diario" ? "RELATÓRIO DIÁRIO" : tipo === "semanal" ? "RELATÓRIO SEMANAL" : "RELATÓRIO MENSAL";
    doc.moveDown(3.5);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(20).text(titulo, { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text(`Período: ${dataBR(inicio)} a ${dataBR(fim)}`, { align: "center" });
    doc.moveDown(1.2);
}

function desenharKpis(doc, resumo) {
    const itens = [
        ["Total", resumo.total], ["Abertas", resumo.abertas], ["Em andamento", resumo.andamento],
        ["Concluídas", resumo.concluidas], ["Ausentes", resumo.ausentes], ["Inviabilidades", resumo.inviabilidades]
    ];
    const largura = 165;
    const altura = 52;
    const gap = 12;
    let x = 45;
    let y = doc.y;

    itens.forEach(([rotulo, valor], i) => {
        if (i > 0 && i % 3 === 0) { x = 45; y += altura + gap; }
        doc.roundedRect(x, y, largura, altura, 8).fillAndStroke("#eff6ff", "#dbeafe");
        doc.fillColor("#1e3a8a").font("Helvetica-Bold").fontSize(20).text(String(valor), x + 12, y + 9, { width: largura - 24 });
        doc.fillColor("#475569").font("Helvetica").fontSize(9).text(rotulo, x + 12, y + 33, { width: largura - 24 });
        x += largura + gap;
    });
    doc.y = y + altura + 18;
}

function adicionarTabela(doc, ordens) {
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Ordens de serviço do período");
    doc.moveDown(0.5);

    const cab = ["OS", "Cliente", "Tipo", "Localidade", "Status"];
    const widths = [42, 150, 115, 115, 90];
    const startX = 45;

    function linha(celulas, header = false) {
        if (doc.y > 735) { doc.addPage(); doc.y = 45; }
        const y = doc.y;
        let x = startX;
        const h = 27;
        if (header) doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), h).fill("#163b70");
        else doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), h).fillAndStroke("#ffffff", "#e5e7eb");
        celulas.forEach((valor, i) => {
            doc.fillColor(header ? "#ffffff" : "#0f172a")
                .font(header ? "Helvetica-Bold" : "Helvetica")
                .fontSize(header ? 8 : 7.5)
                .text(String(valor ?? "-"), x + 5, y + 8, { width: widths[i] - 10, height: 15, ellipsis: true });
            x += widths[i];
        });
        doc.y = y + h;
    }

    linha(cab, true);
    ordens.slice(0, 150).forEach(os => linha([
        os.id,
        os.cliente || "-",
        os.tipo_servico_nome || "-",
        os.localidade_nome || "-",
        String(os.status || "-").replaceAll("_", " ")
    ]));

    if (ordens.length > 150) {
        doc.moveDown(0.5).fontSize(8).fillColor("#64748b").text(`Exibidas 150 de ${ordens.length} ordens.`);
    }
}

async function gerarRelatorioEmpresa(pool, empresaId, tipo = "diario", referencia = new Date()) {
    const empresa = await buscarEmpresa(pool, empresaId);
    const { inicio, fim } = obterPeriodo(tipo, referencia);
    const ordens = await buscarOrdens(pool, empresaId, inicio, fim);
    const resumo = contarStatus(ordens);
    const filename = montarNomeArquivo(tipo, inicio, fim, empresa);

    const buffer = await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 45, info: { Title: filename, Author: "SGOS" } });
        const chunks = [];
        doc.on("data", chunk => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        adicionarCabecalho(doc, empresa, tipo, inicio, fim);
        desenharKpis(doc, resumo);
        adicionarTabela(doc, ordens);
        doc.moveDown(1);
        doc.font("Helvetica").fontSize(8).fillColor("#64748b")
            .text(`Gerado automaticamente pelo SGOS em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, { align: "center" });
        doc.end();
    });

    return { buffer, filename, empresa, inicio, fim, resumo };
}

function criarTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false") === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
}

async function enviarRelatorio(email, pdf, assunto, nomeArquivo = "relatorio.pdf") {
    if (!email) throw new Error("E-mail de destino não informado");
    const buffer = Buffer.isBuffer(pdf) ? pdf : pdf?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error("PDF vazio ou inválido");

    const transporter = criarTransporter();
    await transporter.sendMail({
        from: process.env.SMTP_FROM || `"SGOS" <${process.env.SMTP_USER}>`,
        to: email,
        subject: assunto,
        html: "<p>Olá! Segue o relatório automático do SGOS em anexo.</p>",
        attachments: [{ filename: nomeArquivo, content: buffer, contentType: "application/pdf" }]
    });
}

module.exports = {
    gerarRelatorioEmpresa,
    enviarRelatorio,
    obterPeriodo,
    montarNomeArquivo,
    dataBR
};
