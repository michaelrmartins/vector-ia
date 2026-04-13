process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // dev: Situator uses self-signed cert

const axios = require('axios');

const SITUATOR_URL = 'http://network-services-middleware-situator.intranet.local/api/v1/person/persons/active';
const IMG_SERVER = 'http://192.168.56.101:8080/web_data/images/people';
const AI_SERVICE_BASE = 'http://ai-service:5000';


// Fetches active users from Situator
async function fetchSituatorUsers(emitLog) {
    emitLog(`[DEBUG] GET ${SITUATOR_URL}`);
    const credenciais = 'admin:fth67jil';
    const authBase64 = Buffer.from(credenciais).toString('base64');

    let response;
    try {
        response = await axios.get(SITUATOR_URL, {
            headers: { 'Authorization': `Basic ${authBase64}`, 'Accept': 'application/json' }
        });
    } catch (err) {
        const status = err.response ? err.response.status : 'N/A';
        const body   = err.response ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
        emitLog(`[DEBUG] Situator request failed — HTTP ${status} | ${body}`);
        throw err;
    }

    emitLog(`[DEBUG] Situator respondeu HTTP ${response.status} | total registros: ${response.data.length}`);

    if (!Array.isArray(response.data)) {
        emitLog(`[DEBUG] ATENÇÃO: resposta não é um array — tipo: ${typeof response.data} | amostra: ${JSON.stringify(response.data).slice(0, 200)}`);
        throw new Error('Resposta do Situator não é um array.');
    }

    const ativos = response.data.filter(p => p.Active === true);
    emitLog(`[DEBUG] Registros ativos (Active=true): ${ativos.length} de ${response.data.length}`);

    if (ativos.length > 0) {
        emitLog(`[DEBUG] Amostra do primeiro registro: ${JSON.stringify(ativos[0]).slice(0, 300)}`);
    }

    return ativos;
}


// Downloads photo from Situator and registers the person in the AI service
async function cadastrarPessoa(pessoa, emitLog) {
    if (!pessoa.PersonImage) {
        emitLog(` [DEBUG] Pulando ${pessoa.Document} (${pessoa.Name}) — PersonImage é null.`);
        return;
    }

    const imgUrl = `${IMG_SERVER}/${pessoa.PersonImage}/portrait.jpg`;
    emitLog(` [DEBUG] Baixando foto: ${imgUrl}`);

    let imgRes;
    try {
        imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
    } catch (err) {
        const status = err.response ? err.response.status : err.message;
        emitLog(` [DEBUG] Falha ao baixar foto de ${pessoa.Name} — ${status}`);
        throw err;
    }

    const sizeKb = (imgRes.data.byteLength / 1024).toFixed(1);
    emitLog(` [DEBUG] Foto OK (${sizeKb} KB). Enviando para /cadastrar...`);

    // Buffer.from without encoding — arraybuffer is already binary, no re-encoding needed
    const base64Img = Buffer.from(imgRes.data).toString('base64');

    let aiRes;
    try {
        aiRes = await axios.post(`${AI_SERVICE_BASE}/cadastrar`, {
            nome: pessoa.Name,
            tipo: pessoa.PersonType,
            documento: pessoa.Document,
            image: base64Img
        });
    } catch (err) {
        const status  = err.response ? err.response.status : 'N/A';
        const body    = err.response ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
        emitLog(` [DEBUG] /cadastrar falhou para ${pessoa.Document} — HTTP ${status} | ${body}`);
        throw err;
    }

    emitLog(` [DEBUG] /cadastrar OK para ${pessoa.Document} — ${JSON.stringify(aiRes.data)}`);
}


async function iniciarSincronismo(io, mode = 'full') {
    const emitLog = (msg) => {
        console.log(msg);
        if (io) io.emit('sync_log', msg);
    };

    try {
        emitLog(`==================================================`);
        emitLog(`🚀 INICIANDO SINCRONISMO (modo: ${mode.toUpperCase()})`);
        emitLog(`==================================================`);

        const pessoasAtivas = await fetchSituatorUsers(emitLog);
        emitLog(`Total de ativos no Situator: ${pessoasAtivas.length}.`);

        if (mode === 'delta') {
            // ----------------------------------------
            // DELTA SYNC: only add new, remove deleted
            // ----------------------------------------
            emitLog(`[DEBUG] GET ${AI_SERVICE_BASE}/users`);
            let localRes;
            try {
                localRes = await axios.get(`${AI_SERVICE_BASE}/users`);
            } catch (err) {
                const status = err.response ? err.response.status : err.message;
                emitLog(`[DEBUG] Falha ao buscar /users — ${status}`);
                throw err;
            }
            emitLog(`[DEBUG] /users respondeu ${localRes.status} | ${localRes.data.length} documentos locais`);

            const localSet  = new Set(localRes.data);
            const remoteSet = new Set(pessoasAtivas.map(p => p.Document));

            const toAdd    = pessoasAtivas.filter(p => !localSet.has(p.Document));
            const toRemove = [...localSet].filter(m => !remoteSet.has(m));

            emitLog(`Delta: +${toAdd.length} a adicionar | -${toRemove.length} a remover.`);

            let sucesso = 0, falhas = 0;

            for (const doc of toRemove) {
                try {
                    await axios.delete(`${AI_SERVICE_BASE}/users/${doc}`);
                    sucesso++;
                    emitLog(`🗑️ Removido: ${doc}`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro ao remover ${doc}: ${err.message}`);
                }
            }

            let pulados = 0;
            for (const pessoa of toAdd) {
                if (!pessoa.PersonImage) { pulados++; continue; }
                try {
                    await cadastrarPessoa(pessoa, emitLog);
                    sucesso++;
                    emitLog(`✅ Adicionado: ${pessoa.Name} (${pessoa.Document})`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro ao adicionar ${pessoa.Document}: ${err.message}`);
                }
            }

            emitLog(`🎉 Sincronismo Delta concluído! Adicionados: ${sucesso} | Removidos: ${toRemove.length} | Pulados: ${pulados} | Falhas: ${falhas}`);

        } else {
            // ----------------------------------------
            // FULL SYNC: overwrite everyone
            // ----------------------------------------
            let sucesso = 0, falhas = 0, pulados = 0;

            for (const pessoa of pessoasAtivas) {
                if (!pessoa.PersonImage) { pulados++; continue; }
                try {
                    await cadastrarPessoa(pessoa, emitLog);
                    sucesso++;
                    emitLog(`✅ Cadastrado: ${pessoa.Name}`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro crítico ao processar ${pessoa.Document}: ${err.message}`);
                }
            }

            emitLog(`🎉 Sincronismo Full concluído! Sucessos: ${sucesso} | Pulados: ${pulados} | Falhas: ${falhas}`);
        }

    } catch (error) {
        const detalhes = error.response && error.response.data
            ? JSON.stringify(error.response.data)
            : '';
        emitLog(`🚨 Erro fatal no sincronismo: ${error.message} | ${detalhes}`);
    }
}

module.exports = { iniciarSincronismo };
