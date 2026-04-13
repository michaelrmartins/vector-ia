process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const axios = require('axios');

const SITUATOR_URL = 'http://network-services-middleware-situator.intranet.local/api/v1/person/persons/active';
const IMG_SERVER = 'http://192.168.56.101:8080/web_data/images/people';
const AI_SERVICE_BASE = 'http://ai-service:5000';


// Fetches active users from Situator
async function fetchSituatorUsers(emitLog) {
    emitLog("Buscando lista de usuários ativos no Situator...");
    const credenciais = 'admin:fth67jil';
    const authBase64 = Buffer.from(credenciais).toString('base64');
    const response = await axios.get(SITUATOR_URL, {
        headers: { 'Authorization': `Basic ${authBase64}`, 'Accept': 'application/json' }
    });
    return response.data.filter(pessoa => pessoa.Active === true);
}


// Downloads photo, enriches name from ERPs, and registers one person in the AI service
async function cadastrarPessoa(pessoa, emitLog) {
    let dadosExtras = { nome: pessoa.Name };

    // ERP name enrichment (best-effort, non-blocking)
    try {
        if (pessoa.PersonType === 2) {
            emitLog(` Buscando dados no Lyceum: ${pessoa.Document}...`);
            const res = await axios.get(`http://192.168.55.9:4000/api/v1/alunos/${pessoa.Document}`);
            if (res.data && res.data.data && res.data.data.nome_compl) {
                dadosExtras.nome = res.data.data.nome_compl;
            }
        } else if (pessoa.PersonType === 1) {
            emitLog(` Buscando dados no Nasajon: ${pessoa.Document}...`);
            const res = await axios.get(`http://192.168.55.9:8082/api/trabalhadores/${pessoa.Document}`, {
                auth: { username: 'admin', password: 'fth67jil' }
            });
            if (res.data && res.data.nome) {
                dadosExtras.nome = res.data.nome;
            }
        }
    } catch (erpError) {
        emitLog(` ⚠️ Aviso: ERP falhou para ${pessoa.Document}. Usando nome do Situator.`);
    }

    emitLog(` Baixando foto UUID: ${pessoa.PersonImage}...`);
    const imgUrl = `${IMG_SERVER}/${pessoa.PersonImage}/portrait.jpg`;
    const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
    const base64Img = Buffer.from(imgRes.data, 'binary').toString('base64');

    emitLog(` Vetorizando rosto de ${dadosExtras.nome}...`);
    await axios.post(`${AI_SERVICE_BASE}/cadastrar`, {
        nome: dadosExtras.nome,
        tipo: pessoa.PersonType,
        documento: pessoa.Document,
        image: base64Img
    });
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
            emitLog("📊 Buscando usuários locais no banco de vetores...");
            const localRes = await axios.get(`${AI_SERVICE_BASE}/users`);
            const localSet = new Set(localRes.data);
            const remoteSet = new Set(pessoasAtivas.map(p => p.Document));

            const toAdd = pessoasAtivas.filter(p => !localSet.has(p.Document));
            const toRemove = [...localSet].filter(m => !remoteSet.has(m));

            emitLog(`Delta: +${toAdd.length} a adicionar | -${toRemove.length} a remover.`);

            let sucesso = 0, falhas = 0;

            for (const matricula of toRemove) {
                try {
                    await axios.delete(`${AI_SERVICE_BASE}/users/${matricula}`);
                    sucesso++;
                    emitLog(`🗑️ Removido: ${matricula}`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro ao remover ${matricula}: ${err.message}`);
                }
            }

            for (const pessoa of toAdd) {
                try {
                    await cadastrarPessoa(pessoa, emitLog);
                    sucesso++;
                    emitLog(`✅ Adicionado: ${pessoa.Name} (${pessoa.Document})`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro ao adicionar ${pessoa.Document}: ${err.message}`);
                }
            }

            emitLog(`🎉 Sincronismo Delta concluído! Operações: ${sucesso} ok | Falhas: ${falhas}`);

        } else {
            // ----------------------------------------
            // FULL SYNC: overwrite everyone
            // ----------------------------------------
            let sucesso = 0, falhas = 0;

            for (const pessoa of pessoasAtivas) {
                try {
                    await cadastrarPessoa(pessoa, emitLog);
                    sucesso++;
                    emitLog(`✅ Cadastrado: ${pessoa.Name}`);
                } catch (err) {
                    falhas++;
                    emitLog(`❌ Erro crítico ao processar ${pessoa.Document}: ${err.message}`);
                }
            }

            emitLog(`🎉 Sincronismo Full concluído! Sucessos: ${sucesso} | Falhas: ${falhas}`);
        }

    } catch (error) {
        const detalhes = error.response && error.response.data
            ? JSON.stringify(error.response.data)
            : '';
        emitLog(`🚨 Erro fatal no sincronismo: ${error.message} | ${detalhes}`);
    }
}

module.exports = { iniciarSincronismo };
