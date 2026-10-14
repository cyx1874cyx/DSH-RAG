# Thrombus Literature RAG for DeepSeek Harness

An MIT-licensed fork of [imkelt/DSH-RAG](https://github.com/imkelt/DSH-RAG), adapted to **DeepSeek Harness 0.2.0-rc.2**. Original copyright notices remain in LICENSE.

Local literature indexing, bibliographic metadata, medical Chinese-English query expansion, technique/year/source-type filters, page-level provenance, and source-backed answers through the model selected in Harness. The intended answer model is **DeepSeek V4 Pro** (`deepseek-v4-pro`). DeepSeek credentials remain managed by Harness.

[中文说明](README.zh.md)

## Quick start

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
dsh plugin --profile web add ./
```

Set `DSH_RAG_DATA_DIR` to an absolute index directory before starting Harness. Add and sync an authorized document folder in Settings → Knowledge, select the knowledge base in the conversation Knowledge view, and use Search locally, Retrieve and ask, or `/rag @knowledge-base <question>`.

The default is **local BM25 plus deterministic medical term expansion**, not semantic vector search. Optional upstream SiliconFlow vector retrieval requires explicit `DSH_RAG_CLOUD_RETRIEVAL=1`; it sends extracted document chunks to that service. Answer generation uses the currently selected Harness model independently.

## Scientific provenance

Sources distinguish original articles, supplements, reading notes, metadata/abstract notes, and theses. Bibliographic fields include title, authors, DOI, year and technique. PDF locations are file page numbers; reading-note locations are not presented as original PDF evidence. Search results carry `[S1]`-style citation identities, source diversity limits, and PDF-page links. Empty retrieval does not start model generation.

The index is text-based. Images, complex tables and equations require original-document verification; scanned PDFs require OCR. Reference-section exclusion is heuristic, and generated claims still need evidence checks.

## Corpus preparation and validation

```sh
python scripts/prepare-corpus.py --catalog sources.json --output /path/to/corpus
node --import tsx scripts/ingest.ts --corpus /path/to/corpus --data /path/to/indexes
pnpm run lint
pnpm run typecheck
pnpm test
node --import tsx scripts/evaluate-local.ts /path/to/indexes
```

Store copyrighted documents, reading notes, credentials and indexes outside the repository. Incremental ingestion streams file hashes and parses documents one at a time rather than retaining every PDF in memory.
