# DSH-RAG

[English](./README.md) | 简体中文

面向 DeepSeek Harness Web 的本地知识库插件。DSH-RAG 只索引用户明确授权的本机目录，并且只有在执行 `/dsh-rag <问题>` 时才检索，返回可以核查和打开的原始来源。

## 功能

- 支持多个命名知识库，每个知识库可包含一个或多个授权目录。
- 解析 PDF、DOCX、PPTX、Markdown 和 UTF-8 文本，并提供页码、幻灯片、段落或行号定位。
- 增量索引支持取消、文件级检查点、watcher 防抖和补偿扫描。
- 本地中英文 BM25 不依赖 API Key 或网络，离线时仍可使用。
- 配置 SiliconFlow 后，可使用 `BAAI/bge-m3` Embedding、本地向量、RRF 和 `BAAI/bge-reranker-v2-m3` Reranker。
- 按 Session 选择允许检索的知识库；普通消息不会搜索或注入本地资料。
- 中英文界面跟随 DeepSeek Harness 的语言设置，并适配浅色、深色和系统外观。
- 来源卡片可以打开原文件，路径会先由 Host 重新验证。

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness `0.1.1-rc.2`

DeepSeek Harness 目前仍处于开发者预览期。DSH-RAG 只对实际通过安装、启动和卸载验证的版本声明兼容。

## 安装或更新

```powershell
dsh plugin --profile web add @kai232/dsh-rag@0.1.0
dsh --profile web --no-open
```

更新已有安装时仍使用同一条 `plugin add` 命令，完成后重启 Web Profile。

## 创建知识库

1. 打开 **设置 → 知识库**。
2. 复核 SiliconFlow Endpoint、Embedding 模型和 Reranker 模型。
3. 输入 SiliconFlow API Key，保存到操作系统凭据库，或者选择仅当前 Host 会话使用。也可以在启动 DSH 前设置 `SILICONFLOW_API_KEY`。
4. 使用固定文本测试连接；该测试不会发送知识库正文。
5. 输入知识库名称，以及你明确授权的本机目录绝对路径。
6. 点击 **同步**，等待索引完成。
7. 在会话的 **知识库** 面板中，选择当前 Session 允许检索的知识库。

知识库名称和文件名属于用户数据，切换界面语言时不会被翻译。

## 使用方式

输入显式检索命令：

```text
/dsh-rag 项目记录中的发布时间窗口是什么？
```

命令只检索当前 Session 已选择的知识库。没有选择时，插件会提示先选择，不会自动搜索全部知识库。下一条普通消息会恢复为零检索。

检索结果会显示知识库、文件名、结构上下文、原文片段和精确位置。打开原文件时，界面只提交不透明的来源 ID，Host 重新解析并验证路径后才交给操作系统打开。

## 检索与离线降级

配置 SiliconFlow 后，建立索引时只为新增或变化的提取文本片段请求 Embedding；显式查询时只向 Reranker 发送查询和有限候选。原始文件二进制永远不会上传。

SiliconFlow 或网络不可用时，界面会明确显示降级，并继续使用本地 BM25；已有本地索引仍可检索。AI 生成的文档或章节背景没有提高冻结评测指标，因此 v0.1 不提供该能力。

## 本机数据与删除

派生数据默认保存在 `$DSH_HOME/dsh-rag-data/`。如需使用其他位置，请在启动 DSH 前将 `DSH_RAG_DATA_DIR` 设置为绝对路径。

设置页的 **删除知识库** 需要二次确认，只删除知识库配置和可再生的 catalog、检查点与索引，绝不会修改或删除授权目录中的原始资料。

备份派生数据时，应先停止 DSH，再复制整个数据目录。索引可以根据原始目录重新建立。

## 安全与隐私

- 授权路径经过规范化和 `realpath` 复核，拒绝符号链接、junction、UNC 和路径逃逸。
- 默认排除隐藏文件、常见凭据文件、可执行文件、Office 活动内容、嵌入对象和危险压缩展开。
- 文档文本始终是不可信数据，不会作为 Agent 指令执行。
- API Key 不会写入项目设置、日志、Session、浏览器存储、索引或 API 响应。
- 持久 Key 使用 Windows Credential Manager、macOS Keychain 或 Linux Secret Service，不提供明文凭据文件回退。

## 开发

```powershell
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run pack:check
```

## License

MIT
