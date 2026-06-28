// =======================
// 🔹 CRONOGRAMA (100% SEGURO)
app.put('/api/cronograma/:id', verificarAutenticacao, (req, res) => {
    db.query(`
        UPDATE cronograma_semana 
        SET equipe=?, tipo_servico=?, periodo=?, cidade_id=?, data=?
        WHERE id=? AND empresa_id=?
    `,
    [
        JSON.stringify(req.body.equipe),
        req.body.tipo_servico,
        req.body.periodo,
        req.body.cidade_id,
        req.body.data,
        req.params.id,
        req.usuario.empresa_id
    ],
    () => res.json({ ok: true })
    );
});

app.delete('/api/cronograma/:id', verificarAutenticacao, (req, res) => {
    db.query(
        "DELETE FROM cronograma_semana WHERE id=? AND empresa_id=?",
        [req.params.id, req.usuario.empresa_id],
        () => res.json({ ok: true })
    );
});

PUT /api/cronograma/:id
DELETE /api/cronograma/:id