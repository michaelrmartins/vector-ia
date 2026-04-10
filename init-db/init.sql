CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE alunos (
    id SERIAL PRIMARY KEY,
    matricula VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    foto_embedding vector(128)
);

CREATE TABLE presencas (
    id SERIAL PRIMARY KEY,
    aluno_id INTEGER REFERENCES alunos(id),
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    camera_id VARCHAR(50)
);