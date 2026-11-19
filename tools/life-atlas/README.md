# Life Atlas

科研实体生命周期与谱系管理工具。开发预览已发布于 https://blackblues.xyz/tools/life-atlas/ 。当前版本包含项目分组、标签、多盒与位置历史。需求与 UI 原件保存在 `docs/development/life-atlas/`，完整 V0.2 基线及实现边界见该目录下的 `implementation.md`。

本轮版本新增小鼠基础档案与实际年龄、细胞系与培养批次关联、培养条件继承、档案修订前后快照和分型结果历史。项目页支持分组体重 / 肿瘤测量对比、原始测量 CSV 与原始事件追溯；测量归属使用发生时的成员有效期。右侧详情和表单可点击左侧空白处关闭。细胞页将正在计时的培养实体排成卡片，点击切换对应时间轴；保留旧版已计时细胞系的实际生命周期。当前验证为 55 项业务测试、24 组浏览器流程通过。

从仓库根目录运行 `python scripts/serve.py --port 8765`，浏览器打开 `/tools/life-atlas/`。沿用网站登录服务；需已配置且有效的网站账户。无需额外安装或构建。

入口已经加入首页工具列表及账户中心导航。演示空间与个人数据库分离；正式数据按账户 ID 保存在本机 IndexedDB。云备份尚未实现，请导出 JSON。

验证：

```powershell
node --test tools/life-atlas/tests/core.test.mjs tools/life-atlas/tests/workflows.test.mjs tools/life-atlas/tests/studies.test.mjs tools/life-atlas/tests/storage.test.mjs tools/life-atlas/tests/profiles.test.mjs tools/life-atlas/tests/measurements.test.mjs
node tools/life-atlas/tests/browser.cjs
```

浏览器测试需要本机 Edge、Playwright、预览服务；`LIFE_ATLAS_TEST_URL` 可指定服务地址。测试替换认证模块为合成账户，不使用真实身份或云数据。
