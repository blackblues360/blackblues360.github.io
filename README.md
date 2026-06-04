# BLACK BLUES

BLACK BLUES 是一个部署在 GitHub Pages 上的纯静态个人主页。

## 结构

- `index.html`：首页结构，包含网页搜索入口和书签容器。
- `config/links.json`：首页书签分类和链接数据。
- `assets/css/theme.css`：当前站点主样式。
- `assets/js/main.js`：首页书签渲染、站内搜索、时钟和天气逻辑。
- `script.js`：公共主题切换、内部链接主题传递和文章页导航辅助逻辑。
- `blog/`：博客首页和分类文章列表页。
- `posts/`：静态文章详情页。
- `music/`：音乐页。
- `CNAME`：GitHub Pages 自定义域名配置。
- `.github/workflows/deploy.yml`：GitHub Pages 部署流程。

## 本地查看

首页会通过 `fetch` 读取 `config/links.json`，建议从仓库根目录启动一个静态文件服务器预览：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/`。
