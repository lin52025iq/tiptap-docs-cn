# Tiptap 文档中文翻译

私有仓库：`lin52025iq/tiptap-docs-cn`。复用独立的 Node.js 翻译服务，全部批量翻译在 GitHub Actions 执行，本地不发起批量模型请求。

## 分支和发布边界

- 本仓库 `main`：自动化脚本、固定提示词、术语表、翻译缓存和进度记录。
- 本仓库 `source`：直接指向每次同步到的上游 `main` 提交，不添加文件或修改内容。
- 本仓库 `zh-cn`：首次与 `source` 完全一致，后续在对应文件内替换文案，保留上游历史。
- `lin52025iq/tiptap-docs`：当前阶段完全不写入，其 `main` 和 `zh-cn` 均保持不动；不触发正式站部署。

上游增加或删除文件时，使用一次原子推送同步 `source` 与 `zh-cn` 的文件结构。未变更的中文文件保留；新增或原文变化的文件在翻译完成前使用权威原文。译文生成后核对完整文件清单，保证两个分支的文件数量、文件路径和目录结构一致。所有缓存和进度只保存在工具 `main`，不混入文档分支。

以后确认译文后，再单独把译文分支的内容集成到 `tiptap-docs:zh-cn`。本流程不包含跨仓库发布、不保存 Vercel Token、不添加部署配置。

## 如何运行

打开 GitHub → Actions → **同步并翻译 Tiptap 文档** → Run workflow。

- `publish=true`：翻译和全部校验通过后，保存到本仓库 `zh-cn`。
- `publish=false`：只翻译、校验并保存缓存，不更新译文分支。
- `refresh_rules=false`：复用原文未变的译文，避免重复请求。
- `refresh_rules=true`：显式按当前提示词重新处理旧规则版本的译文，会增加请求。

每天北京时间 03:23 定时执行；修改脚本、提示词或翻译范围也会触发。缓存变动不会触发新任务。所有运行串行，不同时消耗模型额度。

## 首轮范围和扩展

`tiptap.config.json` 指定首页、Editor 概述、安装总览、主侧边栏和 Editor 侧边栏，以及导航、目录、复制按钮等主要界面文案。其他正文暂时保留英文。

扩展 MDX 范围：在 `content` 中增加文件或以 `/` 结尾的目录。扩展 TS/TSX 文案：在 `ui` 中增加明确的文件，提取器只选择展示文字和允许的字段，不翻译任意代码字符串。全部侧边栏可以通过 `sidebars=true` 开启。

## 翻译记录在哪里

| 文件 | 用途 |
| --- | --- |
| `state/STATUS.md` | 人可读的逐文件完成数量、待处理数量和发布状态 |
| `state/progress.json` | 机器可读状态、上游 SHA、规则哈希和失败原因 |
| `state/translations.json` | 源语言、目标语言、原文对应的译文缓存 |
| `state/published.json` | 最后保存的上游 SHA、译文分支 SHA 和文件哈希 |

Actions 的运行 Summary 也显示进度表；运行中可以在日志查看当前批次。`translated` 表示已有译文，`published` 表示已保存到私有译文分支，不表示已部署正式站。

原文新增或变化才调用模型。同一句文本可以跨文件复用；提示词变化默认不重翻旧译文，并在报告中标明复用旧规则的数量。术语表完整匹配的文案直接采用指定译法。模型名变化不强制清空旧缓存。

成功批次即时写入 Runner 的缓存；正常结束或失败后提交到本仓库 `main`，下次从剩余部分继续。强制取消或 Runner 硬超时时，尚未持久化到仓库的本轮结果可能需要重新处理。

## 固定提示词与额度

`prompts/translation.md` 定义技术文档翻译规则，`prompts/structured.md` 定义结构化文案输出格式；运行时程序加载，模型只接收待译文本、固定规则、术语表和必要上下文，不执行任何 Git 或工具操作。

请求并发固定为 1，起始间隔至少 15 秒；重试同样遵守间隔。队列拥堵和限流进行有限退避，并遵守数值型 Retry-After。该限制覆盖本 Workflow；同一个 Key 在其他服务的调用也会占用额度。

GitHub Actions Secret：`OPENAI_API_KEY`。Actions Variables：`OPENAI_BASE_URL`、`OPENAI_MODEL`。本仓库分支写入使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需个人 Token 或其他仓库的写入密钥。

## 校验和失败处理

每轮先同步 `source`，并固定本次使用的源提交；翻译过程中上游再次更新时留到下一轮处理，避免混用两个版本。MDX 通过语法树提取文字，代码、URL、组件结构和表达式保留。译文按所在上下文转义，重新检查 MDX/TS/JSX 语法并核对代码和链接。英文标题锚点保留；必要适配仅限显式 ID、页面语言和未来中文分支的编辑链接。

翻译或校验失败不更新译文分支。上游适配点改变或译文分支出现人工提交时停止，避免覆盖人工修订。人工修订应先导入缓存并核对发布记录，不能盲目修改状态绕过检查。

本地只读查看范围：

```powershell
npm ci --ignore-scripts
npm run plan
```

以下为保留的本地 HTTP 服务说明；它与云端批处理复用同一个翻译函数。

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
