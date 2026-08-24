# DSH-RAG

English | [简体中文](./README.zh.md)

Local knowledge bases for DeepSeek Harness Web. DSH-RAG indexes explicitly authorized folders on your computer and returns verifiable source locations only when you run `/dsh-rag <question>`.

## Features

- Multiple named knowledge bases, each backed by one or more authorized local folders.
- PDF, DOCX, PPTX, Markdown, and UTF-8 text parsing with page, slide, paragraph, or line references.
- Incremental indexing with cancellation, file-level checkpoints, watcher debouncing, and recovery scans.
- Local multilingual BM25 that remains available without an API key or network connection.
- Optional SiliconFlow retrieval using `BAAI/bge-m3` embeddings, local vectors, RRF, and `BAAI/bge-reranker-v2-m3` reranking.
- Session-scoped knowledge-base selection. Regular messages never search or inject local documents.
- English and Chinese UI that follows the DeepSeek Harness language and light/dark appearance settings.
- Source cards with a Host-validated action to open the original file.

## Requirements

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness `0.1.1-rc.2`

DeepSeek Harness is currently a developer preview. DSH-RAG declares compatibility only with versions that have passed package installation, startup, and removal checks.

## Install or Update

```powershell
dsh plugin --profile web add @kai232/dsh-rag@0.1.1
dsh --profile web --no-open
```

Use the same `plugin add` command to update an existing installation, then restart the Web profile.

## Set Up a Knowledge Base

1. Open **Settings → Knowledge**.
2. Review the SiliconFlow endpoint and the Embedding and Reranker model names.
3. Enter a SiliconFlow API key and save it to the operating-system credential vault, or keep it for the current Host session only. You can also set `SILICONFLOW_API_KEY` before starting DSH.
4. Run the fixed-text connection test. It does not send knowledge-base content.
5. Create a knowledge base with a name and an absolute path to a folder you authorize.
6. Select **Sync** and wait for indexing to finish.
7. Open the conversation **Knowledge** panel and choose which knowledge bases the current Session may search. In a new Session, type `@` in the command to choose a knowledge base for that turn instead.

Knowledge-base names and file names are user data and are not translated when the interface language changes.

## Use

Run an explicit retrieval turn:

```text
/dsh-rag What does the project note say about the launch window?
```

The plugin completes retrieval before it asks the model to answer, so retrieval never depends on whether the model chooses to call a tool. The command searches only the knowledge bases selected for the current Session. If none are selected, it stops with guidance instead of searching every knowledge base.

You can also use `@` in any new Session to override the scope for one turn without changing the saved Session selection:

```text
/dsh-rag @"Project notes" Which Python version does the virtual environment use?
```

The generated user message keeps `/dsh-rag` and the actual knowledge-base names visible, making the retrieval path explicit. The next regular message returns to zero retrieval.

Results identify the knowledge base, file, structural context, excerpt, and exact source location. The open action accepts an opaque source ID; the Host resolves and validates the path again before asking the operating system to open it.

## Retrieval and Offline Behavior

With SiliconFlow configured, the first cloud vector index sends every text chunk extracted from the authorized documents. Later syncs send only new or changed chunks for Embedding. Each explicit query sends the query and a limited candidate set for Reranking. Original PDF, Word, or PowerPoint files are not uploaded, but their extracted text is sent to SiliconFlow.

If SiliconFlow or the network is unavailable, DSH-RAG reports the fallback and continues with local BM25. Existing local indexes remain available. The v0.1 release does not expose AI-generated document or section context because that experiment did not improve the frozen retrieval evaluation.

## Local Data and Deletion

Derived data is stored under `$DSH_HOME/dsh-rag/` by default. Set `DSH_RAG_DATA_DIR` to an absolute path before starting DSH to use another location.

The **Delete knowledge base** action uses a second confirmation and removes only the knowledge-base settings and reproducible catalogs, checkpoints, and indexes. It never modifies or deletes files in the authorized source folders.

To back up derived data, stop DSH and copy the complete data directory. Indexes are reproducible and can be rebuilt from the original folders.

## Security and Privacy

- Authorized paths are normalized and checked with `realpath`; symbolic-link, junction, UNC, and path-escape cases are rejected.
- Hidden files, common credential files, executables, active Office content, embedded objects, and unsafe archive expansion are excluded.
- Document text is treated as untrusted data, never as an Agent instruction.
- API keys are not written to project settings, logs, Sessions, browser storage, indexes, or API responses.
- Persistent keys use Windows Credential Manager, macOS Keychain, or Linux Secret Service. There is no plaintext credential-file fallback.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run pack:check
```

## License

MIT
