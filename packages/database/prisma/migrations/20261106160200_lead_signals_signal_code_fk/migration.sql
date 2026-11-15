-- FK real entre lead_signals.signal_code e signal_codes.code — rejeita no
-- banco qualquer INSERT com um código não cadastrado, sem precisar de
-- trigger (este projeto não tem nenhum, ver docs/planning/2026-11-06-harvey-inteligencia-comercial.md
-- "Revisão crítica"). Mesma observação de antes sobre o diff bruto propor
-- um `DROP INDEX document_chunks_embedding_hnsw_idx` não relacionado — removida.

ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_signal_code_fkey" FOREIGN KEY ("signal_code") REFERENCES "signal_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
