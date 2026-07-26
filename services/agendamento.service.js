const criarPushService = require("./push.service");

module.exports = (db, io) => {

    const pushService = criarPushService(db);

    function normalizarTecnicos(tecnicoRaw){
        try {
            if(Array.isArray(tecnicoRaw)) return tecnicoRaw.map(Number).filter(Boolean);

            if(typeof tecnicoRaw === "string"){
                const texto = tecnicoRaw.trim();
                if(!texto) return [];

                if(texto.startsWith("[") && texto.endsWith("]")){
                    return JSON.parse(texto).map(Number).filter(Boolean);
                }

                return texto
                    .split(",")
                    .map(v => Number(String(v).trim()))
                    .filter(Boolean);
            }

            return [];
        } catch {
            return [];
        }
    }

    async function enviarPushOSAndamento(os){
        try {
            const tecnicoIds = normalizarTecnicos(os.tecnico);

            if(!tecnicoIds.length){
                console.warn(`Push agendamento OS ${os.id} não enviado: OS sem técnico vinculado.`);
                return;
            }

            const [usuariosPush] = await db.query(`
                SELECT DISTINCT usuario_id
                FROM usuario_tecnicos
                WHERE empresa_id = ?
                AND tecnico_id IN (?)
            `, [
                os.empresa_id,
                tecnicoIds
            ]);

            if(!usuariosPush.length){
                console.warn(`Push agendamento OS ${os.id} não enviado: nenhum usuário vinculado aos técnicos.`);
                return;
            }

            for(const u of usuariosPush){
                const resultado = await pushService.enviarPushOSAndamento({
                    usuarioId: u.usuario_id,
                    empresaId: os.empresa_id,
                    osId: os.id,
                    cliente: os.nome,
                    localidade: os.localidade_nome,
                    tipoServico: os.tipo_servico_nome
                });

                console.log("🔔 Push agendamento em andamento:", {
                    os_id: os.id,
                    usuario_id: u.usuario_id,
                    resultado
                });
            }
        } catch(err){
            console.error("Erro ao enviar push de agendamento em andamento:", err);
        }
    }

    async function verificarAgendamentos() {

        try {

            const [ordens] = await db.query(`
                SELECT
                    os.id,
                    os.nome,
                    os.tecnico,
                    os.empresa_id,
                    l.nome AS localidade_nome,
                    ts.nome AS tipo_servico_nome
                FROM ordens_servico os
                LEFT JOIN localidades l
                    ON l.id = os.localidade
                    AND l.empresa_id = os.empresa_id
                LEFT JOIN tipos_servico ts
                    ON ts.id = os.tipo_servico
                WHERE
                    os.status IN ('agendado', 'reagendado')
                    AND os.agendamento_envio IS NOT NULL
                    AND os.agendamento_envio <= NOW()
            `);

            if (!ordens.length) return;

            for (const os of ordens) {

                await db.query(`
                    UPDATE ordens_servico
                    SET
                        status = 'em_andamento',
                        iniciado_em = NOW()
                    WHERE id = ?
                    AND empresa_id = ?
                `, [
                    os.id,
                    os.empresa_id
                ]);

                console.log("🚀 OS lançada automaticamente:", os.id);

                io.emit("os_andamento", {
                    os_id: os.id,
                    titulo: "🚀 Agendamento em andamento",
                    mensagem: `A OS agendada/reagendada #${os.id} entrou em andamento${os.nome ? " - " + os.nome : ""}`,
                    cliente: os.nome || ""
                });

                await enviarPushOSAndamento(os);
            }

            io.emit("os_update");

        } catch (err) {
            console.error("ERRO AGENDAMENTO:", err);
        }
    }


    // ===============================
    // 🔄 RETORNO AUTOMÁTICO DE CLIENTES AUSENTES
    // Às 18:30, OS marcadas como ausente no dia voltam para aberto.
    // ===============================
    async function verificarRetornoClientesAusentes() {
        try {
            const [resultado] = await db.query(`
                UPDATE ordens_servico
                SET
                    status = 'aberto',
                    finalizado_em = NULL,
                    finalizado_por = NULL
                WHERE status = 'cliente_ausente'
                  AND finalizado_em IS NOT NULL
                  AND DATE(finalizado_em) = CURDATE()
                  AND CURTIME() >= '18:30:00'
            `);

            if (resultado.affectedRows > 0) {
                console.log(`🔄 ${resultado.affectedRows} OS ausente(s) retornaram para aberto às 18:30.`);
                io.emit("os_update");
            }
        } catch (err) {
            console.error("ERRO AO RETORNAR CLIENTES AUSENTES:", err);
        }
    }

    verificarAgendamentos();
    verificarRetornoClientesAusentes();

    setInterval(verificarAgendamentos, 30000);
    setInterval(verificarRetornoClientesAusentes, 30000);

};
