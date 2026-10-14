# 血栓文献 RAG · DeepSeek Harness 插件

基于 [imkelt/DSH-RAG](https://github.com/imkelt/DSH-RAG) 的 MIT 许可开发，适配 DeepSeek Harness **0.2.0-rc.2**。原始版权声明保留在 LICENSE。

将本地论文、补充材料和精读笔记接入 Harness，在同一界面中检索、筛选和生成带来源的回答。问答使用 Harness 当前选择的模型；目标模型为 DeepSeek V4 Pro（`deepseek-v4-pro`），不要求插件另外保存 DeepSeek 密钥。

## 功能

- PDF、DOCX、PPTX、Markdown 和文本的增量索引，保留文件页码或段落/行位置。
- 文献元数据：标题、作者、年份、DOI、原始编号和技术类别。
- 区分论文正文、精读笔记、题录/摘要记录、补充材料和学位论文。
- 技术、材料类型、年份筛选；同一筛选范围用于本地检索和 `/rag` 问答。
- 中文医学术语扩展至英文关键词，精确查询词获得较高权重；同一论文的来源数量受控。
- 检索结果显示 `[S1]` 等编号；PDF 可以直接打开对应文件页。
- 问答之前先完成检索；无匹配资料时不调用模型生成答案。
- 按流式读取计算文件摘要，逐份解析，避免将全部 PDF 同时放入内存。

默认检索为 **本地 BM25＋医学术语扩展**，不是语义向量检索。保留上游可选向量和重排能力；仅设置 `DSH_RAG_CLOUD_RETRIEVAL=1` 才启用 SiliconFlow 云检索。启用后提取的文献文本会发送到该服务，问答模型的 DeepSeek 配置与此独立。

## 安装

要求符合 package.json 要求的 Node.js 与 pnpm。先构建本项目，再安装到 Harness profile：

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
dsh plugin --profile web add ./
```

也可以使用构建后的 `.tgz` 插件包安装。运行前设置索引目录：

```powershell
$env:DSH_RAG_DATA_DIR = 'D:\LiteratureRAG\indexes'
$env:DSH_RAG_CLOUD_RETRIEVAL = '0'
dsh web
```

在 Harness 中选择 DeepSeek V4 Pro。现有 DeepSeek 凭据由 Harness 管理；如果尚未配置，在 Harness 的模型/账号设置中完成，不要把密钥写入知识库或提交到仓库。

## 使用

1. 在“设置 → 知识库”中添加资料目录，并同步索引。
2. 在会话的“知识库”页中勾选需要检索的知识库。
3. 输入问题，选择技术类别、材料类型及年份。
4. “本地检索”只查询本地索引；“检索并提问”调用当前选中的 Harness 模型，并沿用筛选条件。
5. 检查回答对应的 `[S1]` 来源卡片，点击“打开 PDF 原文页”核对正文。

也可直接输入：

```text
/rag @血栓文献 CLOT OUT 的研究设计是什么？请区分人体和离体证据。
```

问答通过 Harness 的指令接口提交，不会覆盖聊天输入框中的草稿。

## 整理已有文献

`scripts/prepare-corpus.py` 接收包含 `papers` 数组的整合题录 JSON，复制正文、保留原始文件的 SHA-256 摘要，并产生带来源说明的笔记和 `literature-manifest.json`。主文按文件内容去重；既有题录中的 DOI/题名去重关系会保留。补充材料与主文保持关联，题录记录不会冒充全文。

```powershell
python scripts/prepare-corpus.py --catalog sources.json --output D:\LiteratureRAG\corpus
node --import tsx scripts/ingest.ts --corpus D:\LiteratureRAG\corpus --data D:\LiteratureRAG\indexes
```

本地数据与代码仓库分开存放。PDF、Office 文件、索引、运行日志及密钥均不应提交到公开仓库。

## 验证与边界

```powershell
pnpm run lint
pnpm run typecheck
pnpm test
node --import tsx scripts/evaluate-local.ts D:\LiteratureRAG\indexes
```

索引以可提取文字为主，不包含图片的视觉解读，也不能保证复杂表格、公式或多栏版式的还原。扫描 PDF 需要先完成 OCR。参考文献区域进行启发式排除，必要时仍应核对原文。引用编号和来源定位有程序约束，模型结论仍需对照证据核验。

当前版本只声明已测试的 Harness 版本；框架升级后应重新执行安装、启动和界面检查。
