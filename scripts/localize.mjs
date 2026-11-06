import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { parseDocument, isMap, isSeq, isScalar } from 'yaml'
import ts from 'typescript'
import slugify from 'slugify'

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkFrontmatter).use(remarkGfm)
const attributes = new Set(['title', 'description', 'label', 'alt', 'placeholder', 'aria-label', 'secondaryButtonText', 'tags', 'moreLink'])
export const hash = value => createHash('sha256').update(value).digest('hex')
const html = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const mdxText = value => value.replace(/[\\`*_[\]{}<>#~!|]/g, char => `&#${char.charCodeAt(0)};`)
const words = value => /[A-Za-z]/.test(value) && value.trim().length > 0

function visit(node, callback) {
  if (callback(node) === false) return
  for (const child of node.children ?? []) visit(child, callback)
}

export function extract(source, filename) {
  const edits = []
  const add = (start, end, text, mode = 'mdx') => {
    if (!words(text)) return
    edits.push({ start, end, text, mode })
  }
  if (!filename.endsWith('.mdx')) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const walk = node => {
      if (ts.isJsxText(node)) {
        const raw = node.getFullText(file)
        const text = raw.trim()
        add(node.pos + raw.indexOf(text), node.pos + raw.indexOf(text) + text.length, text, 'jsx')
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent
        const named = (ts.isPropertyAssignment(parent) && parent.name !== node && attributes.has(parent.name?.getText(file).replace(/['"]/g, '')))
          || (ts.isArrayLiteralExpression(parent) && ts.isPropertyAssignment(parent.parent) && parent.parent.name.getText(file) === 'tags')
          || (ts.isBindingElement(parent) && attributes.has(parent.name.getText(file)))
          || (ts.isJsxAttribute(parent) && attributes.has(parent.name.text))
        let ancestor = parent
        while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isSourceFile(ancestor)) ancestor = ancestor.parent
        const expressionLabel = ts.isJsxExpression(ancestor) && /^(?:[A-Z][A-Za-z]*(?:[ .…][A-Za-z]+)*\.?\.?.?|All docs|Next up|Copied markdown|Copy markdown)$/.test(node.text)
        if (named || expressionLabel) add(node.getStart(file), node.end, node.text, ts.isJsxAttribute(parent) ? 'jsxAttr' : 'js')
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
    return edits
  }
  const tree = parser.parse(source)
  visit(tree, node => {
    if (['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type) && ['code', 'pre'].includes(node.name)) return false
    if (node.type === 'text') {
      const raw = source.slice(node.position.start.offset, node.position.end.offset)
      const left = raw.length - raw.trimStart().length
      const right = raw.trimEnd().length
      add(node.position.start.offset + left, node.position.start.offset + right, node.value.trim())
    }
    if (node.type === 'yaml') {
      const document = parseDocument(node.value)
      if (document.errors.length) throw new Error(`YAML 无法解析：${filename}`)
      const offset = source.indexOf(node.value, node.position.start.offset)
      const walkYaml = (value, key = '') => {
        if (isMap(value)) for (const pair of value.items) walkYaml(pair.value, String(pair.key.value))
        else if (isSeq(value)) for (const item of value.items) walkYaml(item, key)
        else if (isScalar(value) && ['title', 'description', 'label'].includes(key) && typeof value.value === 'string') {
          add(offset + value.range[0], offset + value.range[1], value.value, 'js')
        }
      }
      walkYaml(document.contents)
    }
    if (node.type === 'heading') {
      let text = ''
      visit(node, child => { if (child.type === 'text' || child.type === 'inlineCode') text += child.value })
      const start = node.position.start.offset
      const prefix = source.slice(start).match(/^#{1,6}\s+/)?.[0]
      if (!prefix) throw new Error(`不支持的标题语法：${filename}，请人工处理`)
      edits.push({ start, end: start + prefix.length, literal: `${prefix}<span data-original-heading-id="${html(slugify(text, { strict: true, lower: true }))}">` })
      edits.push({ start: node.position.end.offset, end: node.position.end.offset, literal: '</span>' })
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      for (const attr of node.attributes ?? []) {
        if (attr.type !== 'mdxJsxAttribute' || !attributes.has(attr.name)) continue
        if (typeof attr.value === 'string') {
          add(attr.position.start.offset, attr.position.end.offset, attr.value, `attr:${attr.name}`)
        } else if (attr.value?.type === 'mdxJsxAttributeValueExpression') {
          const ast = attr.value.data?.estree
          const walkExpression = (value, parent) => {
            if (!value || typeof value !== 'object') return
            if (value.type === 'Literal' && typeof value.value === 'string'
              && (attr.name !== 'moreLink' || parent?.key?.name === 'label')) {
              add(value.start, value.end, value.value, 'js')
            }
            for (const [key, child] of Object.entries(value)) {
              if (key === 'loc' || key === 'position') continue
              if (Array.isArray(child)) for (const entry of child) walkExpression(entry, value)
              else if (child && typeof child === 'object') walkExpression(child, value)
            }
          }
          walkExpression(ast)
        }
      }
      const title = node.attributes?.find(attr => attr.name === 'title')
      if (node.name === 'Section' && typeof title?.value === 'string' && !node.attributes.some(attr => attr.name === 'id')) {
        const position = node.position.start.offset + 1 + node.name.length
        edits.push({ start: position, end: position, literal: ` id="${html(slugify(title.value, { lower: true }))}"` })
      }
    }
  })
  return edits
}

export function render(source, edits, translations) {
  let result = source
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end)
  let boundary = source.length
  for (const edit of ordered) {
    if (edit.end > boundary || !Number.isInteger(edit.start) || edit.start < 0 || edit.end > source.length) {
      throw new Error('翻译范围重叠或超出源文件')
    }
    let replacement = edit.literal
    if (replacement === undefined) {
      const value = translations(edit.text)
      replacement = edit.mode === 'js' ? JSON.stringify(value)
        : edit.mode === 'jsxAttr' ? `"${html(value)}"`
        : edit.mode.startsWith('attr:') ? `${edit.mode.slice(5)}="${html(value)}"`
          : edit.mode === 'jsx' ? html(value).replaceAll('{', '&#123;').replaceAll('}', '&#125;')
            : mdxText(value)
    }
    result = result.slice(0, edit.start) + replacement + result.slice(edit.end)
    boundary = edit.start
  }
  return result
}

// Only these explicit adaptations affect rendering; all layouts and interaction code come from upstream.
export function adapt(filename, source) {
  const replace = (from, to, count = 1) => {
    const actual = source.split(from).length - 1
    if (actual !== count) throw new Error(`上游适配点已变化：${filename}，需要人工检查`)
    source = source.replaceAll(from, to)
  }
  if (filename === 'src/mdx-components.tsx') replace('text += getHeadlineId(child.props.children)', "text += child.props['data-original-heading-id'] ?? getHeadlineId(child.props.children)")
  if (filename === 'src/components/ui/Section.tsx') {
    replace('  title: string', '  id?: string\n  title: string')
    replace('({ children, title, description, moreLink }: SectionProps)', '({ children, title, description, moreLink, id }: SectionProps)')
    replace('const titleSlug = slugify(title, { lower: true })', 'const titleSlug = id ?? slugify(title, { lower: true })')
  }
  if (filename === 'src/app/layout.tsx') replace('<html lang="en"', '<html lang="zh-CN"')
  if (filename === 'src/utils/index.ts') replace('/blob/main', '/blob/zh-cn')
  return source
}

export function checkSyntax(filename, source, original) {
  if (filename.endsWith('.mdx')) {
    const tree = parser.parse(source)
    const protectedContent = ast => {
      const values = []
      visit(ast, node => {
        if (['code', 'inlineCode', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression'].includes(node.type)) values.push([node.type, node.value])
        if (['link', 'image', 'definition'].includes(node.type)) values.push([node.type, node.url])
        for (const attr of node.attributes ?? []) {
          if (attr.type === 'mdxJsxAttribute' && !attributes.has(attr.name) && !['id', 'data-original-heading-id'].includes(attr.name)) {
            values.push([attr.name, typeof attr.value === 'string' ? attr.value : attr.value?.value])
          }
        }
      })
      return JSON.stringify(values)
    }
    if (original && protectedContent(tree) !== protectedContent(parser.parse(original))) throw new Error(`代码或链接发生变化：${filename}`)
  }
  else {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    if (file.parseDiagnostics.length) throw new Error(`TypeScript/JSX 语法错误：${filename}`)
  }
}

export function selectFiles(root, config) {
  const files = []
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const name = path.relative(root, full).split(path.sep).join('/')
        if (config.content.some(prefix => name === prefix || (prefix.endsWith('/') && name.startsWith(prefix) && name.endsWith('.mdx')))
          || (config.sidebars && name.startsWith('src/content/') && name.endsWith('/sidebar.ts'))
          || config.ui.includes(name)) files.push(name)
      }
    }
  }
  walk(path.join(root, 'src'))
  return files.sort()
}
