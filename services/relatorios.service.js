const nodemailer = require("nodemailer");
const puppeteer = require("puppeteer");
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
        // Mantém a regra atual do SGOS: mês anterior completo.
        inicio = new Date(
            ref.getFullYear(),
            ref.getMonth() - 1,
            1,
            0,
            0,
            0,
            0
        );

        fim = new Date(
            ref.getFullYear(),
            ref.getMonth(),
            0,
            23,
            59,
            59,
            999
        );
    } else {
        throw new Error(`Periodicidade inválida: ${tipo}`);
    }

    return { inicio, fim };
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

function escaparHtml(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizarListaTecnicos(valor) {
    if (!valor) return [];

    if (Array.isArray(valor)) {
        return valor.map(String).map(v => v.trim()).filter(Boolean);
    }

    try {
        const parsed = JSON.parse(valor);

        if (Array.isArray(parsed)) {
            return parsed.map(String).map(v => v.trim()).filter(Boolean);
        }
    } catch (_) {}

    return [String(valor).trim()].filter(Boolean);
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
        // Compatibilidade com estruturas antigas.
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
            ON l.id = os.localidade
           AND l.empresa_id = os.empresa_id
        LEFT JOIN tipos_servico ts
            ON ts.id = os.tipo_servico
           AND ts.empresa_id = os.empresa_id
        WHERE os.empresa_id = ?
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

function criarMapa(lista, campoNome = "nome") {
    const mapa = {};

    for (const item of lista || []) {
        mapa[String(item.id)] =
            item[campoNome] ||
            item.usuario ||
            item.nome ||
            String(item.id);
    }

    return mapa;
}

function garantirGrupo(obj, chave) {
    const nome = String(chave || "NÃO INFORMADO").trim() || "NÃO INFORMADO";

    if (!obj[nome]) {
        obj[nome] = {
            abertas: 0,
            concluidas: 0
        };
    }

    return obj[nome];
}

function contabilizarRegistro(grupo, os) {
    if (os.data_abertura) grupo.abertas++;
    if (os.finalizado_em) grupo.concluidas++;
}

function prepararDados(ordens, mapaTecnicos, mapaPlanos) {
    const tecnicos = {};
    const localidades = {};
    const tipos = {};
    const instalacoes = {};
    const tiposLocalidade = {};
    const instalacoesLocalidade = {};

    for (const os of ordens || []) {
        const local = os.nome_localidade || "NÃO INFORMADO";
        const tipo = os.nome_tipo_servico || "NÃO INFORMADO";

        contabilizarRegistro(garantirGrupo(localidades, local), os);
        contabilizarRegistro(garantirGrupo(tipos, tipo), os);

        const listaTecnicos = [
            ...new Set(normalizarListaTecnicos(os.tecnico))
        ];

        for (const tecnico of listaTecnicos) {
            const nomeTecnico =
                mapaTecnicos[String(tecnico)] ||
                String(tecnico);

            if (
                !nomeTecnico ||
                nomeTecnico === "null" ||
                nomeTecnico === "undefined"
            ) {
                continue;
            }

            contabilizarRegistro(
                garantirGrupo(tecnicos, nomeTecnico),
                os
            );
        }

        const tipoUpper = String(tipo).toUpperCase();

        if (tipoUpper.includes("INSTALA")) {
            contabilizarRegistro(
                garantirGrupo(instalacoes, local),
                os
            );

            const plano =
                mapaPlanos[String(os.plano)] ||
                "";

            if (plano) {
                if (!instalacoesLocalidade[plano]) {
                    instalacoesLocalidade[plano] = {};
                }

                contabilizarRegistro(
                    garantirGrupo(
                        instalacoesLocalidade[plano],
                        local
                    ),
                    os
                );
            }
        }

        if (!tiposLocalidade[tipo]) {
            tiposLocalidade[tipo] = {};
        }

        contabilizarRegistro(
            garantirGrupo(tiposLocalidade[tipo], local),
            os
        );
    }

    return {
        tecnicos,
        localidades,
        tipos,
        instalacoes,
        tiposLocalidade,
        instalacoesLocalidade
    };
}

function ordenarGrupos(obj) {
    return Object.entries(obj || {}).sort((a, b) => {
        const totalA =
            Number(a[1]?.abertas || 0) +
            Number(a[1]?.concluidas || 0);

        const totalB =
            Number(b[1]?.abertas || 0) +
            Number(b[1]?.concluidas || 0);

        return totalB - totalA;
    });
}

function tabelaSimples(titulo, dados) {
    const linhas = ordenarGrupos(dados)
        .map(([descricao, valores]) => `
            <tr>
                <td>${escaparHtml(descricao)}</td>
                <td class="numero">${Number(valores.abertas || 0)}</td>
                <td class="numero">${Number(valores.concluidas || 0)}</td>
            </tr>
        `)
        .join("");

    return `
        <section class="bloco">
            <div class="titulo-azul">${escaparHtml(titulo)}</div>

            <table>
                <thead>
                    <tr>
                        <th>Descrição</th>
                        <th class="numero">Abertas</th>
                        <th class="numero">Concluídas</th>
                    </tr>
                </thead>

                <tbody>
                    ${
                        linhas ||
                        `
                        <tr>
                            <td colspan="3" class="vazio">
                                Nenhum registro no período
                            </td>
                        </tr>
                        `
                    }
                </tbody>
            </table>
        </section>
    `;
}

function tabelaAgrupada(titulo, dados) {
    const grupos = [];

    for (const [descricao, locais] of Object.entries(dados || {})) {
        let totalAbertas = 0;
        let totalConcluidas = 0;

        const linhas = ordenarGrupos(locais)
            .map(([localidade, valores]) => {
                const abertas = Number(valores.abertas || 0);
                const concluidas = Number(valores.concluidas || 0);

                totalAbertas += abertas;
                totalConcluidas += concluidas;

                return `
                    <tr>
                        <td>${escaparHtml(descricao)}</td>
                        <td>${escaparHtml(localidade)}</td>
                        <td class="numero">${abertas}</td>
                        <td class="numero">${concluidas}</td>
                    </tr>
                `;
            })
            .join("");

        grupos.push(`
            ${linhas}

            <tr class="total">
                <td colspan="2">
                    TOTAL = ${escaparHtml(descricao)}
                </td>
                <td class="numero">${totalAbertas}</td>
                <td class="numero">${totalConcluidas}</td>
            </tr>
        `);
    }

    return `
        <section class="bloco">
            <div class="titulo-azul">${escaparHtml(titulo)}</div>

            <table>
                <thead>
                    <tr>
                        <th>Descrição</th>
                        <th>Localidade</th>
                        <th class="numero">Abertas</th>
                        <th class="numero">Concluídas</th>
                    </tr>
                </thead>

                <tbody>
                    ${
                        grupos.join("") ||
                        `
                        <tr>
                            <td colspan="4" class="vazio">
                                Nenhum registro no período
                            </td>
                        </tr>
                        `
                    }
                </tbody>
            </table>
        </section>
    `;
}

function logoBase64(empresa) {
    if (!empresa.logo) return "";

    const arquivo = path.join(
        __dirname,
        "../uploads/logos",
        path.basename(empresa.logo)
    );

    if (!fs.existsSync(arquivo)) return "";

    try {
        const extensao =
            path.extname(arquivo).toLowerCase() === ".jpg" ||
            path.extname(arquivo).toLowerCase() === ".jpeg"
                ? "jpeg"
                : "png";

        const conteudo = fs.readFileSync(arquivo).toString("base64");

        return `data:image/${extensao};base64,${conteudo}`;
    } catch (_) {
        return "";
    }
}

function textoPeriodo(tipo, inicio, fim) {
    if (tipo === "diario") return dataBR(inicio);
    return `${dataBR(inicio)} a ${dataBR(fim)}`;
}

function montarHtml({
    empresa,
    tipo,
    inicio,
    fim,
    dados
}) {
    const logo = logoBase64(empresa);

    return `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">

    <style>
        @page {
            size: A4;
            margin: 10mm;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            font-size: 9px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .cabecalho {
            min-height: 76px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 1px solid #dbe3ef;
            padding-bottom: 9px;
            margin-bottom: 10px;
        }

        .empresa {
            max-width: 72%;
        }

        .empresa h1 {
            margin: 0 0 6px;
            font-size: 15px;
            color: #111827;
        }

        .empresa p {
            margin: 0 0 3px;
            line-height: 1.25;
        }

        .logo {
            max-width: 115px;
            max-height: 58px;
            object-fit: contain;
        }

        .periodo {
            margin-bottom: 12px;
            line-height: 1.35;
        }

        .periodo strong {
            color: #0f172a;
        }

        .bloco {
            margin-bottom: 9px;
            break-inside: avoid;
        }

        .titulo-azul {
            background: #0066cc;
            color: #ffffff;
            padding: 5px 7px;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }

        thead {
            display: table-header-group;
        }

        tr {
            break-inside: avoid;
        }

        th,
        td {
            padding: 4px 7px;
            border-bottom: 1px solid #edf1f7;
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
        }

        th {
            font-size: 8px;
            color: #111827;
            font-weight: 700;
            background: #f8fafc;
        }

        td {
            font-size: 8px;
        }

        .numero {
            text-align: right;
            width: 72px;
        }

        .total td {
            font-weight: 700;
            background: #f8fafc;
            border-top: 1px solid #dbe3ef;
            padding-top: 5px;
            padding-bottom: 5px;
        }

        .vazio {
            text-align: center;
            color: #64748b;
            padding: 10px;
        }

        .rodape {
            margin-top: 8px;
            padding-top: 7px;
            border-top: 1px solid #e5e7eb;
            color: #64748b;
            text-align: center;
            font-size: 7px;
        }
    </style>
</head>

<body>
    <header class="cabecalho">
        <div class="empresa">
            <h1>${escaparHtml(nomeEmpresa(empresa))}</h1>

            <p>
                <strong>CNPJ/CPF:</strong>
                ${escaparHtml(empresa.cnpj || empresa.cpf || "-")}
            </p>

            <p>
                <strong>Telefone:</strong>
                ${escaparHtml(empresa.telefone || "-")}
            </p>

            <p>
                <strong>Email:</strong>
                ${escaparHtml(empresa.email || "-")}
            </p>

            ${
                empresa.endereco
                    ? `
                    <p>
                        <strong>Endereço:</strong>
                        ${escaparHtml(empresa.endereco)}
                    </p>
                    `
                    : ""
            }
        </div>

        ${
            logo
                ? `<img class="logo" src="${logo}" alt="Logo da empresa">`
                : ""
        }
    </header>

    <div class="periodo">
        <div>
            <strong>Período:</strong>
            ${escaparHtml(textoPeriodo(tipo, inicio, fim))}
        </div>

        <div>
            <strong>Gerado em:</strong>
            ${escaparHtml(dataHoraBR())}
        </div>
    </div>

    ${tabelaSimples("TÉCNICOS", dados.tecnicos)}
    ${tabelaSimples("LOCALIDADES", dados.localidades)}
    ${tabelaSimples("TIPOS DE SERVIÇO", dados.tipos)}
    ${tabelaSimples(
        "INSTALAÇÕES POR LOCALIDADE",
        dados.instalacoes
    )}

    ${tabelaAgrupada(
        "TIPOS DE SERVIÇOS POR LOCALIDADE",
        dados.tiposLocalidade
    )}

    ${tabelaAgrupada(
        "PLANOS DAS INSTALAÇÕES POR LOCALIDADE",
        dados.instalacoesLocalidade
    )}

    <div class="rodape">
        SGOS - Sistema de Gestão de Ordens de Serviço
    </div>
</body>
</html>
    `;
}

async function gerarPdfComPuppeteer(html) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath:
                process.env.PUPPETEER_EXECUTABLE_PATH ||
                process.env.CHROME_PATH ||
                undefined,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
        });

        const page = await browser.newPage();

        await page.setContent(html, {
            waitUntil: "networkidle0",
            timeout: 60000
        });

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: "10mm",
                right: "10mm",
                bottom: "10mm",
                left: "10mm"
            }
        });

        return Buffer.from(pdf);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function gerarRelatorioEmpresa(
    pool,
    empresaId,
    tipo = "diario",
    referencia = new Date()
) {
    const empresa = await buscarEmpresa(pool, empresaId);
    const { inicio, fim } = obterPeriodo(tipo, referencia);

    const [
        ordens,
        tecnicos,
        planos
    ] = await Promise.all([
        buscarOrdens(pool, empresaId, inicio, fim),
        buscarTecnicos(pool, empresaId),
        buscarPlanos(pool, empresaId)
    ]);

    const mapaTecnicos = criarMapa(tecnicos);
    const mapaPlanos = criarMapa(planos);

    const dados = prepararDados(
        ordens,
        mapaTecnicos,
        mapaPlanos
    );

    const filename = montarNomeArquivo(
        tipo,
        inicio,
        fim,
        empresa
    );

    const html = montarHtml({
        empresa,
        tipo,
        inicio,
        fim,
        dados
    });

    const buffer = await gerarPdfComPuppeteer(html);

    if (!buffer || buffer.length < 100) {
        throw new Error("PDF automático vazio ou inválido");
    }

    return {
        buffer,
        filename,
        empresa,
        inicio,
        fim,
        dados,
        totalOrdens: ordens.length
    };
}

function criarTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
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
        throw new Error("E-mail de destino não informado");
    }

    const buffer =
        Buffer.isBuffer(pdf)
            ? pdf
            : pdf?.buffer;

    if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
        throw new Error("PDF vazio ou inválido");
    }

    const transporter = criarTransporter();

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
                contentType: "application/pdf"
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
