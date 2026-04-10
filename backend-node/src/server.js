const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { registrarNoLyceum } = require('./lyceum');
const { iniciarSincronismo } = require('./sync');

// Quando você criar o arquivo para bater no Nasajon, basta importar aqui:
// const { registrarNoNasajon } = require('./nasajon');

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
                // Pegamos todos os dados turbinados que o Python agora devolve
                const { matricula, nome, tipo, confidence, box } = aiResponse.data;
                
                // A. FEEDBACK VISUAL INSTANTÂNEO (Usando o nome local, sem depender do ERP)
                socket.emit('presenca_confirmada', {
                    nome: nome,
                    curso: tipo === 1 ? 'Funcionário (Nasajon)' : 'Aluno (Lyceum)', 
                    status: 'Acesso Liberado ✅',
                    box: box,
                    confidence: confidence
                });

                // B. ROTEAMENTO DE ERP EM BACKGROUND (Não trava o fluxo da tela!)
                if (tipo === 1) {
                    console.log(`💼 Funcionário detectado. Sincronizando com Nasajon: ${matricula}`);
                    
                    // Quando a função do Nasajon estiver pronta, é só descomentar:
                    // registrarNoNasajon(matricula)
                    //     .catch(err => console.log(`Aviso ERP: Falha no Nasajon (${matricula}) - ${err.message}`));
                        
                } else if (tipo === 2) {
                    console.log(`🎓 Aluno detectado. Sincronizando com Lyceum: ${matricula}`);
                    
                    registrarNoLyceum(matricula)
                        .catch(err => console.log(`Aviso ERP: Falha no Lyceum (${matricula}) - ${err.message}`));
                }
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

// Nova rota para disparar o gatilho do ETL
app.post('/api/sincronizar', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    
    // Dispara a função em background passando a instância do WebSocket (io)
    iniciarSincronismo(io); 
    
    // Devolve uma resposta rápida para a interface não ficar travada esperando
    res.status(200).json({ message: "Sincronismo iniciado em background!" });
});

server.listen(3000, () => {
    console.log('Node.js orchestrator running on port 3000');
});