# 权限与并发验证

2026-10-30阶段A：实际本地Supabase迁移成功，69项pgTAP、5项真实并发、6项格式/ACL、16项真实JWT接口检查通过。完整结果及Supabase/后备PostgreSQL的区别见 [验收报告](../stage-a-report.md)。

新增脚本：`run-local.py`只在独立Linux/WSL目录初始化本地Supabase，输出凭据会被抑制；`--db-only`仅启动数据库。`validate-portable.py`仅对空的回环PostgreSQL实例建立最小Auth兼容桩并执行001→003与pgTAP，需psycopg[binary]及维护者的pgTAP SQL源码；这不等于完整Supabase。`concurrency.py --port N`使用psycopg独立连接并通过pg_stat_activity证实行锁等待；`formats-and-acl.py --port N`检查实际ACL/函数owner并由Node生成真实工具格式夹具。所有脚本只接受回环地址，不接收云数据库URL。

pgTAP结果必须按TAP内容判断，不能只看psql退出码。Supabase路径使用`supabase test db`；后备runner检查每条断言、`not ok`与计划数量。参考[官方测试说明](https://supabase.com/docs/guides/local-development/testing/overview)。

已知边界：全局UUID主键的唯一性检查不受RLS隐藏，已知别人的UUID时可能通过23505推断其被占用，不能由此读取正文。参考[PostgreSQL说明](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)。不为解决这个边界擅自改成复合主键。5MB约束只限制入库JSONB文本，不覆盖HTTP请求体、解析内存、总配额或速率。

本目录不是现有node:test的一部分。独立Supabase项目建在WSL的`/var/tmp/blackblues-stage-a/project`，没有在网站仓库初始化自动迁移，不连接远程数据库。

前置：本地 Docker/CLI/PostgreSQL 可用，按001→002→003手动应用草案，pgTAP 安装在 extensions（或按实际安装位置改测试 search_path），anon/authenticated 有测试扩展 schema USAGE 和断言函数 EXECUTE。执行者需能 SET ROLE 并建立/删除测试 auth.users。不得使用 Service Role Key 执行业务断言；仅 fixture 准备/账户删除/事务控制使用本地管理连接，所有被测业务操作通过 SET LOCAL ROLE anon/authenticated 和模拟 JWT claims 执行。不得关闭 RLS，未来也需用真实 Auth JWT 做 HTTP 冒烟测试；直接数据库 claim 模拟不能证明真实会话验证安全。

permissions.test.sql：固定测试UUID，仅在本地空白测试库运行，BEGIN/ROLLBACK保证可重复；若UUID已存在立即停下，不能ON CONFLICT吞掉异常。Auth表中仅插入id的夹具已在本阶段CLI环境中验证可用；其他版本仍需复核，不得使用生产账户。

自动草案覆盖：三表匿名读取、A自己读取/新增/修改/删除、A读/改/删B、伪造所有权插入、更新转移所有权、profile跨账户、无条件工具写入被拒、空白/超长标题与非法日期/app/schema/顶层内容、revision注入、RPC约束、旧版本保存/删除冲突、软删不可见/不可重存/同ID不可重建、级联账户删除。受限列GRANT拒绝所有权变更的42501也是正确结果，不要求必须命中RLS。

## 真正并发：已由concurrency.py执行的复核步骤

1. 在本地临时库用 fixture 建立A和合法文档D，提交fixture；记录id和revision=1。两个独立连接都 BEGIN，SET LOCAL ROLE authenticated，并设置A的 request.jwt.claims。
2. 连接1调用 save_tool_document(D,1,'device1',合法content,1)，保留事务不提交；应返回revision=2。
3. 连接2调用 save_tool_document(D,1,'device2',合法content,1)，应等待行锁。连接1 COMMIT后，连接2返回0行，再 COMMIT。
4. 以A身份读D，应为device1/revision2。把步骤中连接1改成ROLLBACK，连接2应成功得到revision2。还要做保存与删除竞态：以相同expected_revision竞争，只能一方成功，不能已删后隐式重建。
5. 用本地管理连接清理fixture用户，级联清理数据。所有连接失败时ROLLBACK。

单连接脚本只验证过期版本，不等于双连接并发通过。上述等待后0行预期基于READ COMMITTED；更高隔离级别还需验证40001保留本地并重新读取的流程。还应在目标项目验证普通UPDATE/DELETE、函数ACL和默认权限没有被其他迁移放宽；检查 pg_policies、relrowsecurity、has_table_privilege、has_column_privilege、has_function_privilege 及函数所有者/proconfig。不依赖表owner身份测试RLS。

## 后续集成与边界测试矩阵

| 风险 | 后续验证与预期 |
| --- | --- |
| 匿名写入/伪JWT | 三表INSERT/UPDATE/DELETE和两个RPC全部拒绝；HTTP伪造sub不能替代有效JWT |
| 大小/必填/日期边界 | NULL字段、空白标题、昵称81字符、未知app、version数字/字符串混淆、5MB上下边界、无限日期、闰日分别验证；错误写不改变旧revision |
| 完整工具语义 | 错标签引用、缺孔位、重叠泳道/悬空group/坏锚点/恶意富文本必须被工具适配器拒绝或安全呈现；SQL粗校验并不全覆盖 |
| 网络 | 服务器已提交但响应丢失；读回快照确认，不能重复新建或自动覆盖冲突 |
| 会话 | A编辑未同步→退出→B登录，B不能看见/提交A缓存；A旧请求晚到不能改B界面 |
| 空/删 | 空列表不清本地；404保留本地，另存新id；新旧revision删除竞争 |
| 旧格式 | SOP缺environmentTerms/Ranges、孔板被restoreState清洗、未知版本/损坏JSON分别展示预览与差异，保留原件 |
| 删除账户 | 本地Auth管理流程删除，三表级联；profiles单独删除不删文档；生产备份保留和会话撤销另验证 |

矩阵中的扩展场景并非全部完成，不能作为全部通过记录。真实JWT已由http-auth.py验证，备份恢复另由浏览器测试验证；总配额、限流、完整XSS审计及下一阶段账户切换/同步仍未验证。

## 已执行的本地命令

在WSL中，`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`仅影响本次进程，绕过此前超时的镜像源，不修改全局代理或Docker配置。运行时需要本地Docker与经过校验的CLI：

```sh
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io python3 tests/run-local.py --cli /path/to/supabase --project /var/tmp/blackblues-stage-a/project
PYTHONPATH=/path/to/portable-python-packages python3 tests/concurrency.py --port 57322 --cli /path/to/supabase --project /var/tmp/blackblues-stage-a/project
PYTHONPATH=/path/to/portable-python-packages python3 tests/formats-and-acl.py --port 57322 --node '/mnt/c/Program Files/nodejs/node.exe' --cli /path/to/supabase --project /var/tmp/blackblues-stage-a/project
python3 tests/http-auth.py --cli /path/to/supabase --project /var/tmp/blackblues-stage-a/project
```

上例工作目录为本规划目录；脚本本身不依赖当前目录定位源文件。数据库连接信息从本地CLI status在内存读取，校验回环地址，不将密码/JWT写入源码或报告。http-auth.py只创建随机`.invalid`域名的本地合成账户并在finally中清理，业务请求只用普通用户令牌。若邮箱确认开启，受信本地SQL只用于确认测试夹具。测试后停止本次临时服务；需要重跑时重新启动本地项目。
