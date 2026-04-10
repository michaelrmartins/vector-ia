const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { registrarNoLyceum } = require('./lyceum');
// const { registrarNoNasajon } = require('./nasajon'); // <-- NASAJON IMPORTADO AQUI!
const { iniciarSincronismo } = require('./sync');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());

io.on('connection', (socket) => {
    console.log('Capture terminal connected:', socket.id);

    socket.on('processar_frame', async (data) => {
        try {
            const aiResponse = await axios.post('http://ai-service:5000/recognize', {
                image: data.image
            });

            // 1. SUCESSO: A IA cravou que é a pessoa (match: true)
            if (aiResponse.data.match) {
                const { matricula, nome, tipo, confidence, box } = aiResponse.data;
                
                // Valor padrão caso algum ERP esteja fora do ar (Fallback Seguro)
                let detalhesExibicao = tipo === 1 ? 'Funcionário' : 'Aluno';

                try {
                    // BUSCA DE DADOS EM TEMPO REAL NOS ERPS PARA EXIBIR NA TELA
                    if (tipo === 1) {
                        console.log(`💼 Sincronizando Funcionário no Nasajon: ${matricula}`);
                        
                        // Busca os dados reais do funcionário
                        const dadosFunc = await registrarNoNasajon(matricula);
                        
                        // Pegando o departamento que você comentou!
                        if (dadosFunc && dadosFunc.departamento) {
                            detalhesExibicao = dadosFunc.departamento; // Ex: "TI - Infraestrutura"
                        }
                        
                    } else if (tipo === 2) {
                        console.log(`🎓 Sincronizando Aluno no Lyceum: ${matricula}`);
                        
                        // Busca os dados reais do aluno
                        const dadosAluno = await registrarNoLyceum(matricula);
                        
                        // Faz a concatenação do aluno (Ex: Medicina - 3º Período)
                        if (dadosAluno && dadosAluno.nome_curso && dadosAluno.nome_serie) {
                            detalhesExibicao = `${dadosAluno.nome_curso} - ${dadosAluno.nome_serie}`;
                        }
                    }
                } catch (erpError) {
                    // Se o Lyceum ou Nasajon derem Erro, o código avisa no log, 
                    // mas NÃO trava a tela! Mantém o "detalhesExibicao" como 'Aluno' ou 'Funcionário'.
                    console.log(`⚠️ Aviso ERP: Não foi possível buscar detalhes de ${matricula} (${erpError.message})`);
                }

                // EMITE PARA A TELA INSTANTANEAMENTE
                socket.emit('presenca_confirmada', {
                    nome: nome,
                    curso: detalhesExibicao, // <--- Aqui vai aparecer o Departamento ou o Curso/Período!
                    status: 'Acesso Liberado ✅',
                    box: box,
                    confidence: confidence
                });

            } 
            // 2. ANALISANDO: Se achou um rosto, mas a confiança não bateu a nota de corte
            else if (aiResponse.data.box) {
                socket.emit('rosto_detectado', { box: aiResponse.data.box });
            }

        } catch (error) {
            console.error("Erro no fluxo de reconhecimento:", error.message);
        }
    });
});

// Rota para disparar o gatilho do ETL
app.post('/api/sincronizar', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    
    // Dispara a função em background
    iniciarSincronismo(io); 
    
    res.status(200).json({ message: "Sincronismo iniciado em background!" });
});

server.listen(3000, () => {
    console.log('Node.js orchestrator running on port 3000');
});