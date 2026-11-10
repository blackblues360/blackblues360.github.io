import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5178 },
  build: { outDir: mode === 'pages' ? 'published' : 'dist' },
  plugins: mode === 'pages' ? [{
    name: 'qpcr-shared-login',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const script = /<script type="module" crossorigin src="(\.\/assets\/[\w.-]+\.js)"><\/script>/;
        if (!script.test(html)) throw new Error('Missing qPCR Pages module entry');
        return html
          .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-tool-page>')
          .replace(script, '<script type="module" src="../../assets/js/account/tool-access.mjs" data-tool-entry="$1"></script>')
          .replace('</head>', '<link rel="icon" href="icon.svg" type="image/svg+xml">\n  <link rel="stylesheet" href="../../assets/css/tool-access.css">\n</head>')
          .replace('<body>', `<body>
  <section id="toolAccessGate" aria-labelledby="toolAccessTitle">
    <h1 id="toolAccessTitle">登录后使用 qPCR Analyzer</h1>
    <p role="status" aria-live="polite">正在检查登录状态…</p>
    <nav><a data-tool-login href="../../account/">前往登录</a><a href="../../">返回首页</a><button type="button">重试</button></nav>
  </section>
  `);
      },
    },
  }] : [],
}));
