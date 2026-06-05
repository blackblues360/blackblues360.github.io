---
title: 用 Cloudflare + GitHub 搭建个人主页的全过程
date: 2026-04-30
category: 技术
description: 从购买域名到绑定 Cloudflare，再到连接 GitHub Pages，记录一下这个网站是怎么诞生的。
slug: cloudflare-github-pages
---

这个站点的技术栈非常简单：一个 GitHub Pages 仓库，一个自定义域名，以及 Cloudflare 负责 DNS。简单的好处是透明，出了问题也容易定位。

仓库根目录里的 CNAME 指向当前域名，GitHub Pages 会根据这个文件识别站点绑定。Cloudflare 里只需要把 DNS 记录指向 GitHub Pages，再等待解析生效。

真正花时间的不是配置，而是决定这个网站应该长什么样。最后我选择了一个纯静态页面，因为现阶段最重要的是先把内容放上来，而不是先把系统做复杂。
