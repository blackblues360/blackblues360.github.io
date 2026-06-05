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
