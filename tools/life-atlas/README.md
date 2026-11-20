# Life Atlas

科研实体生命周期与谱系管理工具。开发预览已发布于 https://blackblues.xyz/tools/life-atlas/ 。当前版本包含项目分组、标签、多盒与位置历史。需求与 UI 原件保存在 `docs/development/life-atlas/`，完整 V0.2 基线及实现边界见该目录下的 `implementation.md`。

已支持小鼠基础档案与实际年龄、细胞系与培养批次关联、培养条件继承、档案修订前后快照和分型结果历史。项目页支持分组体重 / 肿瘤测量对比、原始测量 CSV 与原始事件追溯；测量归属使用发生时的成员有效期。右侧详情和表单可点击左侧空白处关闭。三类实体页面均使用卡片切换时间轴；保留旧版已计时细胞系的实际生命周期。本轮新增冻存盒 / 样品盒 CSV 清单与布局 PDF 报告；94 项业务测试、41 组浏览器流程通过。

从仓库根目录运行 `python scripts/serve.py --port 8765`，浏览器打开 `/tools/life-atlas/`。沿用网站登录服务；需已配置且有效的网站账户。无需额外安装或构建。

细胞、样品、小鼠页均以 170×40px 紧凑卡片切换时间轴，不显示实体下拉框；新建、记录及小鼠批量操作与卡片同行，窄屏时排在卡片下方。细胞显示正在计时的培养实体，样品显示未结束的可用样品（包含保存单位），小鼠显示在管个体；历史与未计时档案仍可从“全部档案”列表点击进入。

“位置与存储”支持直接登记已有冻存管，无需先补录培养历史。空库点击存入或空格位会打开库存登记，也可使用“登记已有冻存管”按钮。每支管独立占位，支持原管号、细胞系、冻存日期、P 数、数量单位、冻存液与来源；P 数 / 日期未知可留空。登记与实际冻存分开记录，复苏后才开启培养 D0，未知 P 数在衍生流程中保留未知。

“批量导入库存”支持 CSV / TSV 上传或从 Excel 粘贴清单，提供空白 CSV 模板、自动 / 手动字段对应、目标盒与可选所属细胞系、问题行预览、返回修改及确认后整体追加。表格每行一支管，可对应格位或分开的行 / 列，也可通过盒路径列导入多个已建档细胞盒。重复管号、文件内重复格位、现有占用及非法字段会阻止保存；可显式跳过已填信息一致的已有记录，其他冲突不覆盖。导入保留批次、文件名与源行号，可幂等重试，JSON 恢复校验批次完整性。每次最多 500 支、文件不超过 2 MB。直接 .xlsx / .xls 文件及按盒排布的二维网格导入尚未实现；Excel 请复制含表头的清单或另存为 CSV。文件编码支持 UTF-8、GB18030 / GBK 和 UTF-16。

“基本信息”或实体详情中的“导出报告 / PDF”可选择当前实体、全部上游、全部下游或两者，设置是否包含备注及计划。先预览，再点击“打印 / 保存为 PDF”，在浏览器打印窗口选择“另存为 PDF”。报告包含生成时间（北京时间）、研究空间、数据修订、当前档案、全部生命周期、原始事件与追加修正、存储历史、范围内的谱系关系及小鼠测量明细。计划单列，不混为实际事件；共享输入材料可在事件中追溯，不自动扩展为谱系档案。生成报告不改动本地数据。当前支持实体报告和存储清单报告，项目汇总和 PNG 导出仍待开发。

“位置与存储 → 导出清单 / PDF”支持当前盒或全部盒，导出 CSV 或先预览再打印保存 PDF；清单可选空位和档案备注。PDF 布局始终包含全部格位，最大 26×26 样品盒拆为不超过 9×9 的分区，多盒各自起页。记录只包含当前实际占用，不混入已取出 / 复苏 / 结束的单位；实际冻存日期与当前位置存入时间分开，未知日期及 P 数不推算。CSV 保留单位、北京时间时区、所属细胞系、冻存液、来源，以及库存导入文件与原表行号，并防止表格公式注入。导出不修改原数据或补建旧历史。大批量 / 大数据性能尚未验收。

入口已经加入首页工具列表及账户中心导航。演示空间与个人数据库分离；正式数据按账户 ID 保存在本机 IndexedDB。云备份尚未实现，请导出 JSON。

验证：

```powershell
node --test tools/life-atlas/tests/core.test.mjs tools/life-atlas/tests/workflows.test.mjs tools/life-atlas/tests/studies.test.mjs tools/life-atlas/tests/storage.test.mjs tools/life-atlas/tests/profiles.test.mjs tools/life-atlas/tests/measurements.test.mjs tools/life-atlas/tests/inventory.test.mjs tools/life-atlas/tests/inventory-import.test.mjs tools/life-atlas/tests/reports.test.mjs tools/life-atlas/tests/storage-export.test.mjs
node tools/life-atlas/tests/browser.cjs
```

浏览器测试需要本机 Edge、Playwright、预览服务；`LIFE_ATLAS_TEST_URL` 可指定服务地址。测试替换认证模块为合成账户，不使用真实身份或云数据。
