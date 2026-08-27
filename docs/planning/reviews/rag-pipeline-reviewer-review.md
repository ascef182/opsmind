# Review — Pipeline RAG do OpsMind (rag-pipeline-reviewer)

**Documento revisado:** `docs/planning/PRD.md` (v1.0, 26/08/2026) — foco nas seções 9 (DocumentChunk), 13 (Estratégia de IA/RAG) e Fase 4 do roadmap (seç. 17, Sprints 9-10).
**Tipo de revisão:** análise de design/planejamento (pré-implementação). Não há código de pipeline RAG ainda para inspecionar — esta revisão avalia a estratégia descrita no PRD contra riscos conhecidos de retrieval quality, chunking e citação.

**Decisão:** `APPROVE WITH CONDITIONS` — a direção geral (Postgres + pgvector no MVP, chunking com overlap, citação de fonte) é razoável para o estágio do projeto, mas o PRD atual é vago demais em pontos que decidem se o pilar "RAG" do produto funciona de verdade: a estratégia de chunking não está de fato definida (mistura duas abordagens sem escolher uma), não há parâmetros de chunk/overlap, não há arquitetura de citação concreta (só o objetivo), não há métricas de retrieval antes da Fase 7, e a extração de PDF não trata tabelas nem documentos escaneados — que são exatamente o tipo de artefato mais comum em "contrato em PDF".

---

## 1. Resumo

A seção 13 do PRD descreve o pipeline como: *upload → extração de texto → chunking (por parágrafo/tamanho fixo com overlap) → embeddings → `DocumentChunk` → busca por similaridade → resposta com citação*. Isso é uma boa esqueleto de arquitetura, mas cada etapa tem uma decisão de design ainda em aberto que afeta diretamente o critério de aceitação da Fase 4 ("perguntar sobre o conteúdo de um contrato enviado retorna resposta correta citando o trecho/documento de origem") e o critério de aceitação geral #3 ("a IA responde... e cita a fonte quando a resposta vem de um documento").

Os pontos que mais preocupam, em ordem de risco:

1. **Chunking indefinido** — "por parágrafo/tamanho fixo com overlap" descreve duas estratégias diferentes sem dizer qual prevalece, nem tamanho, nem overlap. Para contratos, chunking ingênuo por tamanho fixo quebra cláusulas no meio e separa termos definidos das suas definições.
2. **Extração de PDF sem tratamento de tabelas nem PDFs escaneados** — não mencionado em nenhum lugar do PRD, apesar de contratos reais quase sempre terem tabelas (valores, prazos, anexos) e uma fração relevante de contratos serem digitalizados via scanner/foto.
3. **"Citação da fonte" é um objetivo, não uma arquitetura** — falta o mecanismo que garante que a citação exibida corresponde ao trecho realmente usado pela IA (e não uma citação alucinada apontando para o documento certo mas o trecho errado).
4. **Nenhuma métrica de retrieval antes da Fase 7** — o eval suite só aparece no Sprint 14 (fase final), mas a Fase 4 (Sprints 9-10) já declara "resposta correta" como critério de aceitação sem nenhuma forma objetiva de medir isso além de teste manual.
5. **pgvector é uma escolha adequada para o MVP**, mas o PRD não documenta os parâmetros de índice (HNSW vs IVFFlat), a estratégia de filtro por `organization_id` combinada com ANN, nem um gatilho explícito de quando migrar — só diz "migrável depois", sem definir o "depois".

Nenhum desses pontos bloqueia o início da Fase 4, mas todos deveriam ser decididos **antes** de escrever o schema definitivo de `DocumentChunk` e o pipeline de ingestão, porque mudar chunking/citação depois de ter dados de produção é caro (implica reprocessar todos os documentos).

---

## 2. Avaliação de chunking / embeddings

### 2.1 A estratégia proposta é adequada para contratos em PDF?

**Não, não como está descrita.** "Por parágrafo/tamanho fixo com overlap" mistura duas famílias de chunking:

