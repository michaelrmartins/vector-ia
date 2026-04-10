process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const axios = require('axios');

const SITUATOR_URL = 'http://network-services-middleware-situator.intranet.local/api/v1/person/persons/active';
const IMG_SERVER = 'http://192.168.56.101:8080/web_data/images/people';
const AI_SERVICE = 'http://ai-service:5000/cadastrar';

// Recebemos o 'io' como parâmetro para enviar os logs para a tela
async function iniciarSincronismo(io) {
    const emitLog = (msg) => {
        console.log(msg);
        if (io) io.emit('sync_log', msg);
    };

try {
        emitLog("Buscando lista de usuários ativos no Situator...");
        
        const credenciais = 'admin:fth67jil'; // <-- Ajuste suas senhas
        const authBase64 = Buffer.from(credenciais).toString('base64');
        
        const response = await axios.get(SITUATOR_URL, {
            headers: {
                'Authorization': `Basic ${authBase64}`,
                'Accept': 'application/json'
            }
        });
        
        // === O FILTRO DE ATIVOS ENTRA AQUI ===
        const pessoasAtivas = response.data.filter(pessoa => pessoa.Active === true);
        
        // Limita a 5 para o teste (pegando apenas os ativos)
        const pessoas = pessoasAtivas.slice(0, 5); 
        emitLog(`Total de ativos no Situator: ${pessoasAtivas.length}. Processando: ${pessoas.length} neste teste.`);

        let sucesso = 0;
        let falhas = 0;

        for (const pessoa of pessoas) {
            try {
                // FALLBACK GARANTIDO: Já começamos com o nome que vem do Situator!
                let dadosExtras = { nome: pessoa.Name, matricula: pessoa.Document };
                
                // Tenta enriquecer/validar com os ERPs (isolado num try/catch)
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
                            auth: { username: 'admin', password: 'fth67jil' } // <-- Ajuste aqui
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
                await axios.post(AI_SERVICE, {
                    matricula: dadosExtras.matricula,
                    nome: dadosExtras.nome,
                    image: base64Img
                });

                sucesso++;
                emitLog(`✅ Cadastrado com sucesso: ${dadosExtras.nome}`);

            } catch (err) {
                falhas++;
                emitLog(`❌ Erro crítico ao processar documento ${pessoa.Document}: ${err.message}`);
            }
        }
        // ... restante do código (emitLog final e catch global)

        emitLog(`🎉 Sincronismo concluído! Sucessos: ${sucesso} | Falhas: ${falhas}`);

    } catch (error) {
        // Pega os detalhes da rejeição do servidor, se existirem
        const detalhes = error.response && error.response.data 
            ? JSON.stringify(error.response.data) 
            : '';
            
        emitLog(`🚨 Erro fatal no sincronismo: ${error.message} | ${detalhes}`);
    }
}

module.exports = { iniciarSincronismo };