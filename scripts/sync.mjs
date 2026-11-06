import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { translate, instructions, structuredInstructions } from '../translate.mjs'
import { hash, extract, render, adapt, checkSyntax, selectFiles } from './localize.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(fs.readFileSync(path.join(root, 'tiptap.config.json'), 'utf8'))
const glossary = JSON.parse(fs.readFileSync(path.join(root, 'glossary.json'), 'utf8'))
const args = process.argv.slice(2)
const docs = path.resolve(args.includes('--docs') ? args[args.indexOf('--docs') + 1] : path.join(root, '.local/docs'))
const stateDir = path.join(root, 'state')
const cachePath = path.join(stateDir, 'translations.json')
const publishedPath = path.join(stateDir, 'published.json')
const pendingPath = path.join(root, '.local/pending.json')
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n') }
const progressPath = path.join(stateDir, 'progress.json')
const reportPath = path.join(stateDir, 'STATUS.md')
const rulesHash = hash(instructions + structuredInstructions + JSON.stringify(glossary))
if (!args.includes('--plan') && process.env.GITHUB_ACTIONS !== 'true') throw new Error('批量翻译和发布只在 GitHub Actions 中执行；本地请使用 --plan 查看范围。')
const git = (...parameters) => execFileSync('git', parameters, { cwd: docs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

if (args.includes('--record')) {
  const pending = readJson(pendingPath, null)
  if (!pending) throw new Error('缺少待发布记录')
  const remote = git('ls-remote', 'origin', `refs/heads/${config.branch}`).split(/\s/)[0]
  if (remote !== pending.targetSha) throw new Error('远端提交与译文不一致，拒绝记录发布状态')
  writeJson(publishedPath, pending)
  const progress = readJson(progressPath, null)
  if (progress) {
    progress.status = 'published'
    for (const file of Object.values(progress.files)) file.status = 'published'
    saveProgress(progress)
  }
  console.log(`已记录发布 ${pending.targetSha.slice(0, 8)}`)
  process.exit(0)
}

if (!fs.existsSync(path.join(docs, '.git'))) {
  fs.mkdirSync(path.dirname(docs), { recursive: true })
  execFileSync('git', ['clone', '--branch', config.branch, '--single-branch', `https://github.com/${config.repository}.git`, docs], { stdio: 'inherit' })
}
if (git('branch', '--show-current') !== 'translated-zh-cn' || config.branch !== 'translated-zh-cn'
  || config.repository !== 'lin52025iq/tiptap-docs-cn') throw new Error('当前阶段只允许在私有仓库 translated-zh-cn 分支组装译文')
if (git('status', '--porcelain')) throw new Error('文档工作区有未提交改动，请先处理')
git('fetch', `https://github.com/${config.upstream}.git`, 'main')
const upstreamSha = git('rev-parse', 'FETCH_HEAD')
const before = git('rev-parse', 'HEAD')
const published = readJson(publishedPath, null)
if (published && before !== published.targetSha) throw new Error('译文分支包含未导入的人工提交，请先核对并更新翻译记录；不会覆盖人工修改')

// --plan only reads the chosen source tree; it never calls AI or writes the docs checkout.
if (args.includes('--plan')) {
  const files = selectFiles(docs, config)
  const count = files.reduce((total, filename) => total + extract(fs.readFileSync(path.join(docs, filename), 'utf8'), filename).filter(edit => edit.text).length, 0)
  console.log(JSON.stringify({ upstreamSha, files: files.length, textRanges: count, scope: config.content }, null, 2))
  process.exit(0)
}

const previousSource = published?.upstreamSha ?? upstreamSha
const allowed = new Set(Object.keys(published?.files ?? {}))
const existingChanges = git('diff', '--name-only', previousSource, 'HEAD').split('\n').filter(Boolean)
if (existingChanges.some(filename => !allowed.has(filename))) throw new Error('发现翻译流程之外的文件改动，停止自动同步')

try {
  git('read-tree', '--reset', '-u', upstreamSha)
  const names = selectFiles(docs, config)
  const adaptations = ['src/mdx-components.tsx', 'src/components/ui/Section.tsx', 'src/app/layout.tsx', 'src/utils/index.ts']
  const files = [...new Set([...names, ...adaptations])].map(filename => {
    const source = fs.readFileSync(path.join(docs, filename), 'utf8')
    const edits = names.includes(filename) ? extract(source, filename) : []
    return { filename, source, edits }
  })
  const key = (text, sourceLanguage = config.sourceLanguage, targetLanguage = config.targetLanguage) => hash(JSON.stringify({ sourceLanguage, targetLanguage, text }))
  const cache = Object.fromEntries(Object.values(readJson(cachePath, {})).map(entry => [key(entry.source, entry.sourceLanguage ?? 'en', entry.targetLanguage ?? 'zh-CN'), entry]))
  const pendingTexts = new Map()
  const refresh = process.env.REFRESH_RULES === 'true'
  const sourceTexts = new Map()
  for (const file of files) for (const edit of file.edits) {
    if (!edit.text) continue
    const id = key(edit.text)
    sourceTexts.set(id, { id, text: edit.text, context: file.filename + '\n' + file.source.slice(Math.max(0, edit.start - 120), Math.min(file.source.length, edit.end + 120)) })
    if (glossary[edit.text]) cache[id] = { source: edit.text, translation: glossary[edit.text], rulesHash, sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage, origin: 'glossary' }
    if (!cache[id] || (refresh && cache[id].rulesHash !== rulesHash)) pendingTexts.set(id, sourceTexts.get(id))
  }
  const makeProgress = (status, error) => {
    const fileStates = {}
    for (const file of files) {
      const texts = file.edits.filter(edit => edit.text)
      const completed = texts.filter(edit => cache[key(edit.text)] && !pendingTexts.has(key(edit.text))).length
      fileStates[file.filename] = {
        sourceHash: hash(file.source), total: texts.length, completed, pending: texts.length - completed,
        status: completed === texts.length ? (status === 'published' ? 'published' : 'translated') : 'pending',
      }
    }
    const complete = [...sourceTexts.keys()].filter(id => cache[id] && !pendingTexts.has(id)).length
    const reusedWithOlderRules = [...sourceTexts.keys()].filter(id => cache[id] && cache[id].rulesHash !== rulesHash && !pendingTexts.has(id)).length
    const result = { upstreamSha, rulesHash, status, total: sourceTexts.size, completed: complete, pending: sourceTexts.size - complete, reusedWithOlderRules, files: fileStates }
    if (error) result.error = error
    return result
  }
  saveProgress(makeProgress('translating'))
  writeJson(cachePath, cache)
  const batches = []
  let batch = [], length = 0
  for (const item of pendingTexts.values()) {
    if (batch.length && (batch.length >= 25 || length + item.text.length > 3500)) { batches.push(batch); batch = []; length = 0 }
    batch.push(item); length += item.text.length
  }
  if (batch.length) batches.push(batch)
  console.log(`上游 ${upstreamSha.slice(0, 8)}；${files.length} 个文件；${pendingTexts.size} 条待翻译文本；${batches.length} 批`)
  let nextRequestAt = 0
  try {
    for (let number = 0; number < batches.length; number++) {
      const items = batches[number]
      for (let attempt = 0; ; attempt++) {
        try {
          const requestItems = items.map((item, i) => ({ id: String(i), text: item.text, context: item.context }))
          const wait = Math.max(0, nextRequestAt - Date.now())
          if (wait) await new Promise(resolve => setTimeout(resolve, wait))
          nextRequestAt = Date.now() + 15_000
          const output = await translate({ sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage, content: JSON.stringify({ items: requestItems }), glossary, structured: true })
          const result = JSON.parse(output)
          if (!Array.isArray(result.items) || result.items.length !== items.length
            || result.items.some((item, i) => item.id !== requestItems[i].id || typeof item.text !== 'string' || !item.text.trim())) {
            throw new Error('模型返回的文本数量、ID 或译文无效')
          }
          result.items.forEach((item, i) => { cache[items[i].id] = { source: items[i].text, translation: item.text.trim(), rulesHash, sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage, origin: 'agnes' }; pendingTexts.delete(items[i].id) })
          writeJson(cachePath, cache)
          saveProgress(makeProgress('translating'))
          console.log(`翻译完成 ${number + 1}/${batches.length}`)
          break
        } catch (error) {
          if (attempt >= 3 || (!error.retryable && error.name !== 'TimeoutError')) throw error
          const delay = Math.max(30 * 2 ** attempt, error.retryAfter || 0)
          console.log(`模型队列拥堵或超时，${delay} 秒后重试批次 ${number + 1}`)
          await new Promise(resolve => setTimeout(resolve, delay * 1000))
        }
      }
    }
  } catch (error) {
    saveProgress(makeProgress('failed', error.message))
    throw error
  }
  writeJson(cachePath, cache)

  // All AI output is serialized as text. Imports, expressions, URLs and executable code are never model-generated.
  const generated = files.map(file => {
    const output = adapt(file.filename, render(file.source, file.edits, text => cache[key(text)].translation))
    checkSyntax(file.filename, output, file.source)
    return { ...file, output }
  })
  const records = {}
  for (const file of generated) {
    fs.writeFileSync(path.join(docs, file.filename), file.output)
    if (file.output !== file.source) records[file.filename] = { sourceHash: hash(file.source), targetHash: hash(file.output) }
  }
  git('add', '--all')
  const changed = git('diff', '--cached', '--name-only')
  let targetSha = before
  const inherited = spawnSync('git', ['merge-base', '--is-ancestor', upstreamSha, before], { cwd: docs }).status === 0
  if (changed || !inherited) {
    const tree = git('write-tree')
    const parents = ['-p', before, ...(!inherited ? ['-p', upstreamSha] : [])]
    const message = `docs: 同步上游并更新首页、Editor 入门和导航汉化\n\nUpstream: ${upstreamSha}\nLocalized files: ${Object.keys(records).length}\n`
    targetSha = execFileSync('git', ['commit-tree', tree, ...parents], {
      cwd: docs, input: message, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'lin52025iq', GIT_AUTHOR_EMAIL: '87741822+lin52025iq@users.noreply.github.com', GIT_COMMITTER_NAME: 'lin52025iq', GIT_COMMITTER_EMAIL: '87741822+lin52025iq@users.noreply.github.com' },
    }).trim()
    git('update-ref', 'HEAD', targetSha, before)
  }
  writeJson(pendingPath, { upstreamSha, targetSha, files: records })
  saveProgress(makeProgress('ready'))
  console.log(changed ? `译文已组装并通过语法检查：${targetSha.slice(0, 8)}，尚未推送` : '译文无变化，不创建内容提交')

} catch (error) {
  const progress = readJson(progressPath, null)
  if (progress) { progress.status = 'failed'; progress.error = error.message; saveProgress(progress) }
  git('read-tree', '--reset', '-u', before)
  throw error
}

function saveProgress(progress) {
  writeJson(progressPath, progress)
  const lines = [
    '# 翻译进度', '',
    `状态：${progress.status}；上游：\`${progress.upstreamSha}\``, '',
    `去重文本：${progress.total}；已完成：${progress.completed}；待处理：${progress.pending}`, '',
    `复用旧规则译文：${progress.reusedWithOlderRules}（只有显式选择 refresh_rules 才会重翻）`, '',
    'translated 表示已有译文；published 表示已保存到私有仓库 translated-zh-cn，尚未合并到 tiptap-docs 或部署正式站。', '',
    '| 文件 | 完成 / 总数 | 状态 |', '| --- | ---: | --- |',
    ...Object.entries(progress.files).map(([name, file]) => `| ${name} | ${file.completed} / ${file.total} | ${file.status} |`),
  ]
  if (progress.error) lines.push('', '失败原因：', '', progress.error.replaceAll('\n', ' '))
  fs.writeFileSync(reportPath, lines.join('\n') + '\n')
}