- **Chunking por tamanho fixo (fixed-size)**: corta o texto a cada N tokens/caracteres, com overlap de M tokens. É simples e previsível, mas **ignora completamente a estrutura semântica do documento**. Em um contrato, isso frequentemente corta uma cláusula no meio, separa um termo definido ("Rescisão") da cláusula que o define, ou mistura o fim de uma cláusula com o início da próxima sem fronteira clara.
- **Chunking por parágrafo**: respeita quebras de parágrafo, mas parágrafos em contratos variam de uma frase a uma página inteira (cláusulas numeradas costumam ser parágrafos únicos e longos), então o tamanho dos chunks fica muito desigual — alguns chunks minúsculos sem contexto suficiente, outros grandes demais para embeddings precisos.

Para o caso de uso central do PRD (caso de uso 4: *"qual a cláusula de rescisão?"*), o que o usuário pergunta é sobre uma **unidade semântica nomeada** (uma cláusula, um artigo, uma seção numerada) — não sobre um bloco arbitrário de N caracteres. Isso pede um chunking **estrutural/hierárquico**, não puramente por tamanho.

**Recomendação de chunking:**

1. **Chunking estrutural como estratégia primária**: durante a extração, detectar a estrutura do documento (títulos de seção, numeração de cláusulas — "Cláusula 3ª", "3.1", "Art. 5º" etc. via regex/heurísticas ou extração com layout) e usar essas fronteiras como limites de chunk primários. Cada chunk = uma cláusula/seção completa (ou, se muito longa, subdividida preservando o cabeçalho da cláusula em todos os subchunks para não perder contexto).
2. **Fallback por tamanho fixo com overlap** apenas quando a estrutura não é detectável (documentos sem numeração clara, texto corrido).
3. **Metadados por chunk são obrigatórios, não opcionais**: além de `content`, `embedding`, `chunk_index`, o `DocumentChunk` deveria guardar `page_number`, `section_title`/`clause_number` (quando detectável) e `char_start`/`char_end` no documento original. Isso é necessário tanto para citação (seção 4) quanto para permitir busca híbrida/filtrada depois.
4. **Tamanho de chunk recomendado como ponto de partida**: **300–500 tokens** por chunk (não caracteres — o embedding opera sobre tokens), com **overlap de 15–20%** (≈ 50–100 tokens). Justificativa: chunks muito pequenos (<100 tokens) perdem contexto e geram embeddings menos discriminativos; chunks muito grandes (>800 tokens) diluem a similaridade semântica (um chunk que fala de 3 assuntos diferentes fica "ambíguo" no espaço vetorial) e aumentam o custo/ruído do que é injetado no prompt. Para contratos, cláusulas individuais tipicamente cabem confortavelmente em 300–500 tokens; quando não cabem, prefira dividir por sub-cláusula a cortar arbitrariamente.
5. Esses números são **um ponto de partida, não uma verdade fixa** — devem ser validados empiricamente contra o dataset de eval do item 5 desta revisão (testar 2-3 combinações de tamanho/overlap e comparar `context_recall`/`context_precision`).

### 2.2 Embeddings

O PRD não especifica o modelo de embedding a ser usado (item ausente na seção 13). Pontos a decidir e documentar:

- **Idioma**: contratos brasileiros estarão majoritariamente em PT-BR. Confirmar que o modelo de embedding escolhido tem desempenho multilíngue adequado (ex.: `text-embedding-3-small/large` da OpenAI e modelos Voyage têm suporte multilíngue razoável; validar empiricamente com queries em português, não assumir).
- **Dimensionalidade vs. custo de storage**: `text-embedding-3-large` (3072 dim) tem melhor recall que `-small` (1536 dim), mas dobra o tamanho do índice HNSW em memória — decisão relevante para o dimensionamento de pgvector (seção 3).
- **Consistência de versão de embedding**: se o modelo de embedding mudar no futuro, todos os `DocumentChunk` existentes precisam ser reprocessados (embeddings de modelos diferentes não são comparáveis no mesmo índice). Recomenda-se guardar `embedding_model_version` no `DocumentChunk` desde o início para permitir migração futura sem quebra silenciosa.

---

## 3. Avaliação de pgvector vs. alternativas

### 3.1 pgvector é adequado para o MVP?

**Sim, é uma escolha correta para este estágio.** Justificativas a favor, alinhadas ao próprio raciocínio do PRD (seç. 15): evita subir e operar um vector DB dedicado (custo de infra + operação para um único desenvolvedor), mantém a busca vetorial na mesma transação/RLS que já isola por `organization_id`, e o volume esperado (SMBs de 3-50 pessoas, MVP) provavelmente fica na casa de dezenas de milhares a poucas centenas de milhares de chunks no total — faixa onde pgvector performa bem.

