const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { registrarNoLyceum } = require('./lyceum');
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

            const { matricula, confidence, box } = aiResponse.data;

            if (matricula && confidence > 0.6) {
                const dadosAluno = await registrarNoLyceum(matricula);

                socket.emit('presenca_confirmada', {
                    nome: dadosAluno.nome_compl,
                    curso: dadosAluno.nome_curso,
                    status: 'Sucesso',
                    box: box,
                    confidence: confidence
                });
            }
        } catch (error) {
            console.error('Recognition flow error:', error.message);
        }
    });
});

// Nova rota para disparar o gatilho
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
