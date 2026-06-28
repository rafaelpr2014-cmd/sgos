// services/log.service.js

module.exports = (db) => {

    // ===============================
    // REGISTRAR LOG
    // ===============================
    async function registrarLog(

        req,
        acao,
        modulo,
        referenciaId = null,
        detalhes = null

    ){

        try {

            // usuário
            const usuario =
                req?.usuario?.usuario
                || "desconhecido";

            let detalhesFormatado = "-";

            // ===========================
            // OBJETO
            // ===========================
            if (
                detalhes &&
                typeof detalhes === "object"
            ){

                detalhesFormatado =

                    Object.entries(detalhes)

                    // remove vazios
                    .filter(([_, valor]) => {

                        return (
                            valor !== undefined &&
                            valor !== null &&
                            valor !== ""
                        );
                    })

                    // formata
                    .map(([chave, valor]) => {

                        // array
                        if(Array.isArray(valor)){

                            valor =
                                valor.join(", ");
                        }

                        return `${chave}: ${valor}`;
                    })

                    // junta
                    .join(" | ");
            }

            // ===========================
            // TEXTO NORMAL
            // ===========================
            else if (
                typeof detalhes === "string"
            ){

                detalhesFormatado =
                    detalhes;
            }

            // ===========================
            // INSERT
            // ===========================
            await db.query(`

                INSERT INTO logs_acoes (

                    usuario,
                    acao,
                    modulo,
                    referencia_id,
                    detalhes

                ) VALUES (?, ?, ?, ?, ?)

            `, [

                usuario,
                acao || "-",
                modulo || "-",
                referenciaId || null,
                detalhesFormatado
            ]);

        } catch (err) {

            console.error(
                "❌ ERRO LOG:",
                err
            );
        }
    }

    return {
        registrarLog
    };
};