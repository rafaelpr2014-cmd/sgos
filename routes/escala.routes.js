const express = require("express");
const router = express.Router();
const db = require("../database");

function normalizarPeriodo(valor){
    return String(valor || "").trim().toUpperCase();
}

function normalizarTipoPessoa(valor){
    const tipo = String(valor || "TECNICO").trim().toUpperCase();
    return ["TECNICO", "ATENDENTE"].includes(tipo) ? tipo : "";
}

function normalizarFeriado(valor){
    return valor === true || valor === 1 || valor === "1" ||
        String(valor || "").trim().toUpperCase() === "SIM" ? 1 : 0;
}

function validarDataIso(valor){
    const data = String(valor || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : "";
}

async function garantirEstruturaEscala(){
    const [colunas] = await db.query(`
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'escalas'
          AND COLUMN_NAME IN ('tecnico_id','usuario_id','pessoa_tipo')
    `);

    const mapa = new Map(colunas.map(c => [c.COLUMN_NAME, c]));
    const tecnico = mapa.get("tecnico_id");

    if(!tecnico){
        throw new Error("A coluna tecnico_id não existe na tabela escalas");
    }

    // Mantém exatamente o mesmo tipo usado por tecnico_id, evitando conflito
    // com chaves estrangeiras ou com bancos que usam INT em vez de BIGINT.
    const tipoId = String(tecnico.COLUMN_TYPE || "INT").replace(/[^a-zA-Z0-9(), ]/g, "");

    if(!mapa.has("usuario_id")){
        await db.query(`ALTER TABLE escalas ADD COLUMN usuario_id ${tipoId} NULL AFTER tecnico_id`);
    }

    if(!mapa.has("pessoa_tipo")){
        await db.query(`
            ALTER TABLE escalas
            ADD COLUMN pessoa_tipo VARCHAR(20) NOT NULL DEFAULT 'TECNICO' AFTER usuario_id
        `);
    }

    if(tecnico.IS_NULLABLE === "NO"){
        await db.query(`ALTER TABLE escalas MODIFY tecnico_id ${tipoId} NULL`);
    }
}

function montarDadosEscala(body){
    const pessoaTipo = normalizarTipoPessoa(body?.pessoa_tipo || body?.tipo_pessoa || "TECNICO");
    const pessoaId = Number(body?.pessoa_id || (pessoaTipo === "ATENDENTE" ? body?.usuario_id : body?.tecnico_id));
    const dataEscala = validarDataIso(body?.data_escala);
    const periodo = normalizarPeriodo(body?.periodo);
    const feriado = normalizarFeriado(body?.feriado);
    const observacaoFeriado = feriado ? String(body?.observacao_feriado || "").trim() : "";

    if(!pessoaTipo) return { erro:"Tipo de pessoa inválido" };
    if(!Number.isInteger(pessoaId) || pessoaId <= 0) return { erro:"Pessoa inválida" };
    if(!dataEscala) return { erro:"Data inválida" };
    if(!["MANHA","TARDE","NOITE","INTEGRAL"].includes(periodo)) return { erro:"Período inválido" };
    if(feriado && !observacaoFeriado) return { erro:"Informe a observação do feriado" };

    return { pessoaTipo, pessoaId, dataEscala, periodo, feriado, observacaoFeriado: observacaoFeriado || null };
}

async function validarPessoa(dados, empresaId){
    if(dados.pessoaTipo === "TECNICO"){
        const [[row]] = await db.query(
            "SELECT id FROM tecnicos WHERE id = ? AND empresa_id = ? AND ativo = 1 LIMIT 1",
            [dados.pessoaId, empresaId]
        );
        return !!row;
    }

    const [[row]] = await db.query(`
        SELECT id FROM usuarios
        WHERE id = ? AND empresa_id = ? AND ativo = 1
          AND LOWER(TRIM(cargo)) = 'atendente'
        LIMIT 1
    `, [dados.pessoaId, empresaId]);
    return !!row;
}

router.use(async (req, res, next) => {
    try{
        await garantirEstruturaEscala();
        if(!req.usuario?.id || !req.usuario?.empresa_id){
            return res.status(401).json({ erro:"Não autenticado" });
        }
        next();
    }catch(err){
        console.error("Erro ao preparar estrutura de escalas:", err);
        res.status(500).json({ erro:"Erro ao preparar estrutura de escalas" });
    }
});

router.get("/", async (req, res) => {
    try{
        const empresaId = Number(req.usuario.empresa_id);
        const [rows] = await db.query(`
            SELECT e.id, e.tecnico_id, e.usuario_id,
                   COALESCE(e.pessoa_tipo, 'TECNICO') AS pessoa_tipo,
                   COALESCE(t.nome, u.usuario) AS pessoa_nome,
                   t.nome AS tecnico,
                   u.usuario AS atendente,
                   e.data_escala, e.periodo,
                   COALESCE(e.feriado, 0) AS feriado,
                   e.observacao_feriado, e.empresa_id
            FROM escalas e
            LEFT JOIN tecnicos t
              ON t.id = e.tecnico_id AND t.empresa_id = e.empresa_id
            LEFT JOIN usuarios u
              ON u.id = e.usuario_id AND u.empresa_id = e.empresa_id
            WHERE e.empresa_id = ?
            ORDER BY e.data_escala ASC, pessoa_nome ASC, e.periodo ASC
        `, [empresaId]);
        res.json(rows);
    }catch(err){
        console.error("Erro ao carregar escalas:", err);
        res.status(500).json({ erro:"Erro ao carregar escalas" });
    }
});

router.post("/", async (req, res) => {
    try{
        const empresaId = Number(req.usuario.empresa_id);
        const dados = montarDadosEscala(req.body);
        if(dados.erro) return res.status(400).json({ erro:dados.erro });
        if(!(await validarPessoa(dados, empresaId))) return res.status(404).json({ erro:"Técnico ou atendente não encontrado" });

        const tecnicoId = dados.pessoaTipo === "TECNICO" ? dados.pessoaId : null;
        const usuarioId = dados.pessoaTipo === "ATENDENTE" ? dados.pessoaId : null;
        const [resultado] = await db.query(`
            INSERT INTO escalas
                (tecnico_id, usuario_id, pessoa_tipo, data_escala, periodo, feriado, observacao_feriado, empresa_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [tecnicoId, usuarioId, dados.pessoaTipo, dados.dataEscala, dados.periodo, dados.feriado, dados.observacaoFeriado, empresaId]);
        res.status(201).json({ success:true, id:resultado.insertId });
    }catch(err){
        console.error("Erro ao adicionar escala:", err);
        res.status(500).json({ erro:"Erro ao adicionar escala" });
    }
});

router.put("/:id", async (req, res) => {
    try{
        const id = Number(req.params.id);
        const empresaId = Number(req.usuario.empresa_id);
        const dados = montarDadosEscala(req.body);
        if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro:"ID da escala inválido" });
        if(dados.erro) return res.status(400).json({ erro:dados.erro });
        if(!(await validarPessoa(dados, empresaId))) return res.status(404).json({ erro:"Técnico ou atendente não encontrado" });

        const tecnicoId = dados.pessoaTipo === "TECNICO" ? dados.pessoaId : null;
        const usuarioId = dados.pessoaTipo === "ATENDENTE" ? dados.pessoaId : null;
        const [resultado] = await db.query(`
            UPDATE escalas SET tecnico_id=?, usuario_id=?, pessoa_tipo=?, data_escala=?, periodo=?,
                feriado=?, observacao_feriado=?
            WHERE id=? AND empresa_id=?
        `, [tecnicoId, usuarioId, dados.pessoaTipo, dados.dataEscala, dados.periodo, dados.feriado, dados.observacaoFeriado, id, empresaId]);
        if(!resultado.affectedRows) return res.status(404).json({ erro:"Escala não encontrada" });
        res.json({ success:true, id });
    }catch(err){
        console.error("Erro ao editar escala:", err);
        res.status(500).json({ erro:"Erro ao editar escala" });
    }
});

router.delete("/:id", async (req, res) => {
    try{
        const id = Number(req.params.id);
        const empresaId = Number(req.usuario.empresa_id);
        if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro:"ID da escala inválido" });
        const [resultado] = await db.query("DELETE FROM escalas WHERE id=? AND empresa_id=?", [id, empresaId]);
        if(!resultado.affectedRows) return res.status(404).json({ erro:"Escala não encontrada" });
        res.json({ success:true });
    }catch(err){
        console.error("Erro ao excluir escala:", err);
        res.status(500).json({ erro:"Erro ao excluir escala" });
    }
});

module.exports = router;