### 3.2 Limites reais que o PRD não documenta

**Tipo de índice — HNSW vs IVFFlat:**
- **IVFFlat**: precisa de uma etapa de treinamento (`lists`) baseada em uma amostra dos dados; funciona mal em tabelas vazias/pequenas (recomendação comum é só criar o índice depois de ter uma massa mínima de dados) e sua qualidade de recall depende de escolher bem o parâmetro `lists` e `probes` na query.
- **HNSW**: não precisa de treinamento, entrega melhor trade-off recall/latência para a maioria das cargas de leitura, mas consome mais memória e é mais lento para construir/inserir (cada insert atualiza o grafo). Para o padrão de uso do OpsMind — ingestão de documentos é assíncrona via BullMQ (menos sensível a latência de escrita) e a leitura (busca de similaridade) acontece em tempo real durante o chat — **HNSW é a escolha recomendada**, com o build/reindex acontecendo fora do caminho crítico do usuário.
- O PRD não menciona qual tipo de índice será usado nem os parâmetros (`m`, `ef_construction` para HNSW; `ef_search` na query) — isso deveria ser uma decisão explícita de implementação na Fase 4, não deixado para "o Prisma decide".

**Filtro por tenant (`organization_id`) combinado com ANN:**
- Índices ANN (HNSW/IVFFlat) não foram desenhados para filtro arbitrário por WHERE. pgvector moderno suporta filtered HNSW, mas quando o filtro é muito seletivo (cada organização é uma fração pequena do total de vetores da tabela, o que é exatamente o caso multi-tenant do OpsMind), o recall pode cair porque o índice pode não encontrar vizinhos suficientes dentro do subconjunto filtrado antes de esgotar o `ef_search`. Isso é uma preocupação de arquitetura direta com a regra de negócio da seção 8 ("nenhuma query pode cruzar tenants") — vale um teste de carga cedo simulando muitos tenants pequenos, não só um tenant grande.
- Alternativa a avaliar: particionamento lógico (schema/tabela por padrão de particionamento por `organization_id`, ou um índice HNSW parcial por tenant se o volume por tenant justificar) — mas isso é otimização prematura para o MVP; documentar como risco conhecido é suficiente por agora.

**Latência real:**
- Para datasets de até algumas centenas de milhares de vetores com HNSW bem configurado e índice em memória (cabendo em `shared_buffers`), latências de busca sub-100ms são realistas. Acima disso (milhões de vetores, ou índice maior que a memória disponível), a latência degrada de forma não linear porque o índice passa a bater em disco.
- Não há budget de latência definido no PRD para a busca de similaridade nem para o `/ai/chat` end-to-end — recomenda-se definir um SLO (ex.: p95 de retrieval < 200ms) desde a Fase 4 para ter um sinal objetivo de quando a solução está degradando.

**Quando migrar para um vector DB dedicado:**
Recomenda-se documentar gatilhos explícitos em vez de "depois", por exemplo:
1. Volume agregado de `DocumentChunk` ultrapassa ~1-5M linhas e a latência de busca (p95) ultrapassa o SLO definido mesmo após tuning de índice;
2. Necessidade de busca híbrida (vetorial + full-text/BM25) e filtragem por metadados complexa se torna central ao produto — pgvector não tem isso nativo (precisaria combinar manualmente com `tsvector` do Postgres, o que é viável mas não é "de graça");
3. Reindexação/rebuild do HNSW começa a competir por recursos com a carga transacional do OLTP principal (CRM, tasks) no mesmo Postgres — nesse ponto, mesmo antes de trocar de tecnologia, vale considerar mover pgvector para uma réplica/instância Postgres dedicada antes de migrar para outro produto;
4. Necessidade de escala horizontal/multi-região que uma única instância Postgres não atende.

Sem esses gatilhos escritos, existe o risco real de "vector DB dedicado" nunca ser avaliado a tempo, e o time só descobrir o problema quando a latência de produção já estiver ruim.

---

## 4. Arquitetura de citação recomendada

