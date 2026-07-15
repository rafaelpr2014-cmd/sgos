const nodemailer = require("nodemailer");
const { jsPDF } = require("jspdf");
const fs = require("fs");
const path = require("path");

const FUSO = "America/Sao_Paulo";

function dataBR(data) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date(data));
}

function dataHoraBR(data = new Date()) {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
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

    if (tipo === "diario") {
        return {
            inicio: inicioDoDia(ref),
            fim: fimDoDia(ref)
        };
    }

    if (tipo === "semanal") {
        const fim = fimDoDia(ref);
        const inicio = inicioDoDia(ref);
        inicio.setDate(inicio.getDate() - 6);
        return { inicio, fim };
    }

    if (tipo === "mensal") {
        return {
            inicio: new Date(
                ref.getFullYear(),
                ref.getMonth() - 1,
                1,
                0,
                0,
                0,
                0
            ),
            fim: new Date(
                ref.getFullYear(),
                ref.getMonth(),
                0,
                23,
                59,
                59,
                999
            )
        };
    }

    throw new Error(`Periodicidade inválida: ${tipo}`);
}

function nomeEmpresa(empresa) {
    return (
        empresa.nome_provedor ||
        empresa.nome_fantasia ||
        empresa.nome_completo ||
        `Empresa ${empresa.id}`
    );
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

    const titulo =
        tipo === "diario"
            ? "Relatorio Diario"
            : tipo === "semanal"
                ? "Relatorio Semanal"
                : "Relatorio Mensal";

    const periodo =
        tipo === "diario"
            ? dataBR(inicio)
            : `${dataBR(inicio)} a ${dataBR(fim)}`;

    return `${titulo} ${periodo} - ${nome}.pdf`;
}

async function buscarEmpresa(pool, empresaId) {
    const [rows] = await pool.query(
        "SELECT * FROM empresa WHERE id = ? LIMIT 1",
        [empresaId]
    );

    if (!rows.length) {
        throw new Error("Empresa não encontrada");
    }

    return rows[0];
}

async function buscarTecnicos(pool, empresaId) {
    try {
        const [rows] = await pool.query(
            `
            SELECT id, nome, usuario
            FROM tecnicos
            WHERE empresa_id = ?
            `,
            [empresaId]
        );

        return rows;
    } catch (_) {
        const [rows] = await pool.query(
            `
            SELECT id, nome
            FROM tecnicos
            WHERE empresa_id = ?
            `,
            [empresaId]
        );

        return rows;
    }
}

async function buscarPlanos(pool, empresaId) {
    const [rows] = await pool.query(
        `
        SELECT id, nome
        FROM planos
        WHERE empresa_id = ?
        `,
        [empresaId]
    );

    return rows;
}

async function buscarOrdens(pool, empresaId, inicio, fim) {
    const [rows] = await pool.query(
        `
        SELECT
            os.id,
            os.cliente,
            os.plano,
            os.status,
            os.tecnico,
            os.data_abertura,
            os.finalizado_em,
            os.agendamento,
            COALESCE(l.nome, os.localidade) AS nome_localidade,
            COALESCE(ts.nome, os.tipo_servico) AS nome_tipo_servico
        FROM ordens_servico os
        LEFT JOIN localidades l
            ON os.localidade = l.id
           AND l.empresa_id = os.empresa_id
        LEFT JOIN tipos_servico ts
            ON os.tipo_servico = ts.id
           AND ts.empresa_id = os.empresa_id
        WHERE os.empresa_id = ?
          AND os.status <> 'em_andamento'
          AND (
                os.data_abertura BETWEEN ? AND ?
                OR os.finalizado_em BETWEEN ? AND ?
                OR os.agendamento BETWEEN ? AND ?
              )
        ORDER BY os.id DESC
        `,
        [
            empresaId,
            inicio,
            fim,
            inicio,
            fim,
            inicio,
            fim
        ]
    );

    return rows;
}

function criarMapa(lista) {
    const mapa = {};

    for (const item of lista || []) {
        mapa[String(item.id)] =
            item.nome ||
            item.usuario ||
            item.name ||
            String(item.id);
    }

    return mapa;
}

