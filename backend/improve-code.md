I want you to improve retrieval quality and hallucination control in my EXISTING RAG project.

Repository:
nestjs-react-rag-gemini-pgvector

Tech stack:

* Backend: NestJS + TypeScript
* Frontend: React 18 + TypeScript + Vite
* Database: PostgreSQL 16 + pgvector
* Embeddings: Google Gemini
* LLM: Google Gemini
* Vector search: pgvector cosine similarity
* HNSW index
* Current embedding dimension: 768

IMPORTANT:
Do NOT redesign the project.
Do NOT rewrite existing services unnecessarily.
Do NOT introduce Redux, new state management, or unrelated libraries.
Do NOT break the existing API contract.
First inspect the existing code and understand how the current RAG pipeline works.

Relevant backend structure:

backend/src/
├── gemini/
│   ├── gemini.module.ts
│   └── gemini.service.ts
├── documents/
│   ├── documents.module.ts
│   ├── documents.service.ts
│   ├── documents.controller.ts
│   ├── chunking.service.ts
│   └── dto/ingest.dto.ts
└── chat/
├── chat.module.ts
├── chat.service.ts
├── chat.controller.ts
└── dto/chat.dto.ts

Database currently contains:

* document_id
* title
* content
* metadata JSONB
* embedding VECTOR(768)
* created_at

There is already an HNSW index using vector_cosine_ops.

CURRENT PROBLEM:

Right now pgvector returns semantically similar chunks, but semantic similarity does NOT guarantee that the chunk is technically correct for the user's question.

Example:

User asks:
"How many leaves can an employee take in 2026?"

pgvector might return:

Leave Policy 2025 → similarity 0.94
Leave Policy 2026 → similarity 0.91

The 2025 document is highly similar but is not the correct context.

I want to improve the existing RAG pipeline so that we validate retrieval quality before sending context to Gemini.

TARGET FLOW:

User question
↓
Create query embedding
↓
pgvector retrieves more candidates
↓
Similarity threshold
↓
Metadata filtering where possible
↓
Select final topK chunks
↓
If no reliable context → do NOT call LLM
↓
Gemini answers only from validated context
↓
Return answer + sources

IMPLEMENT THE FOLLOWING:

1. RETRIEVE MORE CANDIDATES

If the user asks for topK=5:

Do not retrieve only 5 records from pgvector.

Retrieve approximately topK * 4 candidates, with a reasonable maximum such as 20.

Example:

topK = 5
candidateK = 20

Then apply filtering/validation and select the final top 5.

Keep the existing public API request unchanged:

{
"question": "string",
"topK": 5
}

2. SIMILARITY THRESHOLD

Add a configurable minimum similarity threshold.

Do NOT blindly send every pgvector result to Gemini.

The threshold must be configurable through environment/configuration rather than being an unexplained hardcoded value.

Important:

Check how the current code calculates similarity from pgvector's `<=>` cosine distance.

Make sure the comparison uses the correct similarity value.

For cosine distance:

similarity = 1 - cosine_distance

Do not accidentally compare cosine distance as if it were similarity.

3. NO RELEVANT CONTEXT

If all retrieved chunks are below the configured threshold:

DO NOT call Gemini.

Return:

{
"answer": "I couldn't find enough information in the available documents.",
"sources": []
}

Keep the existing HTTP/API response structure unless the existing implementation requires otherwise.

4. METADATA FILTERING

Inspect the existing `metadata JSONB` implementation.

Do NOT invent metadata fields that are not currently available.

If useful metadata already exists, use it to improve retrieval.

Examples could include:

* year
* department
* region
* status
* version

The goal is:

semantic similarity
+
business/document constraints

rather than relying only on vector similarity.

5. GROUNDING PROMPT

Inspect the existing Gemini prompt in `gemini.service.ts`.

Improve it so Gemini:

* answers only from the retrieved context
* does not use outside/general knowledge
* does not invent information
* clearly says when the answer is not present in the context
* preserves source attribution

For example, the model should follow this rule:

"If the answer cannot be supported by the provided context, say that there is not enough information in the available documents."

Do not blindly copy this prompt. Adapt it to the existing Gemini implementation.

6. SOURCE QUALITY

Keep the existing response format:

{
"answer": "string",
"sources": [
{
"title": "string",
"snippet": "string",
"similarity": "number",
"documentId": "uuid"
}
]
}

Only return sources that were actually used as final context.

Make sure similarity is a real 0–1 similarity score, not raw cosine distance.

7. RETRIEVAL LOGGING

Add useful development/debug logging.

For each /chat request, log:

* question
* requested topK
* candidate count
* candidate similarity scores
* number removed by threshold
* number remaining after filtering
* final chunks sent to Gemini
* retrieval duration

Do NOT log full sensitive document contents.

Keep production logging reasonable.

8. RETRIEVAL EVALUATION

Add a small retrieval evaluation mechanism.

Create a simple dataset of test questions and their expected relevant document IDs/chunk IDs.

Example:

[
{
"question": "What is the leave policy?",
"expectedDocumentIds": ["..."]
}
]

Create a service/function that can run these questions through the retrieval layer WITHOUT calling Gemini for generation.

For each question report:

* retrieved document/chunk IDs
* expected document/chunk IDs
* whether the expected document was found in topK
* Recall@K
* Precision@K where practical

Keep this evaluation separate from the normal production `/chat` flow.

The purpose is to answer:

"Did pgvector retrieve the correct evidence?"

9. DO NOT ADD RERANKING YET

Do NOT introduce a new reranking model or external reranking dependency in this change.

First implement:

pgvector
→ candidate retrieval
→ similarity threshold
→ existing metadata filtering if available
→ final topK
→ grounded Gemini prompt

We can add a reranker later if evaluation shows that vector search is not sufficient.

10. TESTING

Add/update tests where the project already has a testing structure.

At minimum verify:

Case 1:
Relevant chunks are found.
→ Gemini receives context.

Case 2:
All chunks have low similarity.
→ Gemini is NOT called.

Case 3:
Top 20 candidates are retrieved but only topK valid chunks are sent to Gemini.

Case 4:
Returned source similarity values are between 0 and 1.

Case 5:
The existing /chat API response structure is unchanged.

Case 6:
Existing document ingestion/upload functionality still works.

11. VERY IMPORTANT: INSPECT BEFORE MODIFYING

Before writing code, inspect:

* chat/chat.service.ts
* chat/chat.controller.ts
* chat/dto/chat.dto.ts
* gemini/gemini.service.ts
* documents/documents.service.ts
* documents/chunking.service.ts
* database/init.sql
* existing environment/configuration

Then explain briefly:

A. How retrieval currently works
B. Where cosine distance is converted to similarity
C. Where topK is currently applied
D. Where the retrieved chunks are passed to Gemini
E. Which exact files need modification

Only then implement the changes.

12. DO NOT BREAK MY FRONTEND

The frontend currently consumes the existing /chat response.

Do not change the frontend unless absolutely necessary.

The existing frontend architecture must remain:

Component
→ useChat.ts
→ API
→ state update
→ UI

No fetch() directly inside components.

FINAL OUTPUT AFTER IMPLEMENTATION:

Tell me:

1. Files changed
2. What changed in each file
3. How retrieval validation now works
4. How the similarity threshold works
5. What happens when no relevant context is found
6. How retrieval evaluation works
7. How to test it with my existing application
8. Example logs for a successful retrieval
9. Example logs for a failed retrieval

Keep the implementation simple and production-oriented.
