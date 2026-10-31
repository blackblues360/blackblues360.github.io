# 统一账户与数据库 V1 设计（未实施）

初稿日期：2026-10-29，当时仅为审查与未执行草案。2026-10-30阶段A已进行本地验证，当前结果与环境限制见 [stage-a-report.md](stage-a-report.md)；没有创建云端项目。代码基线及格式证据见 [repository-audit.md](repository-audit.md)，执行前置条件见 [migration-plan.md](migration-plan.md)。

## 结论与表结构

保留 GitHub Pages 与游客模式。Supabase Auth 管理密码、邮箱验证、会话，业务表不保存这些信息。所有工具使用同一 Supabase 项目、同源会话；生产规范域名统一为 HTTPS blackblues.xyz。github.io、www、localhost 的 localStorage 不共享，需要独立导入，不能承诺跨域自动登录。

| 表 | 字段与约束 | 生命周期 |
| --- | --- | --- |
| profiles | id uuid PK/FK auth.users(id) ON DELETE CASCADE；display_name text 默认空、最多80字符；created_at/updated_at timestamptz 服务端生成 | 登录后以用户 JWT INSERT 自己的 id，冲突时读取已有资料；只更新昵称。允许删除资料，下一次用户主动初始化可重建 |
| anniversaries | id uuid PK 默认随机；user_id uuid NOT NULL 默认 auth.uid()、FK auth.users CASCADE；title 非空白且≤200字符；event_date date NOT NULL、限定0001至9999年；repeat_annually boolean 默认false；notes text默认空≤20000字符；时间戳 | V1 在线 CRUD，更新采用最后提交覆盖；若要求纪念日也检测冲突，须下一阶段另加 revision，不假装已有保护 |
| tool_documents | id uuid PK 默认随机；user_id 同上；app_id text仅 plate-layout / sop-timeline；title 非空白≤1000字符；content jsonb NOT NULL；schema_version integer 当前仅1；revision bigint 默认1且正数；deleted_at timestamptz可空；时间戳 | 普通用户仅可直接新建、读取；更新和软删除必须调用有版本条件的 RPC |

不建 user_preferences：已发现主题、搜索引擎、SOP 新文档布局默认值，但没有必须跨设备同步的需求。文档自己的布局、环境词条保留在 content，网站偏好暂留本地。未来明确需求再扩展。标题长度按完整数据库字符串计数，非空白按PostgreSQL当前locale的POSIX space字符类判断，包含普通空格/制表符/换行；不承诺覆盖所有Unicode不可见字符，前端还应规范化并提示。

所有业务所有权直接关联 auth.users，而不是 profiles；资料初始化失败不阻止文档保存。V1 不在 auth.users 上安装注册触发器，避免触发器异常回滚注册。资料创建可重试，不能用 upsert 顺便覆盖旧昵称。业务 updated_at 触发器为 invoker、空 search_path、无外部 I/O，异常仍会回滚对应业务写入；不得忽略异常。

## 文档映射与验证边界

content 保存工具原生对象，schema_version 对应 content.version；数据库 revision 与 SOP content.revision 完全独立。JSONB 保留对象/数组/字符串、数组顺序和孔位映射，适合这两种结构；不保证原文件的空白、键顺序、重复键或字节一致性。因此原始文件应由用户保留，不能把数据库导出称为原文件逐字节备份。图片不入 JSONB。

plate-layout：content=完整 v1 state（plate、wells、labels、ui）。title 为独立云端列表名，允许与图内 plate.title 不同，避免默认空标题的冲突。SOP：content=完整 .soptime 对象，title 是独立列表名，content.name 仍是打印实验名。每次保存列表名、content、schema_version 在一条 SQL 中原子更新。

SQL 的 document_shape_valid 只验证对象、版本、必要顶层字段类型与容器数量；不是现有 JavaScript 校验器的完整移植。它拒绝空对象、未知工具、错误版本/顶层类型；不能拒绝所有悬空标签、重叠时间块、恶意富文本。跨用户隔离由数据库强制；同一用户能上传语义损坏的内容是明确限制。后续前端每次读、写、导入都必须分别调用 restoreState / importDocument，SOP 富文本仍经过 safeHTML。若要求数据库保证完整工具语义，应在实施前扩充服务器校验，不可依赖本草案的粗校验作此承诺。

单份 content 限定 JSONB 文本 UTF-8 长度≤5,000,000字节，避免 TOAST 压缩导致限制失效。这是应用建议值，不是 Supabase 套餐配额；JSONB 文本空格可能使临界文件超限。SOP 原生导入另有字符串长度与文件字节上限，需同时满足。超限保留本地并提示，禁止截断；没有总用户配额或防恶意批量写入机制，公开注册前须确定配额/速率限制与当前套餐预算。列表只取元数据，正文按 id 加载；不建 JSONB GIN 索引。

## RLS、GRANT 与 RPC

