const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { iniciarSincronismo } = require('./sync');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());

// ==========================================
// Webhook: Python AI service -> Node.js (Server Push)
// Receives identity data and broadcasts to all frontends immediately.
// NO ERP logic here — pure identity relay.
// ==========================================
app.post('/api/webhook/rosto_detectado', (req, res) => {
    const { nome, tipo, documento, confidence, box, frame_width, frame_height } = req.body;

    if (!nome || !documento) {
        return res.status(400).json({ error: 'Payload inválido. Esperado: nome, documento.' });
    }

    io.emit('presenca_confirmada', {
        nome,
        tipo,
        documento,
        confidence,
        box,
        frame_width,
        frame_height
    });

    res.status(200).json({ message: 'Presença emitida com sucesso.' });
});

// ==========================================
// Socket fallback: manual frame from tablet/terminal (stateless)
// ==========================================
io.on('connection', (socket) => {
    console.log('Capture terminal connected:', socket.id);

    socket.on('processar_frame', async (data) => {
        try {
            const aiResponse = await axios.post('http://ai-service:5000/recognize', {
                image: data.image
            });

            if (aiResponse.data.match) {
                const { nome, tipo, documento, confidence, box } = aiResponse.data;
                io.emit('presenca_confirmada', { nome, tipo, documento, confidence, box });
            } else if (aiResponse.data.box) {
                io.emit('rosto_detectado', { box: aiResponse.data.box });
            }
        } catch (error) {
            console.error('Erro no fluxo de reconhecimento (socket):', error.message);
        }
    });
});

// ==========================================
// ETL Sync routes
// ==========================================
app.post('/api/sincronizar', (req, res) => {
    const mode = (req.body && req.body.mode) || 'full';
    iniciarSincronismo(io, mode);
    res.status(200).json({ message: `Sincronismo (${mode}) iniciado em background!` });
});

app.post('/api/limpar-base', async (req, res) => {
    try {
        await axios.delete('http://ai-service:5000/database/wipe');
        io.emit('sync_log', '🗑️ Base de dados limpa com sucesso.');
        res.status(200).json({ message: 'Base limpa com sucesso.' });
    } catch (error) {
        const msg = `❌ Erro ao limpar base: ${error.message}`;
        io.emit('sync_log', msg);
        res.status(500).json({ error: error.message });
    }
});

server.listen(3000, () => {
    console.log('Node.js orchestrator running on port 3000');
});
