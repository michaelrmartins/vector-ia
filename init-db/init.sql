CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE pessoas (
    id SERIAL PRIMARY KEY,
    documento VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    tipo INTEGER NOT NULL,
    foto_embedding vector(128)
);

CREATE TABLE presencas (
    id SERIAL PRIMARY KEY,
    pessoa_id INTEGER REFERENCES pessoas(id),
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    camera_id VARCHAR(50)
);