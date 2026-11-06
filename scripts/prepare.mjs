import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hash } from './localize.mjs'

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('分支同步只在 GitHub Actions 执行')
const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(fs.readFileSync(path.join(root, 'tiptap.config.json'), 'utf8'))
if (config.repository !== 'lin52025iq/tiptap-docs-cn' || config.branch !== 'zh-cn') throw new Error('禁止写入其他仓库或分支')
const docs = path.join(root, '.local/docs')
fs.mkdirSync(path.dirname(docs), { recursive: true })
execFileSync('git', ['clone', '--branch', 'zh-cn', '--single-branch', `https://github.com/${config.repository}.git`, docs], { stdio: 'inherit' })
const git = (...args) => execFileSync('git', args, { cwd: docs, encoding: 'utf8' }).trim()
const before = git('rev-parse', 'HEAD')
const recordPath = path.join(root, 'state/published.json')
let record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : { upstreamSha: before, targetSha: before, files: {} }
if (before !== record.targetSha) throw new Error('zh-cn 包含未导入的人工提交，停止同步以保留修订')
git('fetch', `https://github.com/${config.upstream}.git`, 'main')
const sourceSha = git('rev-parse', 'FETCH_HEAD')
git('update-ref', 'refs/remotes/origin/source', sourceSha)
const sourceBefore = git('ls-remote', 'origin', 'refs/heads/source').split(/\s/)[0]
const sourceFiles = git('ls-tree', '-r', '--name-only', sourceSha)
let baselineSha = before

// When paths change, align both branches in one atomic push. Unchanged translated files keep their content;
// new or changed source files temporarily retain authoritative English until translation succeeds.
if (sourceFiles !== git('ls-tree', '-r', '--name-only', before)) {
  git('read-tree', '--reset', '-u', sourceSha)
  const names = new Set(sourceFiles.split('\n'))
  const retained = {}
  for (const [filename, file] of Object.entries(record.files)) {
    if (!names.has(filename)) continue
    const source = fs.readFileSync(path.join(docs, filename))
    if (hash(source) !== file.sourceHash) continue
    const translation = execFileSync('git', ['show', `${before}:${filename}`], { cwd: docs })
    fs.writeFileSync(path.join(docs, filename), translation)
    retained[filename] = file
  }
  git('add', '--all')
  if (git('ls-files') !== sourceFiles) throw new Error('文件结构同步失败')
  const tree = git('write-tree')
  baselineSha = execFileSync('git', ['commit-tree', tree, '-p', before, '-p', sourceSha], {
    cwd: docs, encoding: 'utf8', input: `chore: 同步上游文件结构\n\nUpstream: ${sourceSha}\n`,
    env: { ...process.env, GIT_AUTHOR_NAME: 'lin52025iq', GIT_AUTHOR_EMAIL: '87741822+lin52025iq@users.noreply.github.com', GIT_COMMITTER_NAME: 'lin52025iq', GIT_COMMITTER_EMAIL: '87741822+lin52025iq@users.noreply.github.com' },
  }).trim()
  git('update-ref', 'HEAD', baselineSha, before)
  record = { upstreamSha: sourceSha, targetSha: baselineSha, files: retained }
}
git('push', '--atomic', `--force-with-lease=refs/heads/source:${sourceBefore}`, 'origin', `${sourceSha}:refs/heads/source`, `${baselineSha}:refs/heads/zh-cn`)
fs.mkdirSync(path.dirname(recordPath), { recursive: true })
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
console.log(`source 已同步 ${sourceSha.slice(0, 8)}；zh-cn 文件清单一致；不写入正式文档仓库`)
