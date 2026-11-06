import { SidebarConfig } from '@/types'

export const sidebarConfig: SidebarConfig = {
  id: 'all-docs',
  rootHref: '/',
  title: "首页",
  items: [
    {
      type: 'group',
      title: "入门指南",
      href: '/getting-started',
      children: [
        {
          href: '/',
          title: "概述",
        },
        {
          href: '/resources/whats-new',
          title: "3.0 的新增功能",
        },
        {
          href: '/authentication',
          title: "身份验证",
          tags: ["新增"],
          children: [
            {
              href: '/authentication/migrate',
              title: "从旧版本迁移",
            },
            {
              href: '/authentication/legacy',
              title: "旧版认证",
            },
          ],
        },
      ],
    },
    {
      type: 'group',
      title: "按功能浏览",
      href: '/suite-docs',
      children: [
        {
          href: '/editor/getting-started/overview',
          title: "编辑器",
        },
        {
          href: '/ai/ai-toolkit/overview',
          title: "AI 工具包",
        },
        {
          href: '/collaboration/getting-started/overview',
          title: "协作",
        },
        {
          href: '/comments/getting-started/overview',
          title: "评论",
        },
        {
          href: '/compare/getting-started/overview',
          title: "对比",
        },
        {
          href: '/composable-docs/slots/getting-started/overview',
          title: "可组合文档",
        },
        {
          href: '/conversion/getting-started/overview',
          title: "转换",
        },
        {
          href: '/pages/getting-started/overview',
          title: "页面",
        },
        {
          href: '/collaboration/documents/snapshot',
          title: "快照",
        },
        {
          href: '/tracked-changes/getting-started/overview',
          title: "修订跟踪",
        },
      ],
    },
    {
      type: 'group',
      title: "资源",
      href: '/',
      children: [
        {
          href: '/guides',
          title: "指南",
        },
        {
          href: '/examples',
          title: "示例",
        },
        {
          href: '/resources/agent-skill',
          title: "代理技能",
        },
        {
          href: '/resources/tiptap-trial',
          title: "Tiptap 试用",
        },
        {
          href: '/resources/contributing',
          title: "贡献指南",
        },
        {
          href: '/resources/changelog',
          title: "编辑器更新日志",
        },
        {
          href: '/resources/incidents',
          title: "事件",
        },
        {
          href: 'https://tiptap.dev/pro-license',
          title: "专业版许可",
        },
      ],
    },
  ],
}
