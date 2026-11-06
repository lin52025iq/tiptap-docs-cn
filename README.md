# AI 翻译服务

独立的 Node.js 翻译项目，私有仓库 `lin52025iq/tiptap-docs-cn`。保留原来的本地 HTTP 服务，并复用同一个翻译函数完成 Tiptap 文档的增量汉化。

## Tiptap 自动汉化

文档目标为 `lin52025iq/tiptap-docs` 的 `zh-cn`。本工具**不写入文档仓库的 main**，也不添加 Vercel、Workers 或其他部署配置。它在临时目录读取上游 `ueberdosis/tiptap-docs/main`，翻译后在 `zh-cn` 生成一个集成提交；上游有更新时保留其 Git 祖先关系。

首期范围由 `tiptap.config.json` 指定：首页、全部 Editor 入门文档、侧边栏和主要导航。其他正文保留英文。增加范围只需在该文件增加路径。`glossary.json` 维护统一术语。

```powershell
npm ci --ignore-scripts
npm run plan
```

`plan` 只检查范围和语法，不调用模型。`sync` 批量流程只允许在 GitHub Actions 执行，本地不会调用模型进行批量翻译。使用 GitHub Actions 的“同步并翻译 Tiptap 文档”，支持手动运行和每天北京时间 03:23 定时运行。

GitHub Actions 配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `OPENAI_API_KEY` | Agnes API Key |
| Variable | `OPENAI_BASE_URL` | API 基础地址，包含 `/v1`，不包含 `/responses` |
| Variable | `OPENAI_MODEL` | 模型名称 |
| Secret | `DOCS_DEPLOY_KEY` | 仅用于目标文档仓库的专用 SSH 写入密钥 |

Workflow 只从本私有仓库的 `main` 执行可信脚本，不由外部 PR 触发。翻译步骤才接收模型密钥，发布步骤才接收目标仓库密钥。发布目标固定为 `zh-cn`；本私有仓库的 `main` 仅记录工具和缓存，与文档仓库 `main` 是两个不同分支。

MDX 使用语法树提取可见文本，模型不生成组件、表达式或链接。译文按上下文类型进行转义并重新解析，原英文章节锚点保留。必要的渲染适配限于显式 ID、页面语言和中文分支的编辑链接。上游适配点发生变化时停止并要求人工核对。

`state/STATUS.md` 展示逐文件完成数量及发布状态，Actions 的运行 Summary 也显示同一份报告。`state/progress.json` 提供机器可读状态，包括失败原因和复用旧规则的数量。`state/translations.json` 保存源语言、目标语言及原文哈希对应的译文；`state/published.json` 记录最后发布的上游提交、目标提交及文件哈希。原文未变时不重新调用模型，没有文件变化时不生成文档提交。失败不发布；已完成缓存会保存，下次继续。首次全量处理按配置的范围执行，后续仍只翻译该范围内的变化。

提示词固定在 `prompts/translation.md` 和 `prompts/structured.md`，运行时自动加载，模型只接收待译内容及必要上下文。默认复用原文未变的译文；修改提示词或术语规则后，可手动勾选 `refresh_rules` 重翻旧规则译文。术语表中的完整匹配词会直接更新，不为无关术语变化重翻全库。

请求串行执行，起始间隔至少 15 秒，重试也遵守间隔。队列拥堵和限流进行有限退避，并遵守数值型 Retry-After。同一个 Key 在其他应用的请求也会占用额度。失败时保存本轮成功缓存，下次继续；Runner 被强制取消时，尚未持久化的本轮结果可能需要重新处理。

如果有人直接修改 `zh-cn`，流程会检测到提交变化并停止，避免覆盖人工修订。应先核对修订，将其导入缓存并更新发布记录后再继续，不能盲目修改状态绕过检查。Workflow 的 `publish=false` 只生成并缓存译文，不更新站点。

推送完成后由现有 Vercel Git 集成自动构建；本项目不保存 Vercel Token，也不调用额外的部署钩子。Vercel 构建失败时生产站点保留上一个成功版本。

## 启动

HTTP 服务需要 Node.js 22.9 或更高版本。自动汉化建议 Node.js 24，并先执行 `npm ci --ignore-scripts` 安装解析器。

在 PowerShell 中执行：

```powershell
cd C:\Users\Administrator\Desktop\tiptap\ai-translator
Copy-Item .env.example .env
notepad .env
```

在 `.env` 中填写模型供应商提供的 API Key 和你有权限使用的模型名称：

```dotenv
OPENAI_API_KEY=你的API密钥
OPENAI_MODEL=你的模型名称
OPENAI_BASE_URL=https://api.openai.com/v1
PORT=3001
```

然后启动（按 Ctrl+C 停止）：

```powershell
node --env-file-if-exists=.env server.mjs
```

也可以使用 `npm start` 或 `pnpm start`。已设置的系统环境变量优先于 `.env`。

`OPENAI_BASE_URL` 是 API 基础地址，服务会在其后添加 `/responses`。其他供应商必须支持 OpenAI Responses API；仅支持 `/chat/completions` 的接口不能直接使用。模型和供应商配置仅由服务端环境变量控制。批量结构化翻译使用同一供应商的 `/chat/completions`，并关闭 Agnes Thinking，以减少纯翻译任务的额外推理。

## 调用

```powershell
$body = @{
  sourceLanguage = 'en'
  targetLanguage = 'zh-CN'
  content = 'Tiptap is a headless editor framework.'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:3001/translate' `
  -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

请求格式：

```json
{
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "content": "Tiptap is a headless editor framework."
}
```

响应示例（具体译文由模型决定）：

```json
{
  "translation": "Tiptap 是一个无头编辑器框架。"
}
```

三个字段均为必填非空字符串。语言可以填写 `en`、`zh-CN`、`ja` 等代码或明确的语言名称；内容支持多行文本和 Markdown。每次请求独立，不保留对话记忆。

错误统一返回 `{ "error": "错误说明" }`：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 或参数无效 |
| 404 / 405 | 路径或方法错误 |
| 413 | 请求体超过 128 KiB，请按段落拆分 |
| 415 | Content-Type 不是 application/json |
| 502 | 模型调用失败、拒绝翻译或未返回完整译文 |
| 504 | 模型请求超过 120 秒 |

## 使用范围

- 固定绑定 `127.0.0.1`，作为无需登录的本地工具使用；不提供跨域访问配置。若需要对外部署，需先接入认证与调用额度控制，避免 API 费用被滥用。
- `.env` 已被 Git 忽略；不要将密钥写入源码或提交到仓库。
- 请求内容会发送至所配置的模型供应商，模型调用可能产生费用。`store: false` 不等同于供应商零数据保留承诺。
- 翻译规则位于 `prompts/translation.md` 中，HTTP 服务与自动汉化共同使用。
- Markdown 格式保留由提示词引导，不保证复杂 MDX/JSX 结构不变。Tiptap 自动汉化应先提取文本再调用本服务，不直接将返回值当作可执行 MDX 发布。
- 本项目不包含数据库、自动重试或 Agent 框架。

## 调用已启动的服务

先在一个终端运行 `npm start`，再在另一个终端运行：

```powershell
npm test
```

`server.test.mjs` 内置了一段 Tiptap 英文文档，直接调用已经启动的本地服务并打印译文。修改文件顶部的 `sourceLanguage`、`targetLanguage` 和 `content` 即可更换语言和内容。端口读取 `.env` 或环境变量的 `PORT`，默认 3001。

该脚本会通过翻译服务真实调用配置的模型，可能产生 API 费用。它不会启动服务或模拟模型。