function normalizarTecnicos(valor) {
    if (!valor) return [];

    if (Array.isArray(valor)) {
        return valor;
    }

    if (
        typeof valor === "string" &&
        valor.trim().startsWith("[")
    ) {
        try {
            const parsed = JSON.parse(valor);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    return [valor];
}

function agrupar(lista, campo, mapaTecnicos) {
    const obj = {};

    for (const o of lista || []) {
        if (campo === "tecnico") {
            const tecnicos = [
                ...new Set(normalizarTecnicos(o.tecnico))
            ]
                .map(t => String(t).trim())
                .filter(t =>
                    t &&
                    t !== "null" &&
                    t !== "undefined"
                );

            for (const tecnico of tecnicos) {
                const nome =
                    mapaTecnicos[String(tecnico)] ||
                    String(tecnico);

                if (!nome || nome === "null" || nome === "undefined") {
                    continue;
                }

                if (!obj[nome]) {
                    obj[nome] = {
                        abertas: 0,
                        concluidas: 0
                    };
                }

                if (o.data_abertura) obj[nome].abertas++;
                if (o.finalizado_em) obj[nome].concluidas++;
            }

            continue;
        }

        const chave =
            o?.[campo] && String(o[campo]).trim()
                ? String(o[campo]).trim()
                : "NÃO INFORMADO";

        if (!obj[chave]) {
            obj[chave] = {
                abertas: 0,
                concluidas: 0
            };
        }

        if (o.data_abertura) obj[chave].abertas++;
        if (o.finalizado_em) obj[chave].concluidas++;
    }

    return obj;
}

function carregarLogoDataUri(empresa) {
    if (!empresa.logo) return null;

    const arquivo = path.join(
        __dirname,
        "../uploads/logos",
        path.basename(empresa.logo)
    );

    if (!fs.existsSync(arquivo)) return null;

    const ext = path.extname(arquivo).toLowerCase();
    const mime =
        ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "image/png";

    return `data:${mime};base64,${fs.readFileSync(arquivo).toString("base64")}`;
}

function detectarTipoImagem(dataUri) {
    return String(dataUri).includes("image/jpeg")
        ? "JPEG"
        : "PNG";
}

function desenharLogo(doc, logoDataUri) {
    if (!logoDataUri) return;

    try {
        const propriedades = doc.getImageProperties(logoDataUri);

        let largura = propriedades.width || 200;
        let altura = propriedades.height || 80;

        const maxWidth = 42;
        const maxHeight = 22;

        const ratio = Math.min(
            maxWidth / largura,
            maxHeight / altura
        );

        largura *= ratio;
        altura *= ratio;

        const posX = 200 - largura - 4;
        const posY = 8;

        doc.addImage(
            logoDataUri,
            detectarTipoImagem(logoDataUri),
            posX,
            posY,
            largura,
            altura
        );
    } catch (erro) {
        console.error("Erro ao desenhar logo no PDF:", erro.message);
    }
}

function montarPdfExato({
    empresa,
    tipo,
    inicio,
    fim,
    ordens,
    mapaTecnicos,
    mapaPlanos
}) {
    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
    });

    const logoDataUri = carregarLogoDataUri(empresa);
    desenharLogo(doc, logoDataUri);

    let y = 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(nomeEmpresa(empresa), 10, y);

    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    doc.text(
        `CNPJ/CPF: ${empresa.cnpj || empresa.cpf || "-"}`,
        10,
        y
    );

    y += 5;

    doc.text(
        `Telefone: ${empresa.telefone || "-"}`,
        10,
        y
    );

    y += 5;

    if (empresa.email) {
        doc.text(
            `Email: ${empresa.email}`,
            10,
            y
        );

        y += 5;
    }

    if (empresa.endereco) {
        const linhas = doc.splitTextToSize(
            String(empresa.endereco),
            120
        );

        doc.text("Endereço:", 10, y);
        doc.text(linhas, 30, y);

        y += (linhas.length * 4) + 2;
    }

    const textoPeriodo =
        tipo === "diario"
            ? dataBR(inicio)
            : `${dataBR(inicio)} até ${dataBR(fim)}`;

    doc.text(
        `Período: ${textoPeriodo}`,
        10,
        y
    );

    y += 5;

    doc.text(
        `Gerado em: ${dataHoraBR()}`,
        10,
        y
    );

    y += 10;

    function tituloAzul(texto) {
        if (y > 270) {
            doc.addPage();
            y = 20;
        }

        doc.setFillColor(0, 102, 204);
        doc.rect(10, y - 5, 190, 8, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(texto.toUpperCase(), 12, y);

        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        y += 8;
    }

    function desenharTabela(obj) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("Descrição", 10, y);
        doc.text("Abertas", 140, y);
        doc.text("Concluídas", 170, y);

        doc.setFont("helvetica", "normal");
        y += 6;

        Object.entries(obj)
            .sort(
                (a, b) =>
                    (b[1].abertas + b[1].concluidas) -
                    (a[1].abertas + a[1].concluidas)
            )
            .forEach(([chave, valores]) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }

                doc.text(
                    String(chave).substring(0, 40),
                    10,
                    y
                );

                doc.text(
                    String(valores.abertas || 0),
                    145,
                    y
                );

                doc.text(
                    String(valores.concluidas || 0),
                    175,
                    y
                );

                y += 5;
            });

        y += 4;
    }

    function desenharListaAgrupada(titulo, dados) {
        if (y > 220) {
            doc.addPage();
            y = 20;
        }

        doc.setFillColor(0, 102, 204);
        doc.rect(10, y - 6, 190, 8, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(titulo.toUpperCase(), 12, y - 0.5);

        doc.setTextColor(0, 0, 0);
        y += 10;

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");

        doc.text("Descrição", 12, y);
        doc.text("Localidade", 85, y);
        doc.text("Abertas", 155, y, { align: "right" });
        doc.text("Concluídas", 190, y, { align: "right" });

        y += 5;

        doc.setFont("helvetica", "normal");

        Object.entries(dados).forEach(([nome, locais]) => {
            let totalAbertasGrupo = 0;
            let totalConcluidasGrupo = 0;

            Object.entries(locais).forEach(
                ([local, valores]) => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }

                    const abertas =
                        valores.abertas || 0;

                    const concluidas =
                        valores.concluidas || 0;

                    totalAbertasGrupo += abertas;
                    totalConcluidasGrupo += concluidas;

                    doc.text(
                        String(nome).substring(0, 38),
                        12,
                        y
                    );

                    doc.text(
                        String(local).substring(0, 22),
                        85,
                        y
                    );

                    doc.text(
                        String(abertas),
                        155,
                        y,
                        { align: "right" }
                    );

                    doc.text(
                        String(concluidas),
                        190,
                        y,
                        { align: "right" }
                    );

                    y += 5;
                }
            );

            doc.setFont("helvetica", "bold");

            doc.text(
                `TOTAL = ${String(nome).substring(0, 45)}`,
                12,
                y
            );

            doc.text(
                String(totalAbertasGrupo),
                155,
                y,
                { align: "right" }
            );

            doc.text(
                String(totalConcluidasGrupo),
                190,
                y,
                { align: "right" }
            );

            doc.setFont("helvetica", "normal");

            y += 8;

            doc.setDrawColor(220);
            doc.line(10, y - 4, 200, y - 4);
        });

        y += 5;
    }

    tituloAzul("TÉCNICOS");
    desenharTabela(
        agrupar(ordens, "tecnico", mapaTecnicos)
    );

    tituloAzul("LOCALIDADES");
    desenharTabela(
        agrupar(ordens, "nome_localidade", mapaTecnicos)
    );

    tituloAzul("TIPOS DE SERVIÇO");
    desenharTabela(
        agrupar(ordens, "nome_tipo_servico", mapaTecnicos)
    );

    tituloAzul("INSTALAÇÕES POR LOCALIDADE");

    const instalacoes = {};

    for (const o of ordens) {
        const tipoServico = String(
            o.nome_tipo_servico || ""
        ).toUpperCase();

        if (!tipoServico.includes("INSTALA")) continue;

        const local =
            o.nome_localidade ||
            "NÃO INFORMADO";

        if (!instalacoes[local]) {
            instalacoes[local] = {
                abertas: 0,
                concluidas: 0
            };
        }

        if (o.data_abertura) instalacoes[local].abertas++;
        if (o.finalizado_em) instalacoes[local].concluidas++;
    }

    desenharTabela(instalacoes);

    const tiposLocalidade = {};

    for (const o of ordens) {
        const tipoServico =
            o.nome_tipo_servico ||
            "NÃO INFORMADO";

        const local =
            o.nome_localidade ||
            "SEM LOCAL";

        if (!tiposLocalidade[tipoServico]) {
            tiposLocalidade[tipoServico] = {};
        }

        if (!tiposLocalidade[tipoServico][local]) {
            tiposLocalidade[tipoServico][local] = {
                abertas: 0,
                concluidas: 0
            };
        }

        if (o.data_abertura) {
            tiposLocalidade[tipoServico][local].abertas++;
        }

        if (o.finalizado_em) {
            tiposLocalidade[tipoServico][local].concluidas++;
        }
    }

    const instalacoesLocalidade = {};

    for (const o of ordens) {
        const tipoServico = String(
            o.nome_tipo_servico || ""
        ).toUpperCase();

        if (!tipoServico.includes("INSTALA")) continue;

        const plano =
            mapaPlanos[String(o.plano)] ||
            "";

        if (!plano || plano === "SEM PLANO") continue;

        const local =
            o.nome_localidade ||
            "SEM LOCAL";

        if (!instalacoesLocalidade[plano]) {
            instalacoesLocalidade[plano] = {};
        }

        if (!instalacoesLocalidade[plano][local]) {
            instalacoesLocalidade[plano][local] = {
                abertas: 0,
                concluidas: 0
            };
        }

        if (o.data_abertura) {
            instalacoesLocalidade[plano][local].abertas++;
        }

        if (o.finalizado_em) {
            instalacoesLocalidade[plano][local].concluidas++;
        }
    }

    desenharListaAgrupada(
        "TIPOS DE SERVIÇOS POR LOCALIDADE",
        tiposLocalidade
    );

    desenharListaAgrupada(
        "PLANOS DAS INSTALAÇÕES POR LOCALIDADE",
        instalacoesLocalidade
    );

    return Buffer.from(
        doc.output("arraybuffer")
    );
}

