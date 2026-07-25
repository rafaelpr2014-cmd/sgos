async function registrarLogAcao(pool, {
    empresa_id,
    usuario,
    acao,
    modulo,
    referencia_id = null,
    detalhes = null
}){
    const empresaId = Number(empresa_id || 0);

    if(!empresaId){
        throw new Error("empresa_id é obrigatório para registrar log de ação");
    }

    await pool.query(`
        INSERT INTO logs_acoes
            (empresa_id,usuario,acao,modulo,referencia_id,detalhes,created_at)
        VALUES
            (?,?,?,?,?,?,NOW())
    `,[
        empresaId,
        usuario || "Sistema",
        acao || "AÇÃO NÃO INFORMADA",
        modulo || "GERAL",
        referencia_id,
        detalhes
    ]);
}

module.exports = registrarLogAcao;
