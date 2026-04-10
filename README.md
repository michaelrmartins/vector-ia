# Facial Recognition Attendance System

A real-time facial recognition system for automated student attendance tracking, built with a microservices architecture using Docker.

## Architecture

```
Webcam → Frontend (HTML/JS) → Backend (Node.js/Socket.io) → AI Service (Python/Flask)
                                        ↓                            ↓
                                  Lyceum API                  PostgreSQL + pgVector
```

| Service | Technology | Port | Description |
|---------|-----------|------|-------------|
| **web-app** | HTML5, JavaScript, Socket.io | 8080 | Camera capture terminal with real-time face overlay |
| **backend-node** | Node.js, Express, Socket.io | 3000 | Orchestration server connecting frontend, AI, and Lyceum |
| **ai-service** | Python, Flask, face_recognition | 5000 | Face detection, encoding, and vector similarity search |
| **db** | PostgreSQL + pgvector | 5432 | Stores student data and 128-dim facial embeddings |

## How It Works

1. The frontend captures webcam frames every 2 seconds and sends them via WebSocket
2. The backend forwards the image to the AI service
3. The AI service detects faces, extracts a 128-dimensional embedding, and searches for the closest match in PostgreSQL using pgvector
4. If confidence > 60%, the backend fetches student details from the Lyceum API
5. The frontend displays the student's name, course, and a bounding box overlay on the detected face

## Prerequisites

- Docker & Docker Compose
- Access to the Lyceum student management API (configured in `backend-node/src/lyceum.js`)

## Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd vector-ia

# Start all services
docker compose up --build

# Access the application
open http://localhost:8080
```

## API Endpoints

### AI Service (`localhost:5000`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/recognize` | Recognize a face from a base64 image |
| POST | `/cadastrar` | Register a new student with their face |

#### Register a Student

```bash
curl -X POST http://localhost:5000/cadastrar \
  -H "Content-Type: application/json" \
  -d '{"matricula": "12345", "nome": "John Doe", "image": "<base64-image>"}'
```

## Project Structure

```
vector-ia/
├── docker-compose.yaml
├── init-db/
│   └── init.sql              # Database schema (pgvector)
├── ai-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py                # Face recognition service
├── backend-node/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js          # WebSocket orchestration server
│       └── lyceum.js          # Lyceum API integration
└── web-app/
    ├── Dockerfile
    └── src/
        └── index.html         # Camera capture terminal
```

## Tech Stack

- **Face Recognition**: [face_recognition](https://github.com/ageitgey/face_recognition) (dlib-based)
- **Vector Search**: [pgvector](https://github.com/pgvector/pgvector) for PostgreSQL
- **Real-time Communication**: Socket.io
- **Camera Access**: WebRTC / getUserMedia API
- **Containerization**: Docker & Docker Compose
