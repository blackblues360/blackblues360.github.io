# 正式开发环境

记录日期：2026-10-30。工具安装在固定位置，不依赖 Codex 自带浏览器包、NODE_PATH、npx 临时下载或 /tmp 中的可执行文件。

| 工具 | 安装与版本 |
| --- | --- |
| Windows Node / npm | `C:\Program Files\nodejs`；24.19.0 / 11.17.0 |
| Windows Python | `C:\Program Files\Python312\python.exe` |
| Ubuntu WSL / Docker | Ubuntu 26.04；Docker Engine 29.7.2，客户端与服务端可用 |
| Supabase CLI | 官方校验过的 deb，dpkg 安装，`/usr/bin/supabase`，2.122.0 |
| PostgreSQL 客户端 | apt 安装，18.6；本地备份使用容器内与服务端匹配的 17.11 工具 |
| Python 数据库环境 | `/home/blackblues/.local/share/blackblues-dev/db-venv/bin/python`；psycopg[binary] 3.3.4；系统另有 apt psycopg 3.3.2 |
| 前端依赖 | package-lock.json 固定 supabase-js 2.118.0、esbuild 0.28.2、Playwright 1.64.1 |
| 浏览器 | Playwright 使用正式安装的 Microsoft Edge；不借用其他应用的运行时 |

安装包固定保存在 Windows `%LOCALAPPDATA%\blackblues-dev\downloads` 和 WSL `/var/cache/blackblues-dev`。数据库密码在 `%LOCALAPPDATA%\blackblues-dev\credentials\blackblues-account-db.dpapi`，使用当前 Windows 用户 DPAPI 加密。CLI 登录凭据保留在 CLI 自己的凭据存储中。不要复制、打印这些内容或提交 Git。

在仓库根目录 Windows 终端中：

```powershell
npm ci
npm run build:client
python scripts/serve.py
```

`build:client` 同时生成浏览器 SDK 与许可证文件。服务器仅监听 `127.0.0.1:8765`，日志不记录查询参数。浏览器测试默认使用此地址，需要先启动服务器。

```powershell
npm test
npm run test:data-safety-browser
npm run test:locks
npm run test:sop-security
npm run test:account
npm run test:cloud-documents
npm run test:cloud-races
```

在 Ubuntu 中进入本仓库的 `/mnt/c/.../网页开发` 路径，然后执行：

```sh
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io supabase start
supabase test db --local
/home/blackblues/.local/share/blackblues-dev/db-venv/bin/python scripts/check-concurrency.py
/home/blackblues/.local/share/blackblues-dev/db-venv/bin/python scripts/check-document-concurrency.py
/home/blackblues/.local/share/blackblues-dev/db-venv/bin/python scripts/production-concurrency.py --local
/home/blackblues/.local/share/blackblues-dev/db-venv/bin/python scripts/backup-drill.py
```

本地项目固定 ID `blackblues-local`；API 58321、数据库 58322、Mailpit 58324。所有测试身份为合成数据，邀请邮件只进入本地 Mailpit。`local-fixtures.py` 的标准输出含合成凭据，只能由浏览器脚本在内存中接收，不要手工输出。

仓库根目录保持未关联云端，正式操作显式指定项目 ID；本地测试仍必须明确 `--local`。`db reset --local` 只允许用于这个可重建的合成测试环境，不能对云端执行 reset。重建前设置上述镜像来源，避免当前网络访问 ECR/GHCR 失败。曾将根目录关联云端时，CLI 选择云端镜像构建版本而重新下载；已取消这个本地关联，云端资源不受影响。

阶段 A 的独立回归项目位于 `/home/blackblues/.local/share/blackblues-dev/stage-a/project`，57321/57322。它保留阶段 A 的权限契约；阶段 B 撤销纪念日直接 UPDATE/DELETE，因此不能将阶段 A 旧测试原封不动放进阶段 B 库运行后宣称全部兼容。

正式认证配置使用 `supabase/production` 作为 CLI workdir。禁止向云端推送根目录的本地 config.toml。配置文件不含 SMTP 密码；由 Resend 官方集成保存到 Supabase。

```sh
supabase config diff --project-ref orjmbavlxuuccxdphepi --workdir supabase/production
python3 scripts/cloud-audit.py
python3 scripts/verify-cloud.py
```

云端连接池在当前系统 DNS 下返回不存在，HTTPS DNS 重试超时。`apply-cloud-migrations.py` 使用 Supabase 官方迁移 API，固定到已批准项目，逐份读回 SQL 并校验，采用官方分配的版本号；它是保留在仓库的部署脚本。默认只检查，显式 `--apply` 才执行。任何不明历史或 SQL 不一致都会停止，不盲目重试。当前六份迁移已部署，不要另用旧时间戳重复部署。

阶段 C 已通过单连接 HTTPS DNS 解析和用户下载的公开 CA 建立正式库 `verify-full` TLS 连接，完成只读 pg_dump 和独立本地恢复；详情及边界见 [正式备份报告](../plans/supabase-v1/stage-c-backup.md)。系统 DNS 问题仍在；没有修改系统设置或降低 TLS 校验。`.local`、`.git` 和 node_modules 路径均由预览服务器拒绝访问。

第七份 `20261030100000_document_recycle_bin.sql` 已在本地执行，尚未获得正式迁移授权。不要把本地 `config.toml`、测试身份或待审 SQL 自动推送云端。`production-concurrency.py --production` 需要另行获得限定样本创建/清理授权；日常回归只用 `--local`。
