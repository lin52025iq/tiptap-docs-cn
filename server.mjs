import { createServer } from 'node:http'
import { translate } from './translate.mjs'

const apiKey = process.env.OPENAI_API_KEY?.trim()
const model = process.env.OPENAI_MODEL?.trim()
const port = Number(process.env.PORT || 3001)
const maxBodyBytes = 128 * 1024

if (!apiKey || !model) {
  console.error('请在 .env 或环境变量中设置 OPENAI_API_KEY 和 OPENAI_MODEL。')
  process.exit(1)
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是 1～65535 之间的整数。')
  process.exit(1)
}


function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

// 在 HTTP 边界限制体积；超限后丢弃后续数据，不继续缓存。
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        chunks.length = 0
        reject(Object.assign(new Error('请求体不能超过 128 KiB。'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
    request.on('aborted', () => reject(new Error('请求已中断。')))
  })
}

const server = createServer(async (request, response) => {
  if (request.url !== '/translate') {
    return sendJson(response, 404, { error: '接口不存在。' })
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { error: '请使用 POST /translate。' })
  }
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return sendJson(response, 415, { error: 'Content-Type 必须是 application/json。' })
  }

  try {
    const body = await readBody(request)
    let input
    try {
      input = JSON.parse(body)
    } catch {
      return sendJson(response, 400, { error: '请求体必须是有效的 JSON。' })
    }
    if (
      !input ||
      typeof input.sourceLanguage !== 'string' ||
      !input.sourceLanguage.trim() ||
      input.sourceLanguage.length > 100 ||
      typeof input.targetLanguage !== 'string' ||
      !input.targetLanguage.trim() ||
      input.targetLanguage.length > 100 ||
      typeof input.content !== 'string' ||
      !input.content.trim()
    ) {
      return sendJson(response, 400, {
        error: 'sourceLanguage、targetLanguage 和 content 必须是非空字符串，语言名称最多 100 个字符。',
      })
    }

    const translation = await translate({
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      content: input.content,
    })

    sendJson(response, 200, { translation })
  } catch (error) {
    if (response.destroyed) return
    const status = error.status === 413 ? 413 : error.name === 'TimeoutError' ? 504 : 502
    const message = status === 413 ? error.message : status === 504 ? '翻译请求超时。' : '翻译请求失败，请检查模型服务连接和配置。'
    sendJson(response, status, { error: message })
  }
})

server.requestTimeout = 30_000
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请修改 PORT。` : '服务启动失败，请检查端口和系统配置。')
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  console.log(`翻译服务已启动：http://127.0.0.1:${port}/translate`)
})
