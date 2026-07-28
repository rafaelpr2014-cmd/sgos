const express = require("express");
const router = express.Router();
const pool = require("../database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, path.join(__dirname, "../uploads/logos"));
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname || "").toLowerCase();
        cb(null, `logo_${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

const uploadLogos = upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "logo_alternativa", maxCount: 1 }
]);

function inteiroOuNull(valor) {
    if (valor === undefined || valor === null || valor === "") return null;
    const numero = Number(valor);
    return Number.isInteger(numero) ? numero : null;
}

function booleanoBanco(valor, padrao = 0) {
    if (valor === undefined || valor === null || valor === "") return padrao;
    return [1, "1", true, "true", "on"].includes(valor) ? 1 : 0;
}

function textoOuNull(valor) {
    if (valor === undefined || valor === null) return null;
    const texto = String(valor).trim();
    return texto || null;
}

function normalizarPeriodicidades(valor) {
    if (!valor) return null;

    let lista = valor;
    if (typeof lista === "string") {
        try {
            lista = JSON.parse(lista);
        } catch {
            lista = lista.split(",");
        }
    }

    if (!Array.isArray(lista)) return null;

    const permitidas = ["diario", "semanal", "mensal"];
    const normalizadas = [...new Set(
        lista
            .map(item => String(item).trim().toLowerCase())
            .filter(item => permitidas.includes(item))
    )];

    return normalizadas.length ? JSON.stringify(normalizadas) : null;
}

async function obterEmpresaDoUsuario(req) {
    const usuarioId = req.headers["x-usuario-id"];
    if (!usuarioId) return null;

    const [rows] = await pool.query(
        "SELECT id, empresa_id FROM usuarios WHERE id = ? LIMIT 1",
        [usuarioId]
    );

    return rows[0] || null;
}

// Somente usuários vinculados à empresa 1 podem administrar empresas.
async function somenteEmpresaAdministradora(req, res, next) {
    try {
        const usuario = await obterEmpresaDoUsuario(req);

        if (!usuario) {
            return res.status(401).json({ erro: "Usuário não autenticado." });
        }

        if (Number(usuario.empresa_id) !== 1) {
            return res.status(403).json({
                erro: "Acesso restrito. Somente a empresa administradora pode gerenciar empresas."
            });
        }

        req.usuarioEmpresa = usuario;
        next();
    } catch (err) {
        console.error("Erro ao validar empresa administradora:", err);
        return res.status(500).json({ erro: "Erro ao validar permissão." });
    }
}

// Dados da empresa do usuário logado. Esta rota continua disponível para todas
// as empresas, pois é usada no cabeçalho e na geração dos PDFs.
router.get("/", async (req, res) => {
    try {
        const usuario = await obterEmpresaDoUsuario(req);
        if (!usuario) return res.status(401).json({ erro: "Usuário não autenticado." });

        const [rows] = await pool.query(`
            SELECT
                id,
                nome_provedor,
                nome_fantasia,
                razao_social,
                nome_completo,
                cpf,
                cnpj,
                email,
                telefone,
                endereco,
                cidade,
                estado,
                logo,
                logo_alternativa
            FROM empresa
            WHERE id = ?
            LIMIT 1
        `, [usuario.empresa_id]);

        return res.json(rows[0] || {});
    } catch (err) {
        console.error("Erro ao buscar empresa do usuário:", err);
        return res.status(500).json({ erro: "Erro ao buscar empresa." });
    }
});

router.get("/listar", somenteEmpresaAdministradora, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM empresa ORDER BY id DESC");
        return res.json(rows);
    } catch (err) {
        console.error("Erro ao listar empresas:", err);
        return res.status(500).json({ erro: "Erro ao listar empresas." });
    }
});

router.post("/toggle/:id", somenteEmpresaAdministradora, async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query(`
            UPDATE empresa
            SET ativo = IF(ativo = 1, 0, 1)
            WHERE id = ?
        `, [id]);

        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Empresa não encontrada." });
        }

        return res.json({ sucesso: true });
    } catch (err) {
        console.error("Erro ao alterar status da empresa:", err);
        return res.status(500).json({ erro: "Erro ao alterar status." });
    }
});

router.get("/:id", somenteEmpresaAdministradora, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM empresa WHERE id = ? LIMIT 1",
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ erro: "Empresa não encontrada." });
        return res.json(rows[0]);
    } catch (err) {
        console.error("Erro ao buscar empresa:", err);
        return res.status(500).json({ erro: "Erro ao buscar empresa." });
    }
});

router.post("/", somenteEmpresaAdministradora, uploadLogos, async (req, res) => {
    try {
        const periodicidades = normalizarPeriodicidades(req.body.relatorio_periodicidades);
        const relatorioAtivo = booleanoBanco(req.body.relatorio_ativo);

        if (relatorioAtivo && !periodicidades) {
            return res.status(400).json({ erro: "Selecione pelo menos uma periodicidade." });
        }

        const metodo = textoOuNull(req.body.relatorio_envio_tipo);
        if (metodo && !["email", "whatsapp", "ambos"].includes(metodo)) {
            return res.status(400).json({ erro: "Método de envio inválido." });
        }

        const logo = req.files?.logo?.[0]?.filename || null;
        const logoAlternativa = req.files?.logo_alternativa?.[0]?.filename || null;

        const [result] = await pool.query(`
            INSERT INTO empresa (
                cpf, nome_completo, nome_provedor,
                cnpj, nome_fantasia, razao_social,
                pessoa_fisica, pessoa_juridica,
                email, telefone,
                cep, cidade, estado, endereco,
                subdominio, plano_empresa,
                vencimento, prazo, ativo, logo, logo_alternativa,
                relatorio_envio_tipo, relatorio_email, relatorio_telefone,
                relatorio_usar_email_cadastrado,
                relatorio_usar_telefone_cadastrado,
                relatorio_dia_semana, relatorio_dia_mes,
                relatorio_ativo, relatorio_periodicidades, relatorio_horario
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            textoOuNull(req.body.cpf),
            textoOuNull(req.body.nome_completo),
            textoOuNull(req.body.nome_provedor),
            textoOuNull(req.body.cnpj),
            textoOuNull(req.body.nome_fantasia),
            textoOuNull(req.body.razao_social),
            booleanoBanco(req.body.pessoa_fisica),
            booleanoBanco(req.body.pessoa_juridica),
            textoOuNull(req.body.email),
            textoOuNull(req.body.telefone),
            textoOuNull(req.body.cep),
            textoOuNull(req.body.cidade),
            textoOuNull(req.body.estado),
            textoOuNull(req.body.endereco),
            textoOuNull(req.body.subdominio),
            textoOuNull(req.body.plano_empresa),
            inteiroOuNull(req.body.vencimento),
            textoOuNull(req.body.prazo),
            booleanoBanco(req.body.ativo, 1),
            logo,
            logoAlternativa,
            metodo,
            textoOuNull(req.body.relatorio_email),
            textoOuNull(req.body.relatorio_telefone),
            booleanoBanco(req.body.relatorio_usar_email_cadastrado, 1),
            booleanoBanco(req.body.relatorio_usar_telefone_cadastrado, 1),
            inteiroOuNull(req.body.relatorio_dia_semana),
            inteiroOuNull(req.body.relatorio_dia_mes),
            relatorioAtivo,
            periodicidades,
            textoOuNull(req.body.relatorio_horario) || "08:00:00"
        ]);

        return res.status(201).json({ sucesso: true, id: result.insertId });
    } catch (err) {
        console.error("Erro ao cadastrar empresa:", err);
        return res.status(500).json({ erro: "Erro ao cadastrar empresa." });
    }
});

