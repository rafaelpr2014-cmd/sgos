// ===============================
// 🔑 PERMISSÕES (blindado)
function obterPermissoes(req, res, next) {

    if (req.usuario.cargo === "Administrador") {
        req.permissoes = { localidades: [], tecnicos: [], isAdmin: true };
        return next();
    }

    db.query(
        "SELECT localidade_id FROM usuario_localidades WHERE usuario_id = ?",
        [req.usuario.id],
        (err, localidades) => {

            if (err) return res.status(500).json(err);

            db.query(
                "SELECT tecnico_id FROM usuario_tecnicos WHERE usuario_id = ?",
                [req.usuario.id],
                (err, tecnicos) => {

                    if (err) return res.status(500).json(err);

                    req.permissoes = {
                        localidades: localidades.map(l => String(l.localidade_id)),
                        tecnicos: tecnicos.map(t => String(t.tecnico_id)),
                        isAdmin: false
                    };

                    next();
                }
            );
        }
    );
}
