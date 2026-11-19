# Life Atlas

科研实体生命周期与谱系管理工具，当前为本地开发预览。需求与 UI 原件保存在 `docs/development/life-atlas/`，完整 V0.2 基线及实现边界见该目录下的 `implementation.md`。

从仓库根目录运行 `python scripts/serve.py --port 8765`，浏览器打开 `/tools/life-atlas/`。沿用网站登录服务；需已配置且有效的网站账户。无需额外安装或构建。

入口已经加入首页工具列表及账户中心导航。演示空间与个人数据库分离；正式数据按账户 ID 保存在本机 IndexedDB。云备份尚未实现，请导出 JSON。

验证：

```powershell
node --test tools/life-atlas/tests/core.test.mjs tools/life-atlas/tests/workflows.test.mjs
node tools/life-atlas/tests/browser.cjs
```

浏览器测试需要本机 Edge、Playwright、预览服务；`LIFE_ATLAS_TEST_URL` 可指定服务地址。测试替换认证模块为合成账户，不使用真实身份或云数据。
