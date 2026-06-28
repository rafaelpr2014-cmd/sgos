module.exports = (db, io) => {

    async function verificarAgendamentos() {

        try {

            const [ordens] = await db.query(`
                SELECT id
                FROM ordens_servico
                WHERE
                    status = 'agendado'
                    AND agendamento_envio IS NOT NULL
                    AND agendamento_envio <= NOW()
            `);

            if (!ordens.length) return;

            for (const os of ordens) {

                await db.query(`
                    UPDATE ordens_servico
                    SET
                        status = 'em_andamento',
                        iniciado_em = NOW()
                    WHERE id = ?
                `, [os.id]);

                console.log("🚀 OS lançada automaticamente:", os.id);
            }

            io.emit("os_update");

        } catch (err) {
            console.error("ERRO AGENDAMENTO:", err);
        }
    }

    setInterval(verificarAgendamentos, 30000);

};