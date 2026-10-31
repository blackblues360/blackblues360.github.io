# 阶段 C：正式数据库独立备份与恢复演练

日期：2026-10-30。结果：已实际完成正式项目只读逻辑备份，恢复至独立本地数据库并核对。正式库当时没有业务数据；这不是已有重要科研数据的完整灾难恢复验收。

## 已实际执行

- 源：已批准的 `blackblues-account`，项目 `orjmbavlxuuccxdphepi`。通过新加坡 session pooler 连接，使用 PostgreSQL `sslmode=verify-full`、官方主机名和用户下载的公开 CA；没有关闭证书或主机名验证。
- 当前系统 DNS 无法正确解析连接池。仅在这次连接参数中使用 Google HTTPS DNS 的实际 A 记录作为 `hostaddr`，TLS 校验仍针对官方主机名；未修改系统 DNS，也未把 IP 固定进脚本。
- 正式库仅执行 `pg_dump -Fc` 和只读核对查询；没有向正式库应用阶段 C 迁移或执行恢复。
- 使用正式安装的 PostgreSQL 18.6 客户端导出 PostgreSQL 17 的逻辑归档，使用本地 17.11 容器中的 `pg_restore` 实际恢复成功。
- 恢复目标：随机命名的 `production_restore_<UUID>` 本地数据库，位于隔离的 `blackblues-local` 容器；所有者恢复使用本地 `supabase_admin`。缺少的云端角色仅在本地补为 NOLOGIN 占位角色。
- 实际核对 8 类信息一致：业务行、文档所有者/revision/删除标记、Auth 用户关联、RLS 策略、表权限、列权限、函数定义/所有者/search_path/权限、迁移历史。
- 源数据数量依次为 Auth 0、profiles 0、anniversaries 0、tool_documents 0。空表一致不能证明未来真实业务内容已经演练恢复。
- 在恢复后的**本地目标**应用待审阶段 C 迁移，添加合成 A/B 身份和文档，实际验证所有权、RLS、revision、回收站、恢复、永久删除 6 类流程。
- 最后删除本次随机恢复库；保留独立归档，不影响原正式项目和根目录本地测试库。

归档位于仓库忽略目录：

```text
.local/production-backups/production_restore_e843ceccd3fd42a9af3bc02b30ea870f.dump
大小：402528 字节
SHA256：e92c067131f2d484bf2de0b4085d0f17d440a0454eff326e71d17d2fd26bae64
```

公开 CA 副本位于 `.local/certs/prod-ca-2021.crt`，SHA256 为 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`。密码由仓库外 DPAPI 凭据提供，经标准输入进入固定 Python 环境；不进入脚本、命令参数、输出或报告。

可重复脚本为 `scripts/backup-production.py`。默认执行只读正式导出；`--archive` 只能指定 `.local/production-backups` 内的 dump，复用归档进行本地恢复与源端只读比对。归档时间点后如果正式数据已变化，比较会失败，不能把新数据差异视为原归档损坏。

## 已执行但最初失败，后续已解决

1. 系统 DNS/CLI 连接通道失败：采用单连接的 HTTPS DNS 地址解析，保留严格 TLS 校验。
2. 系统 CA 无法校验 Supabase 数据库证书：使用用户从正式项目下载的 CA 后连接成功。
3. 普通本地 postgres 无权恢复 Vault/部分对象所有者：改为本地 supabase_admin 恢复。
4. 恢复时缺少两个托管角色：仅本地创建 NOLOGIN 角色后恢复、权限比较及合成流程全部成功。

## 保护范围和未执行项

- 这是单数据库逻辑归档，不是 PostgreSQL 整个集群、角色密码或完整 Supabase 项目镜像。
- 不包含 Storage 对象本体、Auth 服务配置、SMTP 密码、项目密钥、DNS、Edge Function 部署；这些需要独立恢复资料。本项目工具目前没有使用 Storage。
- 尚未执行新云项目的整体恢复、真实用户重新登录、实际邮件投递、真实设备往返和大规模重要数据恢复。
- 本地归档不等于异地加密备份。尚未建立定时任务、加密站外副本、到期清理、备份失败通知或经过测量的 RPO/RTO。
- `.local` 已被 Git 忽略；本地预览服务器实际拒绝读取点目录及 node_modules。归档本身仍需在启用真实数据前落实磁盘访问权限和加密保存。
- JSONB 保留 JSON 值，不能保证用户输入文件的空白、键顺序或原始字节。孔板 JSON、SOP `.soptime` 的独立导出继续保留。

Free 项目应定期独立导出并保留站外副本；数据库备份不包含 Storage 对象，见 [Supabase 官方备份说明](https://supabase.com/docs/guides/platform/backups)。重要数据开放前，应审核备份负责人、频率、加密位置和恢复清单，执行有代表性样本的恢复并测量耗时。当前没有因此购买服务或建立自动任务。
