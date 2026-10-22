# BLACK BLUES

BLACK BLUES 是一个部署在 GitHub Pages 上的纯静态个人主页。

## 结构

- `index.html`：首页结构，包含网页搜索入口和书签容器。
- `config/links.json`：首页书签分类和链接数据。
- `assets/css/theme.css`：当前站点主样式。
- `assets/js/main.js`：首页书签渲染、站内搜索、时钟和天气逻辑。
- `script.js`：公共主题切换、内部链接主题传递和文章页导航辅助逻辑。
- `drafts/`：Markdown 文章源文件。
- `scripts/build.py`：将 Markdown 生成文章 HTML，并刷新文章索引。
- `config/posts.json`：自动生成的文章索引，博客首页会动态读取。
- `blog/`：博客首页；文章列表和分类由 `config/posts.json` 动态渲染。
- `posts/`：静态文章详情页。
- `music/`：音乐页。
- `tools/plate-layout/`：孔板铺板设计器（原生 HTML/CSS/JS，无第三方运行依赖）。
- `CNAME`：GitHub Pages 自定义域名配置。
- `.github/workflows/deploy.yml`：GitHub Pages 部署流程。

## 发布文章

每篇文章在 `drafts/` 里新建一个 Markdown 文件，顶部写 Front Matter：

```markdown
---
title: Oracle Cloud 免费 ARM 服务器申请
date: 2026-06-05
category: Cloud
description: Oracle Cloud 免费 ARM 实例申请流程
slug: oracle-cloud
---

正文内容...
```

生成文章：

```bash
python3 scripts/build.py
```

脚本会生成 `posts/{slug}.html`，并按日期倒序刷新 `config/posts.json`。博客首页会从 `config/posts.json` 动态渲染最新文章和分类。

可选：安装 Python-Markdown 和 Pygments 以获得更完整的 Markdown 支持和代码高亮。当前环境建议使用项目本地虚拟环境：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

之后可以用虚拟环境运行构建：

```bash
.venv/bin/python scripts/build.py
```

## 本地查看

首页会通过 `fetch` 读取 `config/links.json`，建议从仓库根目录启动一个静态文件服务器预览：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/`。

## 孔板铺板设计器

本地访问 `http://localhost:8000/tools/plate-layout/`。支持 6、12、24、96 孔板、点击和拖动多选、行列选择、标签与颜色管理、撤销/重做，以及 PNG/JPG 的 1×、2×、3× 图片导出。长图例会自动调整实际导出分辨率以控制内存，内容不会截断。

先选孔，再创建标签或点击标签库中的名称。标签色块可修改颜色，删除和重置操作会确认且可撤销。浏览器会自动保存当前方案，最多支持撤销最近 100 次操作；刷新后恢复方案，但不保留撤销历史。方案只保存在当前浏览器的 localStorage 中，不同设备、浏览器或网址不共享数据；清理浏览器数据会清除方案。建议完成设计后及时导出图片。

工具无需安装依赖或构建。现有 GitHub Pages 流程会发布整个仓库，提交并推送到 `main` 后可通过 `https://blackblues.xyz/tools/plate-layout/` 访问。无需修改 CNAME 或新增路由配置。

核心逻辑测试与语法检查（Node.js 18+）：

```bash
node --test tools/plate-layout/tests/core.test.mjs
node --check tools/plate-layout/core.mjs
node --check tools/plate-layout/app.mjs
```

浏览器验收脚本位于 `tools/plate-layout/tests/browser.cjs`，需要本地可用的 Playwright、Chromium/Edge，以及上述 8000 端口的静态服务器。通过 `PLATE_BROWSER_PATH` 可指定浏览器路径，通过 `PLATE_TEST_OUTPUT` 指定截图和下载结果目录。此依赖仅用于开发验证，网站运行不加载它。
