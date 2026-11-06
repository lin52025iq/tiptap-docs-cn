import { readFileSync } from 'node:fs'

export const instructions = readFileSync(new URL('./prompts/translation.md', import.meta.url), 'utf8')
export const structuredInstructions = readFileSync(new URL('./prompts/structured.md', import.meta.url), 'utf8')

export async function translate({ sourceLanguage, targetLanguage, content, glossary, structured = false }) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) {
    throw new Error('缺少 OPENAI_API_KEY 或 OPENAI_MODEL。')
  }
  const prompt = instructions + (structured ? '\n' + structuredInstructions : '')
  const input = JSON.stringify({ sourceLanguage, targetLanguage, glossary, content })
  const response = await fetch(`${baseUrl}/${structured ? 'chat/completions' : 'responses'}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL.trim(),
      stream: false,
      ...(structured
        ? { messages: [{ role: 'system', content: prompt }, { role: 'user', content: input }], chat_template_kwargs: { enable_thinking: false } }
        : { store: false, instructions: prompt, input }),
    }),
    signal: AbortSignal.timeout(structured ? 300_000 : 120_000),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const detail = typeof error?.error?.message === 'string'
      ? error.error.message.replaceAll(process.env.OPENAI_API_KEY.trim(), '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 240)
      : ''
    throw Object.assign(new Error(`模型服务请求失败（HTTP ${response.status}）：${detail}`), {
      status: 502,
      retryable: response.status === 429 || response.status >= 500 || detail.includes('request queue is full'),
      retryAfter: Number(response.headers.get('retry-after')) || 0,
    })
  }
  const result = await response.json()
  if (structured) {
    const choice = result.choices?.[0]
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
      throw Object.assign(new Error('模型未返回完整译文。'), { status: 502 })
    }
    return choice.message.content
  }
  const parts = (result.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])
  const translation = parts.filter(part => part.type === 'output_text').map(part => part.text).join('')
  if (result.status !== 'completed' || parts.some(part => part.type === 'refusal') || !translation.trim()) {
    throw Object.assign(new Error('模型未返回完整译文。'), { status: 502 })
  }
  return translation
}