router.put("/:id", somenteEmpresaAdministradora, uploadLogos, async (req, res) => {
    try {
        const { id } = req.params;
        const periodicidades = normalizarPeriodicidades(req.body.relatorio_periodicidades);
        const relatorioAtivo = booleanoBanco(req.body.relatorio_ativo);

        if (relatorioAtivo && !periodicidades) {
            return res.status(400).json({ erro: "Selecione pelo menos uma periodicidade." });
        }

        const metodo = textoOuNull(req.body.relatorio_envio_tipo);
        if (metodo && !["email", "whatsapp", "ambos"].includes(metodo)) {
            return res.status(400).json({ erro: "Método de envio inválido." });
        }

        const [rows] = await pool.query(
            "SELECT logo, logo_alternativa FROM empresa WHERE id = ? LIMIT 1",
            [id]
        );

        if (!rows.length) return res.status(404).json({ erro: "Empresa não encontrada." });

        const logoAntiga = rows[0].logo;
        const logoAlternativaAntiga = rows[0].logo_alternativa;

        const novaLogo = req.files?.logo?.[0]?.filename || logoAntiga;
        const novaLogoAlternativa =
            req.files?.logo_alternativa?.[0]?.filename || logoAlternativaAntiga;

        const [result] = await pool.query(`
            UPDATE empresa SET
                cpf=?, nome_completo=?, nome_provedor=?,
                cnpj=?, nome_fantasia=?, razao_social=?,
                pessoa_fisica=?, pessoa_juridica=?,
                email=?, telefone=?,
                cep=?, cidade=?, estado=?, endereco=?,
                subdominio=?, plano_empresa=?,
                vencimento=?, prazo=?, ativo=?, logo=?, logo_alternativa=?,
                relatorio_envio_tipo=?, relatorio_email=?, relatorio_telefone=?,
                relatorio_usar_email_cadastrado=?,
                relatorio_usar_telefone_cadastrado=?,
                relatorio_dia_semana=?, relatorio_dia_mes=?,
                relatorio_ativo=?, relatorio_periodicidades=?, relatorio_horario=?
            WHERE id=?
        `, [
            textoOuNull(req.body.cpf),
            textoOuNull(req.body.nome_completo),
            textoOuNull(req.body.nome_provedor),
            textoOuNull(req.body.cnpj),
            textoOuNull(req.body.nome_fantasia),
            textoOuNull(req.body.razao_social),
            booleanoBanco(req.body.pessoa_fisica),
            booleanoBanco(req.body.pessoa_juridica),
            textoOuNull(req.body.email),
            textoOuNull(req.body.telefone),
            textoOuNull(req.body.cep),
            textoOuNull(req.body.cidade),
            textoOuNull(req.body.estado),
            textoOuNull(req.body.endereco),
            textoOuNull(req.body.subdominio),
            textoOuNull(req.body.plano_empresa),
            inteiroOuNull(req.body.vencimento),
            textoOuNull(req.body.prazo),
            booleanoBanco(req.body.ativo, 1),
            novaLogo,
            novaLogoAlternativa,
            metodo,
            textoOuNull(req.body.relatorio_email),
            textoOuNull(req.body.relatorio_telefone),
            booleanoBanco(req.body.relatorio_usar_email_cadastrado, 1),
            booleanoBanco(req.body.relatorio_usar_telefone_cadastrado, 1),
            inteiroOuNull(req.body.relatorio_dia_semana),
            inteiroOuNull(req.body.relatorio_dia_mes),
            relatorioAtivo,
            periodicidades,
            textoOuNull(req.body.relatorio_horario) || "08:00:00",
            id
        ]);

        if (!result.affectedRows) {
            return res.status(404).json({ erro: "Empresa não encontrada." });
        }

        if (req.files?.logo?.[0] && logoAntiga && logoAntiga !== novaLogo) {
            const caminhoAntigo = path.join(__dirname, "../uploads/logos", logoAntiga);
            if (fs.existsSync(caminhoAntigo)) {
                fs.unlink(caminhoAntigo, err => {
                    if (err) console.error("Erro ao remover logo antiga:", err);
                });
            }
        }



        if (
            req.files?.logo_alternativa?.[0] &&
            logoAlternativaAntiga &&
            logoAlternativaAntiga !== novaLogoAlternativa
        ) {
            const caminhoAlternativoAntigo = path.join(
                __dirname,
                "../uploads/logos",
                logoAlternativaAntiga
            );

            if (fs.existsSync(caminhoAlternativoAntigo)) {
                fs.unlink(caminhoAlternativoAntigo, err => {
                    if (err) console.error("Erro ao remover logo alternativa antiga:", err);
                });
            }
        }

        return res.json({ sucesso: true });
    } catch (err) {
        console.error("Erro ao atualizar empresa:", err);
        return res.status(500).json({ erro: "Erro ao atualizar empresa." });
    }
});

