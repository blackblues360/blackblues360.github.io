# Life Atlas

科研实体生命周期与谱系管理工具。开发预览已发布于 https://blackblues.xyz/tools/life-atlas/ 。当前版本包含项目分组、标签、多盒与位置历史。需求与 UI 原件保存在 `docs/development/life-atlas/`，完整 V0.2 基线及实现边界见该目录下的 `implementation.md`。

本轮版本新增小鼠基础档案与实际年龄、细胞系与培养批次关联、培养条件继承、档案修订前后快照和分型结果历史。项目页支持分组体重 / 肿瘤测量对比、原始测量 CSV 与原始事件追溯；测量归属使用发生时的成员有效期。右侧详情和表单可点击左侧空白处关闭。三类实体页面均使用卡片切换时间轴；保留旧版已计时细胞系的实际生命周期。本轮 73 项业务测试、34 组浏览器流程通过。

从仓库根目录运行 `python scripts/serve.py --port 8765`，浏览器打开 `/tools/life-atlas/`。沿用网站登录服务；需已配置且有效的网站账户。无需额外安装或构建。

细胞、样品、小鼠页均以 170×40px 紧凑卡片切换时间轴，不显示实体下拉框；新建、记录及小鼠批量操作与卡片同行，窄屏时排在卡片下方。细胞显示正在计时的培养实体，样品显示未结束的可用样品（包含保存单位），小鼠显示在管个体；历史与未计时档案仍可从“全部档案”列表点击进入。

“位置与存储”支持直接登记已有冻存管，无需先补录培养历史。空库点击存入或空格位会打开库存登记，也可使用“登记已有冻存管”按钮。每支管独立占位，支持原管号、细胞系、冻存日期、P 数、数量单位、冻存液与来源；P 数 / 日期未知可留空。登记与实际冻存分开记录，复苏后才开启培养 D0，未知 P 数在衍生流程中保留未知。

“批量导入库存”支持 CSV / TSV 上传或从 Excel 粘贴清单，提供空白 CSV 模板、自动 / 手动字段对应、目标盒与可选所属细胞系、问题行预览、返回修改及确认后整体追加。表格每行一支管，可对应格位或分开的行 / 列，也可通过盒路径列导入多个已建档细胞盒。重复管号、文件内重复格位、现有占用及非法字段会阻止保存；可显式跳过已填信息一致的已有记录，其他冲突不覆盖。导入保留批次、文件名与源行号，可幂等重试，JSON 恢复校验批次完整性。每次最多 500 支、文件不超过 2 MB。直接 .xlsx / .xls 文件及按盒排布的二维网格导入尚未实现；Excel 请复制含表头的清单或另存为 CSV。文件编码支持 UTF-8、GB18030 / GBK 和 UTF-16。

入口已经加入首页工具列表及账户中心导航。演示空间与个人数据库分离；正式数据按账户 ID 保存在本机 IndexedDB。云备份尚未实现，请导出 JSON。

验证：

```powershell
node --test tools/life-atlas/tests/core.test.mjs tools/life-atlas/tests/workflows.test.mjs tools/life-atlas/tests/studies.test.mjs tools/life-atlas/tests/storage.test.mjs tools/life-atlas/tests/profiles.test.mjs tools/life-atlas/tests/measurements.test.mjs tools/life-atlas/tests/inventory.test.mjs tools/life-atlas/tests/inventory-import.test.mjs
node tools/life-atlas/tests/browser.cjs
```

浏览器测试需要本机 Edge、Playwright、预览服务；`LIFE_ATLAS_TEST_URL` 可指定服务地址。测试替换认证模块为合成账户，不使用真实身份或云数据。
