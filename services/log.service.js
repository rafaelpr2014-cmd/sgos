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

            const usuario =
                req?.usuario?.usuario
                || "desconhecido";

            const empresaId =
                Number(req?.usuario?.empresa_id || 0);

            // Evita gravar logs sem vínculo de empresa.
            if (!empresaId) {
                console.error(
                    "❌ LOG IGNORADO: empresa_id não encontrado.",
                    {
                        usuario,
                        acao,
                        modulo,
                        referenciaId
                    }
                );

                return;
            }

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

                        if (Array.isArray(valor)) {
                            valor = valor.join(", ");
                        }

                        if (
                            valor &&
                            typeof valor === "object"
                        ) {
                            try {
                                valor = JSON.stringify(valor);
                            } catch {
                                valor = String(valor);
                            }
                        }

                        return `${chave}: ${valor}`;
                    })

                    // junta
                    .join(" | ");

                if (!detalhesFormatado) {
                    detalhesFormatado = "-";
                }
            }

            // ===========================
            // TEXTO NORMAL
            // ===========================
            else if (
                typeof detalhes === "string"
            ){
                detalhesFormatado =
                    detalhes.trim() || "-";
            }

            // ===========================
            // INSERT
            // ===========================
            await db.query(`

                INSERT INTO logs_acoes (

                    empresa_id,
                    usuario,
                    acao,
                    modulo,
                    referencia_id,
                    detalhes,
                    created_at

                ) VALUES (?, ?, ?, ?, ?, ?, NOW())

            `, [

                empresaId,
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
