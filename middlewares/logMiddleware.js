module.exports = (logService) => {

    return (acao, modulo) => {

        return async (req, res, next) => {

            const originalJson = res.json;

            res.json = async function (data) {

                try {

                    // só loga se deu certo
                    if (res.statusCode < 400) {

                        await logService.registrarLog(
                            req,
                            acao,
                            modulo,
                            data?.id || null
                        );
                    }

                } catch (err) {
                    console.error("LOG MIDDLEWARE ERROR:", err);
                }

                return originalJson.call(this, data);
            };

            next();
        };
    };
};