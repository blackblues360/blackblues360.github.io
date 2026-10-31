# 仓库审查报告

审查日2026-10-29；本地仓库 origin=https://github.com/blackblues360/blackblues360.github.io.git；main，HEAD `2cb9ab5`（Preserve paragraph line breaks in SOP editing and exports）。开始时 `git status --short` 无输出。相对本机已有的origin/main引用领先3个提交；未fetch，不能据此确认实时远程差异，也不假定本地与公开版本一致。行号以此本地基线为准。只读核查相关文件，不读取浏览器真实用户数据。

## 站点与复用边界

- `index.html:58-61` 入口指向 `/tools/plate-layout/`、`/tools/sop-timeline/`、博客和音乐。工具各为独立静态 HTML，ES module app→core；SOP另有export模块。无构建依赖。
- `.github/workflows/deploy.yml:3-6,29-32` 在main push后打包整个仓库到Pages，无数据库执行步骤。`CNAME`负责域名；本任务不改部署。本目录不是自动迁移目录，但未来提交时可能公开随站点分发，不能放密钥、个人数据或环境文件。
- `script.js:1-55` 公共主题（localStorage `theme`）、同源链接主题参数与导航辅助。首页 `index.html:71` 有 `webSearchEngine`；`assets/js/main.js:22,127-144` 有天气缓存键 `blackblues.weather.current.tianjin` 和容错JSON读写。天气属于外部公共请求，不是用户云同步。配置链接/博客索引仍为公开静态JSON。
- 检查入口HTML、script.js、assets/js/main.js、两工具app/core/export、README、workflow及tools目录清单，未发现统一认证/业务云存储/Supabase迁移或数据库权限测试。未全量审计音乐播放器和历史文章，不能据此断言全仓没有任何外部通信。
- 无package.json，已有测试是Node内置node:test与独立浏览器脚本；不是数据库框架。可复用纯core校验、现有toast/状态提示和本地保存错误处理，但没有可直接复用的统一会话/同步层。

## 孔板实际格式

`tools/plate-layout/core.mjs:1-5,32-74`：

```text
{version:1,
 plate:{type:"6"|"12"|"24"|"96", title:string},
 wells:{A1:null|"label-1", ...所有当前板型孔位},
 labels:[{id:"label-<正安全整数>",name:string,color:"#rrggbb"}],
 ui:{selected:[孔位],activeLabelId:null|string,showIds:boolean,
     showAxes:boolean,showFrame:boolean,exportLegend:boolean,wellScale:number}}
```

6孔2×3、12孔3×4、24孔4×6、96孔8×12，孔位A1起。wells存标签ID，名称/颜色只存labels，图例通过usedLabels推导。cleanText清控制字符、空白、非法代理字符、NFC规范化，截160个UTF-16单元。标签最多96，名称不区分大小写唯一、颜色唯一。

`app.mjs:7,21-30,48-69`：localStorage单键 `blackblues.plate-layout.v1`，JSON.stringify整个state。启动restoreState，编辑后remember→persist；撤销重做也保存（381-390），历史最多100条只在内存。选中状态也在保存对象内，没有独立文档ID、创建时间或云端版本。

restoreState严格要求version===1及合法板型，从默认状态重建：最多扫描前96个标签，跳过无效/重复标签、清无效孔位引用；合法选区去重并按孔位顺序整理，缩放裁剪75–110，可选布尔项缺失时用默认值。旧稿缺exportLegend默认为true（tests/core.test.mjs:158-169）。未发现其他版本解析器；不能假造v0→v1迁移。该恢复过程会丢弃未知字段和无效数据，不是无损验证。

`app.mjs:399-402`重置保留板型、其余归默认，可撤销。`404-458`仅PNG/JPG图像导出；没有JSON原始文件导入/导出，图片不能恢复标签模型。损坏记录启动时未删除，但后续编辑可覆盖同键（21-30、48-50、460-466）。`index.html:57-64`还写明本地保存/不上传，未来接入时必须同步调整说明，但本次不改。

## SOP实际格式

`tools/sop-timeline/core.mjs:2-6,21-66`：

```text
{version:1,name:string,author:string,date:string,revision:string,
 groups:[{id:string,title:string,collapsed:boolean}],
 blocks:[{id:string,group:组ID,lane:"operation"|"wait",
          start:整数秒,duration:整数秒,text:富文本字符串,
          object:string,environment:string}],
 notes:[{id:string,group:组ID,text:string}],
 environmentTerms:[string],
 environmentRanges:[{id:string,group:组ID,start:整数秒,end:整数秒,
                     environment:string,startAnchor?:{blockId,edge:"start"|"end"},
                     endAnchor?:{blockId,edge:"start"|"end"}}],
 layout:{operationWidth,waitWidth,laneGap,environmentWidth,fontSize,spacing,
         theme:"blue"|"sage"|"lavender",orientation:"portrait"|"landscape"}}
```

