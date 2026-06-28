function filtrarPermissao(req, res, next) {

    try {

        const permissoes = req.permissoes || {
            localidades: [],
            tecnicos: [],
            isAdmin: true
        };

        if (permissoes.isAdmin) {
            req.filtroPermissao = "";
            return next();
        }

        const localidades = permissoes.localidades || [];
        const tecnicos = permissoes.tecnicos || [];

        let filtros = [];

        // se não tem permissão nenhuma → bloqueia
        if (!localidades.length && !tecnicos.length) {
            req.filtroPermissao = "AND 1 = 0";
            return next();
        }

        if (localidades.length) {
            filtros.push(`os.localidade IN (${localidades.join(",")})`);
        }

        if (tecnicos.length) {

            const tecnicosCond = tecnicos
                .map(id =>
                    `FIND_IN_SET(${id}, REPLACE(REPLACE(os.tecnico,'[',''),']',''))`
                )
                .join(" OR ");

            filtros.push(`(${tecnicosCond})`);
        }

        req.filtroPermissao = filtros.length
            ? `AND (${filtros.join(" AND ")})`
            : "";

        next();

    } catch (err) {
        console.error("ERRO FILTRO PERMISSAO:", err);
        return res.status(500).json({ erro: "Erro interno de permissões" });
    }
}

module.exports = { filtrarPermissao };