async function gerarRelatorioEmpresa(
    pool,
    empresaId,
    tipo = "diario",
    referencia = new Date()
) {
    const empresa =
        await buscarEmpresa(pool, empresaId);

    const { inicio, fim } =
        obterPeriodo(tipo, referencia);

    const [
        ordens,
        tecnicos,
        planos
    ] = await Promise.all([
        buscarOrdens(
            pool,
            empresaId,
            inicio,
            fim
        ),
        buscarTecnicos(
            pool,
            empresaId
        ),
        buscarPlanos(
            pool,
            empresaId
        )
    ]);

    const mapaTecnicos =
        criarMapa(tecnicos);

    const mapaPlanos =
        criarMapa(planos);

    const filename =
        montarNomeArquivo(
            tipo,
            inicio,
            fim,
            empresa
        );

    const buffer =
        montarPdfExato({
            empresa,
            tipo,
            inicio,
            fim,
            ordens,
            mapaTecnicos,
            mapaPlanos
        });

    if (
        !Buffer.isBuffer(buffer) ||
        buffer.length < 100
    ) {
        throw new Error(
            "PDF automático vazio ou inválido"
        );
    }

    return {
        buffer,
        filename,
        empresa,
        inicio,
        fim,
        totalOrdens: ordens.length
    };
}

function criarTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(
            process.env.SMTP_PORT || 587
        ),
        secure:
            String(
                process.env.SMTP_SECURE || "false"
            ).toLowerCase() === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function enviarRelatorio(
    email,
    pdf,
    assunto,
    nomeArquivo = "relatorio.pdf"
) {
    if (!email) {
        throw new Error(
            "E-mail de destino não informado"
        );
    }

    const buffer =
        Buffer.isBuffer(pdf)
            ? pdf
            : pdf?.buffer;

    if (
        !Buffer.isBuffer(buffer) ||
        buffer.length < 100
    ) {
        throw new Error(
            "PDF vazio ou inválido"
        );
    }

    const transporter =
        criarTransporter();

    await transporter.sendMail({
        from:
            process.env.SMTP_FROM ||
            `"SGOS" <${process.env.SMTP_USER}>`,
        to: email,
        subject: assunto,
        html: `
            <p>Olá!</p>
            <p>Segue o relatório automático do SGOS em anexo.</p>
        `,
        attachments: [
            {
                filename: nomeArquivo,
                content: buffer,
                contentType:
                    "application/pdf"
            }
        ]
    });
}

module.exports = {
    gerarRelatorioEmpresa,
    enviarRelatorio,
    obterPeriodo,
    montarNomeArquivo,
    dataBR
};