默认布局为116/116/0/100/15/14、blue、portrait。默认文案版本revision='v1.0'，日期为本机sv-SE日期字符串，不是数据库时间戳。新实体uid使用crypto.randomUUID，但文档根无id；导入实体ID允许`^[\w-]{1,100}$`，各实体种类分别查重，不能把所有实体ID当全局唯一。整份JSONB保存无需改写实体ID，也无需拆时间块关系表；不要为了云端上传重编号旧范围ID。

validate限制：组≤200、块/备注各≤1000、环境词≤100且每词≤80、环境范围≤2000；块时长1–604800秒，结束≤6048000；文字/object/environment≤20000。检查组引用、同泳道不能重叠、时间轴连续、组不能交叉；范围须吸附组内节点、同组不重叠、锚点有效。它并不检查所有顶层元数据和布局，importDocument再检查元数据均字符串且长度<1000、规范布局。不能以validate单独代替完整导入校验。

`app.mjs:3-6,14-20,110-119,206-216`：草稿键 `blackblues.sop-timeline.v1`，默认布局另存 `.defaults`；起始为sampleDocument，有有效草稿才覆盖。操作/编辑/撤销重做以及beforeunload会保存，最多100步历史仅内存；没有云端同步。新建空白继承环境词与本机默认布局。

**现有恢复风险**：读取坏稿后catch显示“已保留原存储”，但内存仍是示例；beforeunload无条件persist，故关闭或后续编辑可能覆盖坏稿（app:4-6、14、216）。本次只记录，不修复、不打开真实草稿页面。下一阶段必须先隔离备份/阻止失败恢复态自动覆盖，再接云端。

`app.mjs:209-215`：.soptime为完整JSON.stringify(doc,null,2)，无额外封套；原生文件选择器或download保存。导入限制文件≤5,000,000字节，core:151另限text.length≤5,000,000；parse→validate→元数据校验→布局裁剪→环境兼容→再次validate。打开导入成功后fileHandle=null，不保留源文件写入句柄。PNG为图片，PDF经export.mjs:61-78新窗口分页后浏览器打印，均不能作为可编辑原件恢复。

已证实的同一v1变体：缺environmentTerms会补默认；缺environmentRanges时通过legacyEnvironmentRanges从旧block.environment与primaryObject推导，生成environment-组序号-范围序号ID，修剪重叠；显式[]表示用户已清空，不能再回填（core:151-165、179-190）。缺布局字段用默认，数值裁剪到范围。未知version在最初校验就拒绝；未来迁移注释不是已经实现的跨版本支持。text保留段落/换行，safeHTML（app:8-11）是渲染安全边界，云端输入也要经过它。

## 下一阶段具体修改位置（本次均未改）

| 现有文件 | 计划接入位置 |
| --- | --- |
| tools/plate-layout/app.mjs | STORAGE_KEY/启动恢复/persist/remember/travelHistory，增加用户隔离信封、显式上传与冲突流程，保留游客行为 |
| tools/plate-layout/core.mjs | 保留restoreState，增加只读验证/清洗差异预览或原始方案备份适配，不改变既有字段含义 |
| tools/plate-layout/index.html、plate-layout.css | 登录/云端文档列表与状态、用户授权导入、修订不上传文案；按实际UI需求改样式 |
| tools/sop-timeline/app.mjs | 草稿失败恢复保护、persist/commit/remember、编辑结束/新建/open/save、切账户与句柄清理 |
| tools/sop-timeline/core.mjs | 复用importDocument，明确未来版本分派及规范化差异；保留现有v1导出 |
| tools/sop-timeline/index.html、style.css、README.md | 会话与保存状态、原件导入确认、更新本地存储说明 |
| index.html、script.js及assets/js下新增公共模块 | 最小公共认证入口；新增auth-client/config、文档同步适配模块；只发布项目URL与publishable/anon key，绝不放服务密钥 |
| 两工具tests/ | 补适配器、恢复、网络/账户切换/冲突测试，沿用node:test及浏览器框架 |

纪念日没有在已检查入口与tools清单中发现现有实现，属于后续新页面/模块，不能凭空给出现有文件定位。部署workflow/CNAME无需为数据库接入修改。已有export.mjs原则上不需要接云，若新增云端文档备份导出才单独评估。
