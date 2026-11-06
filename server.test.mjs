// 修改这三个字段即可翻译其他内容；运行前先启动翻译服务。
const input = {
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  content: `# Getting started with Tiptap

Tiptap is a headless editor framework that gives you full control over your user interface.

Install the required packages, create an editor instance, and add extensions to customize its behavior.

Use the \`useEditor\` hook to integrate Tiptap into your React application.`,
}

const endpoint = `http://127.0.0.1:${process.env.PORT || 3001}/translate`

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(130_000),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${result.error}`)
  }
  console.log(result.translation)
} catch (error) {
  console.error(`翻译失败：${error.message}`)
  console.error(`请确认翻译服务已启动，地址为 ${endpoint}`)
  process.exitCode = 1
}
