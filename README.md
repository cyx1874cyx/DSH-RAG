# DSH-RAG

English | [简体中文](./README.zh.md)

DSH-RAG is a local knowledge-base plugin for DeepSeek Harness Web. It turns explicitly authorized folders into named, incrementally synchronized knowledge bases. When you run `/rag <question>`, it retrieves evidence before the model answers and shows verifiable sources with excerpts, exact locations, and open-file actions. Regular chat never accesses local documents.

## Features

- Build multiple named knowledge bases from one or more explicitly authorized local folders.
- Reuse named knowledge bases across projects and Sessions; each knowledge base may contain one or more explicitly authorized folders.
- Limit retrieval to the knowledge bases selected for the current Session, or use one or more optional `@knowledge-base` selectors for a single-turn override. Regular messages never search or inject local documents.
- Retrieve evidence before the model answers, then show collapsible source cards with the knowledge base, file, excerpt, exact page, slide, paragraph, or line reference, and a Host-validated action to open the original file.
- Parse PDF, DOCX, PPTX, Markdown, and UTF-8 text files, with incremental indexing, cancellation, file-level checkpoints, watcher debouncing, and recovery scans.
- Continue searching offline with local multilingual BM25; optionally enable SiliconFlow embeddings, local vectors, RRF, and reranking for hybrid retrieval.
- Follow the DeepSeek Harness language and light/dark appearance settings with an English and Chinese UI.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm available on `PATH` (`dsh plugin` uses pnpm to manage profile packages)
- DeepSeek Harness: tested with `0.1.1-rc.2`

DeepSeek Harness is currently a developer preview. `0.1.1-rc.2` is the version DSH-RAG has verified through package installation, startup, and removal checks; it does not mean the plugin can run only on that version. Other DSH versions may work, but are not claimed as compatible until they pass the same checks.

## Install and Start

Choose one of the following methods. Both install DSH-RAG into the same `web` profile, so you do not need to run both.

### Method 1: Run DSH with npx

Use this method if you have not installed the `dsh` command. Run the following commands from any directory:

```powershell
npx @deepseek-ai/dsh plugin --profile web add @kai232/dsh-rag
npx @deepseek-ai/dsh web
```

Keep the second command running, then open the Web address printed in the terminal.

### Method 2: Use an existing DSH installation

If `dsh --version` works in your terminal, no directory change is required:

```powershell
dsh plugin --profile web add @kai232/dsh-rag
dsh web
```

If you prefer to run DSH from source, clone the repository and use its `pnpm dsh` script:

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add @kai232/dsh-rag
pnpm dsh web
```

If you already have a local checkout, skip `git clone`, enter its root directory, and continue with `pnpm install`. The `pnpm run build` step prepares the source artifacts used by `pnpm dsh web`.

To update DSH-RAG, stop the running Web process, repeat the corresponding `plugin add` command, and start Web again.

## Set Up a Knowledge Base

1. Open **Settings → Knowledge**.
2. Review the SiliconFlow endpoint and the Embedding and Reranker model names.
3. Enter a SiliconFlow API key and save it to the operating-system credential vault. If the vault is unavailable, set `SILICONFLOW_API_KEY` before starting DSH; the plugin never falls back to a plaintext key file. Connection status is checked automatically, and **Retry** appears only after a failure.
4. Create a knowledge base in Settings. Enter only folders you explicitly authorize.
5. Select **Sync** and wait for indexing to finish.
6. In the conversation **Knowledge** panel, choose which knowledge bases the Session may search. For a one-turn override, type `/rag` and choose one knowledge base in the first command menu.

Knowledge-base names and file names are user data and are not translated when the interface language changes.

## Use

Command format:

```text
/rag <question>
```

Typing `/rag` shows the command and one-turn variants for each knowledge base in the first menu. After entering the command, `/rag @` also shows knowledge bases above the general file, folder, and Session candidates; choosing one inserts its plain-text selector. Knowledge bases never appear in unrelated `@` menus or after the question has started. Pressing Space without choosing starts a question that uses the saved Session scope. Running `/rag` alone shows knowledge-base statistics and usage without calling the model.

Run an explicit retrieval turn using the knowledge bases selected for the current Session:

```text
/rag What does the project note say about the launch window?
```

The plugin completes retrieval before it asks the model to answer, so retrieval never depends on whether the model chooses to call a tool. The command searches only the knowledge bases selected for the current Session. If none are selected, it stops with guidance instead of searching every knowledge base.

To override the scope for one turn, select a knowledge base from the first `/rag` command menu. The plugin inserts the shortest unambiguous selector automatically without changing the saved Session selection:

```text
/rag @"Project notes" Which Python version does the virtual environment use?
```

Names without whitespace use the shorter form, such as `/rag @Notes <question>`; quoted selectors remain available for names with spaces. The next regular message returns to zero retrieval.

Results identify the knowledge base, file, structural context, excerpt, and exact source location. The open action accepts an opaque source ID; the Host resolves and validates the path again before asking the operating system to open it.

## Retrieval and Offline Behavior

With SiliconFlow configured, the first cloud vector index sends every text chunk extracted from the authorized documents. Later syncs send only new or changed chunks for Embedding. Each explicit query sends the query and a limited candidate set for Reranking. Original PDF, Word, or PowerPoint files are not uploaded, but their extracted text is sent to SiliconFlow.

If SiliconFlow or the network is unavailable, DSH-RAG reports the fallback and continues with local BM25. Existing local indexes remain available. The v0.1 release does not expose AI-generated document or section context because that experiment did not improve the frozen retrieval evaluation.

## Local Data and Deletion

Derived data is stored under `$DSH_HOME/dsh-rag/` by default, independent of the directory where DSH is started. **Settings → Knowledge → Data location** shows and opens the actual folder. Set `DSH_RAG_DATA_DIR` to an absolute path before starting DSH only when you need a custom location.

When the default location is empty and legacy data exists in the old launch-directory `.dsh-rag` folder, the plugin copies, validates, and promotes it without deleting the old folder. If both locations contain data, it leaves both unchanged and reports the conflict instead of merging automatically.

The **Delete knowledge base** action uses a second confirmation and removes only the knowledge-base settings and reproducible catalogs, checkpoints, and indexes. It never modifies or deletes files in the authorized source folders.

To back up derived data, stop DSH and copy the complete data directory. Indexes are reproducible and can be rebuilt from the original folders.

## Security and Privacy

- Authorized paths are normalized and checked with `realpath`; symbolic-link, junction, UNC, and path-escape cases are rejected.
- Hidden files, common credential files, executables, active Office content, embedded objects, and unsafe archive expansion are excluded.
- Document text is treated as untrusted data, never as an Agent instruction.
- API keys are not written to project settings, logs, Sessions, browser storage, indexes, or API responses.
- Persistent keys use Windows Credential Manager, macOS Keychain, or Linux Secret Service. There is no plaintext credential-file fallback.

## License

MIT
