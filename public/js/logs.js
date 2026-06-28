// logs.js
module.exports = function criarLogs(db) {
    return {
        registrar: (usuarioId, usuarioNome, tabela, acao, descricao) => {
            const sql = `
                INSERT INTO logs (usuario_id, usuario_nome, tabela_afetada, acao, descricao)
                VALUES (?, ?, ?, ?, ?)
            `;
            db.query(sql, [usuarioId, usuarioNome, tabela, acao, descricao], (err) => {
                if (err) console.error('Erro ao registrar log:', err.message);
            });
        }
    };
};