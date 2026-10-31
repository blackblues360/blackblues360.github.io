# 最终审查与交付

2026-10-29；状态：设计完成，实施未开始。现有前端、配置与部署文件均未修改；未访问浏览器本地数据，未连接Supabase、执行SQL、创建账户、提交、推送或发布。

## 核心回答

1. **真实结构**：孔板为v1 JSON state，包含plate、孔位到label ID的wells、labels和ui，保存在单个localStorage键，目前仅导出PNG/JPG。SOP为v1 JSON文档，含实验元数据、groups、blocks、notes、环境词/范围与layout；.soptime是其JSON文本，本地另有草稿和默认布局键。完整字段/证据见[仓库审查](repository-audit.md)。
2. **通用表适配**：tool_documents JSONB能完整保存两种规范化原生对象，无需把时间块拆表；两者需分别校验，不能共享一种内容schema。数据库整数revision独立于SOP实验版本字符串；云UUID独立于工具内部实体ID。JSONB不保证原文件字节一致，原件应保留。
3. **表字段**：建议profiles（id/display_name/时间戳）、anniversaries（id/user_id/title/event_date/repeat_annually/notes/时间戳）、tool_documents（id/user_id/app_id/title/content/schema_version/revision/deleted_at/时间戳）。不纳入user_preferences。类型、默认值、索引、外键和限制见[数据库设计](database-design.md)及sql/001、003。
4. **账户隔离**：三表启用RLS，profiles以auth.uid()=id，另两表以auth.uid()=user_id，SELECT/INSERT/UPDATE/DELETE分别设策略，更新包含新旧所有者校验。匿名无GRANT；限制客户端可写列。工具表不给直接UPDATE/DELETE，RPC内再强制所有者和版本条件；definer权限需后续在本地实际核验。
5. **冲突与迁移**：SQL原子WHERE id+user_id+expected_revision更新并递增版本，0行进入冲突/不可见流程，不自动重试覆盖。保留dirty本地副本并隔离账户。首次登录只提示显式导入，先备份再校验与预览；云端空列表不清本地。已识别的同v1兼容按原代码处理，未知版本拒绝；详见[兼容与迁移计划](migration-plan.md)。
6. **SQL就绪程度**：已有001→002→003完整未执行草案，但尚不具备生产执行准入。必须先确认产品决策，并在隔离本地Supabase验证语法、角色/函数权限、Auth兼容、权限测试和双连接并发；不声称数据库测试通过。
7. **安全覆盖与缺口**：[权限脚本](tests/permissions.test.sql)覆盖匿名读、A/B隔离、伪造/转移所有权、CRUD、profile、非法app/格式/日期、revision注入、过期保存/删除、账户级联；[测试说明](tests/README.md)补双连接竞争、HTTP JWT、断网/切账户、大小边界与旧稿矩阵。以上数据库与浏览器用例均未执行；SQL内容检查只是顶层类型/数量，不含完整工具语义，总配额与限流未设计。
8. **待确认**：闰日非闰年按2月28日还是3月1日；日期按本机还是固定时区；独立云端列表名；软删除无回收站界面及已删内容保留政策；单文档5MB/总配额；语义校验边界；偏好是否跨设备；Auth提供商、注册范围与域名回调。建议先采用当前草案最小范围，再单独确认扩展。
9. **下一阶段文件**：两工具app.mjs持久化/恢复/保存入口、core.mjs验证适配、各index.html与样式/说明，公共script.js/index.html和新增assets/js认证/同步模块、相应tests。逐项符号与行号见repository-audit最后一节；不需要改GitHub Pages部署。本次这些文件均未修改。

## 需优先处理的现有风险

SOP读取坏草稿失败后，beforeunload仍会把示例覆盖写回原草稿键（app.mjs:4-6、14、216）。按任务边界只记录，未修复。未来接入云同步前应先保护原始文本，不能把示例当作恢复成功或上传内容。孔板restoreState也可能规范化丢弃数据，迁移必须预览差异。

## 实际验证

- 运行 `node --test tools/plate-layout/tests/core.test.mjs tools/sop-timeline/tests/core.test.mjs tools/sop-timeline/tests/environment.test.mjs`：52项通过、0失败。
- 使用内存合成数据核验孔板state与空白/示例SOP的JSON往返，以及缺环境字段的SOP旧稿规范化：通过；未访问localStorage或数据库。
- 查看新增SQL diff，修正权限测试中数据修改CTE必须位于顶层的问题；检查新增文件diff空白，无错误。Git核验既有已跟踪文件无修改，仅本规划目录新增文件。
- 未检测到系统psql/supabase命令；未探测数据库。未进行PostgreSQL解析器校验、SQL执行、pgTAP、真正双连接并发或浏览器端到端测试。

## 交付清单

- 本报告、repository-audit.md、database-design.md、migration-plan.md。
- sql/001_initial_schema.sql、002_rls_policies.sql、003_indexes_and_constraints.sql。
- tests/permissions.test.sql、tests/README.md。

安全/并发原则已对照[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[函数权限](https://supabase.com/docs/guides/database/functions)、[PostgreSQL事务隔离](https://www.postgresql.org/docs/current/transaction-iso.html)。代码与SQL的运行结论只以上述实际验证为准。下一步等待用户确认，不继续实施。
