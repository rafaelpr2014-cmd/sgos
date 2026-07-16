const express = require("express");
const router = express.Router();
const db = require("../database");

function verificarAutenticacao(req, res, next){
    const usuarioId = Number(req.headers["x-usuario-id"]);

    if(!Number.isInteger(usuarioId) || usuarioId <= 0){
        return res.status(401).json({ erro:"Não autorizado" });
    }

    req.usuarioId = usuarioId;
    next();
}

async function obterEmpresaId(usuarioId){
    const [[usuario]] = await db.query(
        "SELECT empresa_id FROM usuarios WHERE id = ? LIMIT 1",
        [usuarioId]
    );

    if(!usuario?.empresa_id){
        const erro = new Error("Usuário ou empresa não encontrados");
        erro.status = 401;
        throw erro;
    }

    return usuario.empresa_id;
}

function normalizarPeriodo(valor){
    return String(valor || "").trim().toUpperCase();
}

function normalizarFeriado(valor){
    return valor === true ||
           valor === 1 ||
           valor === "1" ||
           String(valor || "").trim().toUpperCase() === "SIM"
        ? 1
        : 0;
}

function validarDataIso(valor){
    const data = String(valor || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "";
}

function montarDadosEscala(body){
    const tecnicoId = Number(body?.tecnico_id);
    const dataEscala = validarDataIso(body?.data_escala);
    const periodo = normalizarPeriodo(body?.periodo);
    const feriado = normalizarFeriado(body?.feriado);
    const observacaoFeriado = feriado
        ? String(body?.observacao_feriado || "").trim()
        : "";

    const periodosPermitidos = ["MANHA", "TARDE", "NOITE", "INTEGRAL"];

    if(!Number.isInteger(tecnicoId) || tecnicoId <= 0){
        return { erro:"Técnico inválido" };
    }

    if(!dataEscala){
        return { erro:"Data inválida" };
    }

    if(!periodosPermitidos.includes(periodo)){
        return { erro:"Período inválido" };
    }

    if(feriado && !observacaoFeriado){
        return { erro:"Informe a observação do feriado" };
    }

    return {
        tecnicoId,
        dataEscala,
        periodo,
        feriado,
        observacaoFeriado: observacaoFeriado || null
    };
}

router.get("/", verificarAutenticacao, async (req, res) => {
    try{
        const empresaId = await obterEmpresaId(req.usuarioId);

        const [rows] = await db.query(`
            SELECT
                e.id,
                e.tecnico_id,
                t.nome AS tecnico,
                e.data_escala,
                e.periodo,
                COALESCE(e.feriado, 0) AS feriado,
                e.observacao_feriado,
                e.empresa_id
            FROM escalas e
            INNER JOIN tecnicos t
                ON t.id = e.tecnico_id
               AND t.empresa_id = e.empresa_id
            WHERE e.empresa_id = ?
            ORDER BY e.data_escala ASC, t.nome ASC, e.periodo ASC
        `, [empresaId]);

        return res.json(rows);

    }catch(err){
        console.error("Erro ao carregar escalas:", err);
        return res.status(err.status || 500).json({
            erro: err.status ? err.message : "Erro ao carregar escalas"
        });
    }
});

router.post("/", verificarAutenticacao, async (req, res) => {
    try{
        const empresaId = await obterEmpresaId(req.usuarioId);
        const dados = montarDadosEscala(req.body);

        if(dados.erro){
            return res.status(400).json({ erro:dados.erro });
        }

        const [[tecnico]] = await db.query(
            "SELECT id FROM tecnicos WHERE id = ? AND empresa_id = ? LIMIT 1",
            [dados.tecnicoId, empresaId]
        );

        if(!tecnico){
            return res.status(404).json({ erro:"Técnico não encontrado" });
        }

        const [resultado] = await db.query(`
            INSERT INTO escalas
                (tecnico_id, data_escala, periodo, feriado, observacao_feriado, empresa_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            dados.tecnicoId,
            dados.dataEscala,
            dados.periodo,
            dados.feriado,
            dados.observacaoFeriado,
            empresaId
        ]);

        return res.status(201).json({
            success:true,
            id:resultado.insertId
        });

    }catch(err){
        console.error("Erro ao adicionar escala:", err);
        return res.status(err.status || 500).json({
            erro: err.status ? err.message : "Erro ao adicionar escala"
        });
    }
});

router.put("/:id", verificarAutenticacao, async (req, res) => {
    try{
        const id = Number(req.params.id);
        const empresaId = await obterEmpresaId(req.usuarioId);
        const dados = montarDadosEscala(req.body);

        if(!Number.isInteger(id) || id <= 0){
            return res.status(400).json({ erro:"ID da escala inválido" });
        }

        if(dados.erro){
            return res.status(400).json({ erro:dados.erro });
        }

        const [[tecnico]] = await db.query(
            "SELECT id FROM tecnicos WHERE id = ? AND empresa_id = ? LIMIT 1",
            [dados.tecnicoId, empresaId]
        );

        if(!tecnico){
            return res.status(404).json({ erro:"Técnico não encontrado" });
        }

        const [resultado] = await db.query(`
            UPDATE escalas
               SET tecnico_id = ?,
                   data_escala = ?,
                   periodo = ?,
                   feriado = ?,
                   observacao_feriado = ?
             WHERE id = ?
               AND empresa_id = ?
        `, [
            dados.tecnicoId,
            dados.dataEscala,
            dados.periodo,
            dados.feriado,
            dados.observacaoFeriado,
            id,
            empresaId
        ]);

        if(!resultado.affectedRows){
            return res.status(404).json({ erro:"Escala não encontrada" });
        }

        return res.json({ success:true, id });

    }catch(err){
        console.error("Erro ao editar escala:", err);
        return res.status(err.status || 500).json({
            erro: err.status ? err.message : "Erro ao editar escala"
        });
    }
});

router.delete("/:id", verificarAutenticacao, async (req, res) => {
    try{
        const id = Number(req.params.id);
        const empresaId = await obterEmpresaId(req.usuarioId);

        if(!Number.isInteger(id) || id <= 0){
            return res.status(400).json({ erro:"ID da escala inválido" });
        }

        const [resultado] = await db.query(
            "DELETE FROM escalas WHERE id = ? AND empresa_id = ?",
            [id, empresaId]
        );

        if(!resultado.affectedRows){
            return res.status(404).json({ erro:"Escala não encontrada" });
        }

        return res.json({ success:true });

    }catch(err){
        console.error("Erro ao excluir escala:", err);
        return res.status(err.status || 500).json({
            erro: err.status ? err.message : "Erro ao excluir escala"
        });
    }
});

module.exports = router;