O PRD trata citação como resultado desejado ("resposta com citação da fonte"), mas não como mecanismo. Isso é a lacuna mais importante para a promessa central do caso de uso 4 e do critério de aceitação #3. Sem um mecanismo explícito, o risco natural é a IA **alucinar a citação** — apontar para o documento certo, mas citar um trecho que não sustenta de fato a afirmação (ou pior, citar um chunk que nunca foi recuperado).

Arquitetura recomendada:

1. **Provenance no dado, não só no prompt**: cada `DocumentChunk` deve carregar metadados suficientes para reconstruir a citação sem reprocessar o documento — `document_id`, `chunk_index`, `page_number`, `section_title`/`clause_number` (quando disponível), `char_start`/`char_end`. Isso depende diretamente de uma extração de PDF com layout (ver seção 6) — extração puramente texto-corrido não preserva página nem posição.
2. **Grounding set explícito**: a etapa de retrieval retorna um conjunto fechado de `chunk_id`s (o "grounding set") que é o único material permitido como fonte da resposta. Esse conjunto é passado ao LLM como dado delimitado (alinhado com a regra da seção 8/14 do PRD de nunca tratar conteúdo de documento como instrução).
3. **Saída estruturada, não citação em texto livre**: forçar o LLM a retornar as citações como um campo estruturado (ex.: JSON/tool-call com `citations: [{chunk_id, quoted_span}]`) associado à resposta, em vez de deixar o modelo escrever "(ver contrato, cláusula 3)" livremente dentro do texto. Saída estruturada é validável programaticamente; texto livre não é.
4. **Validação pós-geração (guard obrigatório)**: antes de exibir a resposta, validar que (a) todo `chunk_id` citado pertence ao grounding set recuperado naquela consulta — rejeitar/reprocessar se não pertencer (isso é a defesa direta contra citação alucinada); (b) o `quoted_span` citado é de fato um substring (ou near-match) do conteúdo real armazenado naquele `chunk_id` — isso pega o caso em que o modelo cita o chunk certo mas parafraseia como se fosse citação literal.
5. **Imutabilidade do chunk citado**: o texto exibido como citação deve vir do conteúdo armazenado no `DocumentChunk` no momento da resposta, não gerado pelo LLM — o LLM aponta para o chunk, a UI renderiza o texto real do banco. Isso elimina uma classe inteira de erro (LLM "lembrando" errado o conteúdo do trecho).
6. **UI/UX de citação**: mapear `chunk_id → page_number` para permitir abrir o PDF original na página correta e, idealmente, destacar o trecho (requer bounding box da extração, que é um passo mais avançado — pode ficar para depois do MVP, mas o campo `page_number` deveria existir desde já para não bloquear essa evolução).
7. **Reprocessamento não deve quebrar citações antigas**: se um documento for reprocessado (nova extração/chunking), os `chunk_id`s antigos não devem ser sobrescritos in-place de forma que citações já mostradas ao usuário em conversas passadas apontem para conteúdo diferente — versionar `DocumentChunk` por reprocessamento ou tratar reprocessamento como criação de novos chunks + soft-delete dos antigos.

Este mecanismo de validação (grounding set fechado + verificação pós-geração) é o item que decide se o critério de aceitação #3 do PRD ("cita a fonte quando a resposta vem de um documento") é uma garantia de engenharia ou uma esperança sobre o comportamento do LLM.

---

## 5. Métricas de retrieval recomendadas

O PRD atual só planeja evals na Fase 7 (Sprint 14, seção 17) — "dataset de evals (10–20 casos)... tool selection accuracy, hallucination rate". Isso é insuficiente e tardio especificamente para RAG: a Fase 4 (Sprints 9-10) já declara como critério de aceitação que a resposta sobre um contrato deve ser "correta" e citar a fonte, mas não existe, até a Fase 7, nenhuma forma objetiva de medir isso — só verificação manual ad hoc. Isso é exatamente o gap que este agente é desenhado para sinalizar como bloqueante antes de "confiar" no pipeline.

**Recomendação: mover uma baseline mínima de retrieval eval para dentro da própria Fase 4**, não esperar a Fase 7. Métricas mínimas:

