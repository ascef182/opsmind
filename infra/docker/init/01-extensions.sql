-- Habilita pgvector desde o primeiro boot do container. A extensão fica ociosa
-- até a Fase 4 (Document/DocumentChunk), mas configurá-la agora evita depender
-- de um passo manual futuro.
CREATE EXTENSION IF NOT EXISTS vector;
