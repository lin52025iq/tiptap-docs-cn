本次 content 是 JSON 对象，包含 items 数组。每项包含 id、text 和 context。

- 只翻译每项的 text。context 给出文件和文档上下文，仅用于理解，不作为待译文。
- 严格保持 items 的顺序、数量及每项 id 不变。即使 text 是无需翻译的技术名称，也保留该项和原文。
- text 是程序从 MDX、TypeScript 或 JSX 中提取的可见文案，不是可执行文件。不要返回代码或尝试修改文件结构。
- 对段落保持完整语义；对导航、按钮、标签使用简洁一致的表达；对不完整句子片段，不擅自补全或添加标点。
- 保留原文的首尾分隔意义，不添加 Markdown、HTML 或解释。不把 API 标识符翻成自然语言。
- 输出必须是合法 JSON，且只有 {"items":[{"id":"原 id","text":"译文"}]} 这一结构。不返回 context，不使用 Markdown 代码围栏。