**Nível RAGAS (padrão do papel deste revisor):**
- `faithfulness` — a resposta é sustentada pelos chunks recuperados (sem invenção)?
- `context_precision` — dos chunks recuperados, quantos são de fato relevantes à pergunta?
- `context_recall` — o(s) chunk(s) que contêm a resposta correta foram recuperados no top-k?
- `answer_relevancy` — a resposta de fato responde à pergunta feita (não só é fiel ao contexto, mas relevante à intenção).

**Métricas específicas de retrieval (além de RAGAS):**
- **Recall@k e Precision@k** (k = 3, 5) sobre um dataset dourado pequeno (20-30 perguntas reais tipo "qual a cláusula de rescisão do contrato X?" com a resposta esperada e o chunk/página que a contém, anotado manualmente).
- **MRR (Mean Reciprocal Rank)** — mede se o chunk correto aparece perto do topo do ranking, não só "em algum lugar do top-k".
- **"Chunk boundary correctness"** — métrica específica para validar a decisão de chunking da seção 2: checar se o span de resposta esperado está **contido inteiramente** em um único chunk recuperado (e não partido entre dois chunks, o que indica que o chunking está cortando no lugar errado).

**Métricas de citação (ligadas à seção 4):**
- **Taxa de citação alucinada**: % de respostas cujo `chunk_id` citado não pertence ao grounding set recuperado — meta deveria ser 0% (é um bug, não uma questão de qualidade gradual, dado o guard recomendado).
- **Taxa de citação fiel**: % de citações cujo trecho citado de fato sustenta a afirmação feita (pode ser avaliado por amostragem humana inicialmente, depois com um verificador automatizado tipo NLI/faithfulness).

**Métricas operacionais:**
- Latência de retrieval isolada (p50/p95) e latência end-to-end do `/ai/chat` (retrieval + geração).
- **Taxa de abstenção correta vs incorreta**: com que frequência o sistema corretamente diz "não encontrei essa informação nos documentos" quando não há contexto suficiente, vs quantas vezes responde com confiança sem grounding (falso positivo perigoso) ou se recusa a responder quando a informação estava disponível (falso negativo, prejudica utilidade). O PRD não menciona esse fallback de "contexto insuficiente" em nenhum lugar — deveria ser um comportamento explícito do `AI Assistant`, não implícito.

**Governança do baseline:**
- Definir e versionar o dataset dourado desde a Fase 4 (mesmo pequeno — 15-20 pares pergunta/resposta/chunk esperado sobre 2-3 contratos de teste).
- Definir thresholds de aceitação justificados pelo risco do domínio (respostas sobre cláusulas contratuais têm consequência de negócio real se erradas — isso pede um limiar de `faithfulness` mais rígido que um chatbot de FAQ genérico).
- Definir slices: pelo menos "contratos com estrutura clara" vs "documentos sem estrutura", e, se aplicável, por idioma.
- Definir delta de regressão permitido por métrica ao mudar chunking/modelo de embedding/prompt — sem isso, qualquer mudança futura no pipeline (trocar tamanho de chunk, trocar modelo de embedding) não tem como ser validada objetivamente antes de ir para produção.

---

## 6. Riscos não endereçados no PRD

Estes riscos de qualidade de extração de PDF não aparecem em nenhuma seção do PRD (nem na 9, nem na 13, nem no roadmap da Fase 4), apesar do caso de uso central do produto (caso de uso 4) ser especificamente sobre contratos em PDF.

**CRITICAL — PDFs escaneados/baseados em imagem sem camada de texto.** O pipeline descrito (`extração de texto → chunking → embeddings`) não menciona OCR em nenhum lugar da stack técnica (seção 15) nem da infraestrutura de IA (seção 10.2). Uma fração relevante de contratos reais em PMEs brasileiras chega como digitalização/scan (sem texto pesquisável embutido no PDF). Extração de texto ingênua (ex.: `pdf-parse`, `pdfplumber` sem OCR) sobre esse tipo de arquivo retorna string vazia ou lixo — o documento entraria no fluxo como `status: ready` com chunks vazios/sem sentido, ou falharia silenciosamente sem sinalizar ao usuário que o problema é "documento sem texto extraível" (o enum `status` do `Document` só tem `processing|ready|failed`, sem uma categoria para "extraído com baixa confiança"). **Impacto no usuário:** a IA responderia "não encontrei essa informação" ou, pior, alucinaria uma resposta baseada em chunks vazios/ruído, para um documento que na verdade contém a resposta — quebra diretamente o caso de uso 4 e o critério de aceitação #3. **Fix mínimo:** adicionar um passo de detecção ("este PDF tem camada de texto?") com fallback para OCR (ex.: Tesseract, Google Cloud Vision, AWS Textract, ou Document AI do GCP já que a stack já usa GCP) e um novo status (`needs_ocr`/`low_confidence`) exposto na UI.