三表在创建事务内启用 RLS，撤销 PUBLIC/anon/authenticated 默认表权限，随后最小授权。每表四个策略单独声明：SELECT/DELETE USING auth.uid()=所有者；INSERT WITH CHECK 同上；UPDATE 同时 USING 和 WITH CHECK。profiles 所有者列是 id，另两表是 user_id。工具SELECT/UPDATE额外排除deleted_at非空记录。匿名角色没有表权限或写 RPC 权限。UPDATE 列授权也排除主键、所有者、创建时间；工具表不向客户端授予直接 UPDATE/DELETE，禁止绕开版本条件。工具表的 UPDATE/DELETE 策略是防御性声明，实际客户端入口只有 RPC。

工具 RPC 为 SECURITY DEFINER（受信数据库迁移所有者持有）、search_path=''、表名完全限定，必须内部取 auth.uid()，拒绝空身份，并在同一 UPDATE 中加 user_id=auth.uid()、id、expected_revision、deleted_at IS NULL条件。不接收调用者指定的所有者或新 revision；不动态执行 SQL。默认 PUBLIC/anon EXECUTE 撤销，只给 authenticated。函数所有者可能绕过 RLS，所以内部所有权条件是关键安全边界，必须复核，不把 RLS 当作 definer 的自动保护。helper 不对外开放执行；纯 JSON 校验函数因 CHECK 执行需求授予 authenticated。

新建时客户端先生成 UUID 并写入本地同步信封，再 INSERT；超时后按同一 id 读回核对，不能换 id 重试造成重复。INSERT 只开放必要列，不能指定 revision 和时间戳。UUID 不能替代 RLS。失败/冲突的 SQL 返回0行不代表成功。

## 同步与冲突

建议未来本地信封：{userId, appId, documentId, baseRevision, baseContent, pendingContent, pendingTitle, dirty, lastSavedAt}。这是新设计，现有存储没有这些字段。保留原游客键，新增按用户 UUID/工具/文档隔离的缓存；不能仅在现有全局键旁加一个登录标记。未登录写游客键，已登录的未同步内容只写所属账户缓存。

在线保存调用 save_tool_document(id, expected_revision, title, content, schema_version)，数据库只在版本相等时写入并将 revision+1。默认READ COMMITTED下两个设备读到1时仅一个能写成2，另一个0行；PostgreSQL等待并发UPDATE后会重新评估WHERE条件。若目标使用更高隔离级别，可能返回40001序列化失败，保留本地并重新读取/进入冲突流程；不能以失败为由换最新revision自动覆盖。不能先查再无条件更新，不能冲突后自动用最新 revision 重试。UI 提供重载（先备份本地）、另存副本或人工合并，没有自动合并。

请求发出后编辑继续：请求固定快照，返回成功仅确认该快照；若当前内容不同仍为 dirty，并基于新版本排下一次保存。超时/断网保留 dirty、base 与请求快照；读回若与发出的快照相同则确认，否则进入冲突。退出/切账户取消队列、清内存和撤销历史、清文件句柄，增加会话代号以丢弃晚到回调。保留未同步数据在原账户隔离缓存并提示，B 不能显示/提交 A 的内容；浏览器共享设备本地保密不由 RLS 保证，需用户明确选择保留或导出清除。

云端列表为空绝不清空本地。读取0行可能是已删除、不属于当前账户或不可见，统一显示无法找到，保留本地。V1经 delete_tool_document(id,expected_revision)原子设置deleted_at并递增revision，版本不符0行；先确认并提供本地备份。保留已删记录及主键，迟到的新建INSERT同ID会因唯一约束失败，旧save也因deleted_at条件失败，从数据库层阻止复活。V1没有回收站界面或自动恢复；恢复是用户明确另存为新UUID。暂不做后台物理清理，否则会重新打开旧ID重建窗口；保留内容计入存储，需要后续确定清理/墓碑保留政策。删除后丢失响应时查不到不能推断服务端原因，只提示已不可见。账户删除通过受信服务端/Auth管理流程（下一阶段另设计），FK级联三表（含软删记录）；不能在浏览器放服务密钥，删除账户前处理未同步数据。

## 纪念日日期语义

event_date 是公历纯日期，不转 UTC 午夜，不存倒计时。计算时以用户设备当前当地日历日期比较，跨时区可能不同一天，UI 明示采用本机日期；未来若要固定时区再添加设置。年度重复取当年/月日且当天显示0，过日取下一年；建议2月29日在非闰年按2月28日，到闰年仍按2月29日，待用户确认。按日历日期差计算，不能用本地时间戳差除86400000（夏令时）。非重复过去日期显示已过去天数，不偷偷改年份。

## 待确认与来源

待确认：独立云端列表名；纪念日闰日/时区规则；V1软删除无回收站界面及已删内容保留政策；5MB单文档与总配额；语义校验边界；是否同步偏好；资料允许删除的产品行为。实施前需确定 Auth 提供商、邮箱验证、回调/退出 URL、域名和注册范围。

官方依据（2026-10-29查阅）：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[用户资料与触发器风险](https://supabase.com/docs/guides/auth/managing-user-data)、[函数权限](https://supabase.com/docs/guides/database/functions)、[PostgreSQL 并发条件重评估](https://www.postgresql.org/docs/current/transaction-iso.html)。以上来源用于权限/并发原则，不代替本仓库的运行验证。
