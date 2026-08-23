module.exports = (pool, verificarAutenticacao) => {
    const express = require("express");
    const router = express.Router();

    const dataValida = valor => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));


    const cacheEnderecos = new Map();

    const coordenadaValida = (lat, lon) => {
        const latitude = Number(lat);
        const longitude = Number(lon);
        return Number.isFinite(latitude) && Number.isFinite(longitude)
            && latitude >= -90 && latitude <= 90
            && longitude >= -180 && longitude <= 180;
    };

    async function reverseGeocode(latitude, longitude){
        const chave = `${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
        const cache = cacheEnderecos.get(chave);
        if(cache && (Date.now() - cache.em) < 24 * 60 * 60 * 1000){
            return cache.endereco;
        }

        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.searchParams.set("format","jsonv2");
        url.searchParams.set("lat",String(latitude));
        url.searchParams.set("lon",String(longitude));
        url.searchParams.set("zoom","18");
        url.searchParams.set("addressdetails","1");

        const resposta = await fetch(url, {
            headers: {
                "User-Agent": "SGOS/1.0 mapa-tecnicos",
                "Accept-Language": "pt-BR,pt;q=0.9"
            },
            signal: AbortSignal.timeout(7000)
        });

        if(!resposta.ok){
            throw new Error(`Geocodificação HTTP ${resposta.status}`);
        }

        const dados = await resposta.json();
        const endereco = String(dados?.display_name || "").trim();
        if(!endereco) throw new Error("Endereço não encontrado para as coordenadas.");

        cacheEnderecos.set(chave,{endereco,em:Date.now()});

        if(cacheEnderecos.size > 1000){
            const primeira = cacheEnderecos.keys().next().value;
            if(primeira) cacheEnderecos.delete(primeira);
        }

        return endereco;
    }

    router.get("/endereco", verificarAutenticacao, async (req,res) => {
        try{
            const lat = Number(req.query.lat);
            const lon = Number(req.query.lon);

            if(!coordenadaValida(lat,lon)){
                return res.status(400).json({erro:"Coordenadas GPS inválidas."});
            }

            const endereco = await reverseGeocode(lat,lon);
            res.json({ok:true,endereco,latitude:lat,longitude:lon});
        }catch(err){
            console.error("MAPA TÉCNICOS / ENDEREÇO GPS:",err);
            res.status(502).json({
                erro:"Não foi possível consultar o endereço real do GPS.",
                detalhe:err.message
            });
        }
    });

    router.get("/usuarios", verificarAutenticacao, async (req,res) => {
        try{
            const empresaId = Number(req.usuario.empresa_id);

            const [rows] = await pool.query(`
                SELECT DISTINCT
                    u.id,
                    u.usuario AS usuario_nome,
                    GROUP_CONCAT(DISTINCT t.nome ORDER BY t.nome SEPARATOR ', ') AS tecnico_nome
                FROM ordens_servico os
                INNER JOIN usuarios u
                    ON u.empresa_id = os.empresa_id
                   AND u.id IN (os.checkin_inicio_por, os.checkin_fim_por)
                LEFT JOIN usuario_tecnicos ut
                    ON ut.empresa_id = u.empresa_id
                   AND ut.usuario_id = u.id
                LEFT JOIN tecnicos t
                    ON t.empresa_id = ut.empresa_id
                   AND t.id = ut.tecnico_id
                WHERE os.empresa_id = ?
                  AND (os.checkin_inicio_em IS NOT NULL OR os.checkin_fim_em IS NOT NULL)
                GROUP BY u.id,u.usuario
                ORDER BY u.usuario
            `,[empresaId]);

            res.json({ok:true,usuarios:rows});
        }catch(err){
            console.error("MAPA TÉCNICOS / USUÁRIOS:",err);
            res.status(500).json({erro:err.message});
        }
    });

    router.get("/pontos", verificarAutenticacao, async (req,res) => {
        try{
            const empresaId = Number(req.usuario.empresa_id);
            const inicio = dataValida(req.query.inicio) ? req.query.inicio : new Date().toISOString().slice(0,10);
            const fim = dataValida(req.query.fim) ? req.query.fim : inicio;
            const usuarioId = Number(req.query.usuario_id || 0);

            const paramsInicio = [empresaId,inicio,fim];
            const paramsFim = [empresaId,inicio,fim];
            let filtroInicio = "";
            let filtroFim = "";

            if(usuarioId > 0){
                filtroInicio = " AND os.checkin_inicio_por = ? ";
                filtroFim = " AND COALESCE(os.checkin_fim_por,os.finalizado_por) = ? ";
                paramsInicio.push(usuarioId);
                paramsFim.push(usuarioId);
            }

            const [inicioRows] = await pool.query(`
                SELECT
                    os.id AS os_id,
                    DATE(os.checkin_inicio_em) AS dia,
                    os.checkin_inicio_em AS momento,
                    'checkin_inicio' AS tipo_ponto,
                    CAST(os.checkin_inicio_latitude AS DECIMAL(11,8)) AS latitude,
                    CAST(os.checkin_inicio_longitude AS DECIMAL(11,8)) AS longitude,
                    os.checkin_inicio_precisao AS precisao,
                    os.checkin_inicio_por AS usuario_id,
                    u.usuario AS usuario_nome,
                    GROUP_CONCAT(DISTINCT t.nome ORDER BY t.nome SEPARATOR ', ') AS tecnico_nome,
                    os.nome AS cliente,
                    COALESCE(l.nome,CAST(os.localidade AS CHAR)) AS localidade_nome,
                    CONCAT_WS(', ',
                        NULLIF(TRIM(os.rua),''),
                        NULLIF(TRIM(os.n),''),
                        NULLIF(TRIM(os.bairro),'')
                    ) AS endereco
                FROM ordens_servico os
                LEFT JOIN usuarios u
                    ON u.id=os.checkin_inicio_por
                   AND u.empresa_id=os.empresa_id
                LEFT JOIN usuario_tecnicos ut
                    ON ut.usuario_id=u.id
                   AND ut.empresa_id=u.empresa_id
                LEFT JOIN tecnicos t
                    ON t.id=ut.tecnico_id
                   AND t.empresa_id=ut.empresa_id
                LEFT JOIN localidades l
                    ON CAST(l.id AS CHAR)=CAST(os.localidade AS CHAR)
                   AND l.empresa_id=os.empresa_id
                WHERE os.empresa_id=?
                  AND os.checkin_inicio_em >= CONCAT(?,' 00:00:00')
                  AND os.checkin_inicio_em < DATE_ADD(CONCAT(?,' 00:00:00'),INTERVAL 1 DAY)
                  AND os.checkin_inicio_latitude IS NOT NULL
                  AND os.checkin_inicio_longitude IS NOT NULL
                  ${filtroInicio}
                GROUP BY
                    os.id,os.checkin_inicio_em,os.checkin_inicio_latitude,
                    os.checkin_inicio_longitude,os.checkin_inicio_precisao,
                    os.checkin_inicio_por,u.usuario,os.nome,l.nome,os.localidade,
                    os.rua,os.n,os.bairro
            `,paramsInicio);

            const [fimRows] = await pool.query(`
                SELECT
                    os.id AS os_id,
                    DATE(COALESCE(os.checkin_fim_em,os.finalizado_em)) AS dia,
                    COALESCE(os.checkin_fim_em,os.finalizado_em) AS momento,
                    'checkin_fim' AS tipo_ponto,
                    CAST(os.checkin_fim_latitude AS DECIMAL(11,8)) AS latitude,
                    CAST(os.checkin_fim_longitude AS DECIMAL(11,8)) AS longitude,
                    os.checkin_fim_precisao AS precisao,
                    COALESCE(os.checkin_fim_por,os.finalizado_por) AS usuario_id,
                    u.usuario AS usuario_nome,
                    GROUP_CONCAT(DISTINCT t.nome ORDER BY t.nome SEPARATOR ', ') AS tecnico_nome,
                    os.nome AS cliente,
                    COALESCE(l.nome,CAST(os.localidade AS CHAR)) AS localidade_nome,
                    CONCAT_WS(', ',
                        NULLIF(TRIM(os.rua),''),
                        NULLIF(TRIM(os.n),''),
                        NULLIF(TRIM(os.bairro),'')
                    ) AS endereco
                FROM ordens_servico os
                LEFT JOIN usuarios u
                    ON u.id=COALESCE(os.checkin_fim_por,os.finalizado_por)
                   AND u.empresa_id=os.empresa_id
                LEFT JOIN usuario_tecnicos ut
                    ON ut.usuario_id=u.id
                   AND ut.empresa_id=u.empresa_id
                LEFT JOIN tecnicos t
                    ON t.id=ut.tecnico_id
                   AND t.empresa_id=ut.empresa_id
                LEFT JOIN localidades l
                    ON CAST(l.id AS CHAR)=CAST(os.localidade AS CHAR)
                   AND l.empresa_id=os.empresa_id
                WHERE os.empresa_id=?
                  AND COALESCE(os.checkin_fim_em,os.finalizado_em) >= CONCAT(?,' 00:00:00')
                  AND COALESCE(os.checkin_fim_em,os.finalizado_em) < DATE_ADD(CONCAT(?,' 00:00:00'),INTERVAL 1 DAY)
                  AND os.checkin_fim_latitude IS NOT NULL
                  AND os.checkin_fim_longitude IS NOT NULL
                  ${filtroFim}
                GROUP BY
                    os.id,os.checkin_fim_em,os.finalizado_em,
                    os.checkin_fim_latitude,os.checkin_fim_longitude,
                    os.checkin_fim_precisao,os.checkin_fim_por,os.finalizado_por,
                    u.usuario,os.nome,l.nome,os.localidade,os.rua,os.n,os.bairro
            `,paramsFim);

            const paramsDuracao = [empresaId,inicio,fim];
            let filtroDuracao = "";
            if(usuarioId > 0){
                filtroDuracao = " AND os.checkin_inicio_por = ? ";
                paramsDuracao.push(usuarioId);
            }

            const [duracoes] = await pool.query(`
                SELECT
                    os.id AS os_id,
                    os.tempo_atendimento_segundos
                FROM ordens_servico os
                WHERE os.empresa_id=?
                  AND os.checkin_inicio_em >= CONCAT(?,' 00:00:00')
                  AND os.checkin_inicio_em < DATE_ADD(CONCAT(?,' 00:00:00'),INTERVAL 1 DAY)
                  AND os.tempo_atendimento_segundos IS NOT NULL
                  ${filtroDuracao}
            `,paramsDuracao);

            const pontos=[...inicioRows,...fimRows]
                .map(p=>({...p,latitude:Number(p.latitude),longitude:Number(p.longitude)}))
                .filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))
                .sort((a,b)=>new Date(a.momento)-new Date(b.momento));

            res.json({
                ok:true,
                periodo:{inicio,fim},
                total:pontos.length,
                pontos,
                os_duracoes:duracoes
            });
        }catch(err){
            console.error("MAPA TÉCNICOS / PONTOS:",err);
            res.status(500).json({erro:err.message});
        }
    });

    return router;
};