**HIGH — Tabelas em contratos não são tratadas.** Contratos de negócio comumente têm tabelas (valores, cronograma de pagamento, SLA, anexos de preços). Extração de texto padrão "linhaeiriza" tabelas, destruindo a relação linha/coluna (ex.: "Serviço A R$ 500 Mensal Serviço B R$ 800 Trimestral" vira uma sequência de tokens sem estrutura, e o chunking por tamanho fixo pode inclusive cortar a tabela no meio). **Impacto:** perguntas do tipo "qual o valor mensal do serviço X?" têm alta chance de recuperar um chunk ilegível ou de a IA inferir errado a associação valor↔item. **Fix mínimo:** usar uma biblioteca/serviço de extração com detecção de tabela (ex.: `pdfplumber` com detecção de tabela, Unstructured.io, ou GCP Document AI) e serializar tabelas como Markdown dentro do chunk (preserva estrutura de forma legível tanto para embedding quanto para o LLM), em vez de texto corrido.

**MEDIUM — Layout multi-coluna não é considerado.** Alguns documentos formais usam duas colunas; extração ingênua por ordem de bytes no PDF pode intercalar texto das duas colunas, produzindo chunks com frases misturadas de parágrafos não relacionados. Menos comum em contratos simples, mas relevante se o produto aceitar quaisquer PDFs de negócio (propostas, apresentações exportadas).

**MEDIUM — Nenhum gate de qualidade de extração antes de indexar.** Não há verificação de "a extração deu certo o suficiente para ser confiável" antes de gerar embeddings e marcar o documento como `ready`. Isso é a causa raiz que amplifica os dois riscos acima: sem um sinal de confiança de extração, o sistema não tem como decidir entre indexar, indexar-com-aviso, ou pedir reprocessamento/OCR.

**LOW–MEDIUM — Sem menção a limites de tamanho/paginação de upload nem deduplicação.** Um PDF muito grande gera um número não limitado de chunks/jobs de embedding no worker de `document-processing` (fila BullMQ, seção 12) sem limite documentado — risco operacional de custo e tempo de processamento, não estritamente de qualidade de retrieval, mas vale registrar. Da mesma forma, reenvio do mesmo contrato (nova versão) não tem estratégia de deduplicação/versionamento de chunks descrita — pode gerar chunks duplicados competindo no retrieval e citações apontando para a versão errada do documento.

**Observação positiva:** a defesa de prompt injection via documentos (seção 8/14 do PRD — conteúdo de documento tratado sempre como dado, nunca como instrução, com teste automatizado dedicado) está bem endereçada e não precisa de ajuste — é citada aqui só para deixar claro que não é um risco desta revisão.

---

## Handoffs recomendados

- `mle-reviewer` — para desenhar a governança do dataset dourado de retrieval eval (versionamento, thresholds, cadência de execução) e decidir se ele deve rodar em CI a partir da Fase 4 (não só na Fase 7 como está hoje).
- `performance-optimizer` — para o dimensionamento real de pgvector (parâmetros HNSW, budget de latência, teste de carga com filtro multi-tenant) antes de decidir o gatilho de migração para um vector DB dedicado.
- `security-reviewer` — para avaliar implicações de LGPD no armazenamento de texto extraído de contratos (dados pessoais/CPF/valores) dentro de `DocumentChunk`, e para revisar o fluxo de upload quanto a validação/sanitização de arquivo (tamanho, tipo, scanning) antes de entrar na fila de processamento.
- `docs-lookup` — para validar, no momento da implementação, a API atual de extração escolhida (ex.: GCP Document AI, Unstructured.io) e os parâmetros de índice HNSW/IVFFlat na versão do pgvector que for efetivamente usada.
