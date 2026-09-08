import { defineConfig } from 'vitepress';

const base = process.env['DOCS_BASE'] ?? '/optik-sol/';

const sharedTheme = {
  logo: '/optik-mark.svg',
  siteTitle: 'Optik Sol',
  search: { provider: 'local' as const },
  socialLinks: [{ icon: 'github' as const, link: 'https://github.com/Moresyl/optik-sol' }],
  externalLinkIcon: true,
};

export default defineConfig({
  base,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://moresyl.github.io/optik-sol/',
  },
  head: [
    ['meta', { name: 'theme-color', content: '#f7f9fc', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#090d16', media: '(prefers-color-scheme: dark)' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['link', { rel: 'icon', href: `${base}optik-mark.svg`, type: 'image/svg+xml' }],
  ],
  themeConfig: sharedTheme,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'Optik Sol',
      description: '面向移动浏览器与 WebView 的零服务端调试控制台',
      markdown: {
        codeCopyButton: { tooltipText: '复制代码', copiedText: '已复制' },
        container: {
          infoLabel: '信息',
          tipLabel: '提示',
          warningLabel: '警告',
          dangerLabel: '危险',
          detailsLabel: '详细信息',
        },
      },
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/getting-started', activeMatch: '/guide/' },
          { text: 'API', link: '/reference/api', activeMatch: '/reference/' },
          { text: '架构', link: '/concepts/architecture', activeMatch: '/concepts/' },
          { text: '能力对比', link: '/comparison' },
          { text: 'v0.4.1', link: 'https://github.com/Moresyl/optik-sol/releases/tag/v0.4.1' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: '使用指南',
              items: [
                { text: '快速开始', link: '/guide/getting-started' },
                { text: '配置参考', link: '/guide/configuration' },
                { text: '实战配方', link: '/guide/recipes' },
                { text: '故障排查', link: '/guide/troubleshooting' },
              ],
            },
          ],
          '/reference/': [
            {
              text: '参考',
              items: [
                { text: '公开 API', link: '/reference/api' },
                { text: '协议与传输', link: '/reference/protocol' },
              ],
            },
          ],
          '/concepts/': [
            {
              text: '核心概念',
              items: [
                { text: '架构', link: '/concepts/architecture' },
                { text: '隐私与安全', link: '/concepts/security' },
                { text: '性能边界', link: '/concepts/performance' },
              ],
            },
          ],
        },
        outline: { level: [2, 3], label: '本页目录' },
        editLink: {
          pattern: 'https://github.com/Moresyl/optik-sol/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页',
        },
        lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium', timeStyle: 'short' } },
        docFooter: { prev: '上一页', next: '下一页' },
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色主题',
        darkModeSwitchTitle: '切换到深色主题',
        sidebarMenuLabel: '文档导航',
        returnToTopLabel: '返回顶部',
        langMenuLabel: '切换语言',
        skipToContentLabel: '跳到正文',
        footer: {
          message: '以 MIT 许可证发布',
          copyright: 'Copyright © 2026 Moresyl and contributors',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Optik Sol',
      description: 'A serverless debugging console for mobile browsers and WebViews',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/getting-started', activeMatch: '/en/guide/' },
          { text: 'API', link: '/en/reference/api', activeMatch: '/en/reference/' },
          { text: 'Architecture', link: '/en/concepts/architecture', activeMatch: '/en/concepts/' },
          { text: 'Comparison', link: '/en/comparison' },
          { text: 'v0.4.1', link: 'https://github.com/Moresyl/optik-sol/releases/tag/v0.4.1' },
        ],
        sidebar: {
          '/en/guide/': [
            {
              text: 'Guide',
              items: [
                { text: 'Getting Started', link: '/en/guide/getting-started' },
                { text: 'Configuration', link: '/en/guide/configuration' },
                { text: 'Recipes', link: '/en/guide/recipes' },
                { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
              ],
            },
          ],
          '/en/reference/': [
            {
              text: 'Reference',
              items: [
                { text: 'Public API', link: '/en/reference/api' },
                { text: 'Protocol & Transport', link: '/en/reference/protocol' },
              ],
            },
          ],
          '/en/concepts/': [
            {
              text: 'Concepts',
              items: [
                { text: 'Architecture', link: '/en/concepts/architecture' },
                { text: 'Privacy & Security', link: '/en/concepts/security' },
                { text: 'Performance Boundaries', link: '/en/concepts/performance' },
              ],
            },
          ],
        },
        outline: { level: [2, 3], label: 'On this page' },
        editLink: {
          pattern: 'https://github.com/Moresyl/optik-sol/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'medium', timeStyle: 'short' } },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        footer: {
          message: 'Released under the MIT License',
          copyright: 'Copyright © 2026 Moresyl and contributors',
        },
      },
    },
  },
});