router.delete("/:id", somenteEmpresaAdministradora, async (req, res) => {
    try {
        const { id } = req.params;

        // Evita excluir a própria empresa administradora por acidente.
        if (Number(id) === 1) {
            return res.status(400).json({ erro: "A empresa administradora não pode ser removida." });
        }

        const [rows] = await pool.query(
            "SELECT logo, logo_alternativa FROM empresa WHERE id = ? LIMIT 1",
            [id]
        );

        if (!rows.length) return res.status(404).json({ erro: "Empresa não encontrada." });

        const [result] = await pool.query("DELETE FROM empresa WHERE id = ?", [id]);
        if (!result.affectedRows) return res.status(404).json({ erro: "Empresa não encontrada." });

        const logo = rows[0].logo;
        if (logo) {
            const caminho = path.join(__dirname, "../uploads/logos", logo);
            if (fs.existsSync(caminho)) {
                fs.unlink(caminho, err => {
                    if (err) console.error("Erro ao remover logo:", err);
                });
            }
        }

        const logoAlternativa = rows[0].logo_alternativa;
        if (logoAlternativa) {
            const caminhoAlternativo = path.join(
                __dirname,
                "../uploads/logos",
                logoAlternativa
            );

            if (fs.existsSync(caminhoAlternativo)) {
                fs.unlink(caminhoAlternativo, err => {
                    if (err) console.error("Erro ao remover logo alternativa:", err);
                });
            }
        }

        return res.json({ sucesso: true });
    } catch (err) {
        console.error("Erro ao remover empresa:", err);
        return res.status(500).json({ erro: "Erro ao remover empresa." });
    }
});

module.exports = router;
