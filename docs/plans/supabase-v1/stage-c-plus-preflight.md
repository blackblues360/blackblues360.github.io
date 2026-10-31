# C+ 部署前审查（2026-10-31）

正式项目 blackblues-account / orjmbavlxuuccxdphepi / 新加坡 / Free 已实际确认。远程 origin/main 与 HEAD 9ebe169 一致。

第七迁移 20261030100000 已执行且原有数据不变；七份历史与本地完全一致，实际目录比较 SHA256 c94d29063ecaad46cea84e3788ed296465fb343e728a0a3ad263280ad31df56c。生产回收站事务回滚测试通过。

生产新备份已独立恢复并通过8类比较及6类本地流程，源数据Auth/业务表均为0；归档 SHA256 2b41d4216304dc396e27e04dd0ca5c5eda8d7990783697f88761fcd03e0005e7，保留在忽略目录，不发布归档。

公开部署包采用白名单，排除草稿、测试、数据库SQL、文档、备份和node_modules。GitHub Pages保持blackblues.xyz及HTTPS，使用现有Actions发布白名单包。生产前端URL与Publishable Key对应正式项目，无服务端秘密。

## 排除并保留的用户修改

- drafts/20260529-long-talk-gemini.md
- drafts/ai-tools-half-year.md
- drafts/before-building-site.md
- drafts/cloudflare-github-pages.md
- drafts/rain-tea-night.md
- drafts/sapiens-notes.md

孔板 index.html / plate-layout.css 只暂存文件保护节点、样式和云端引用；独立新版布局保留在工作区。一次性、绑定本次备份的 scripts/deploy-stage-c.py 不提交。

## 已审查的正式暂存范围

- .github/workflows/deploy.yml
- .gitignore
- account/index.html
- assets/css/cloud-documents.css
- assets/js/account/data.mjs
- assets/js/account/document-manager.mjs
- assets/js/account/documents.mjs
- docs/development/toolchain.md
- docs/plans/supabase-v1/database-design.md
- docs/plans/supabase-v1/migration-plan.md
- docs/plans/supabase-v1/repository-audit.md
- docs/plans/supabase-v1/review-report.md
- docs/plans/supabase-v1/sql/001_initial_schema.sql
- docs/plans/supabase-v1/sql/002_rls_policies.sql
- docs/plans/supabase-v1/sql/003_indexes_and_constraints.sql
- docs/plans/supabase-v1/stage-a-report.md
- docs/plans/supabase-v1/stage-b-files.txt
- docs/plans/supabase-v1/stage-b-operations.md
- docs/plans/supabase-v1/stage-b-report.md
- docs/plans/supabase-v1/stage-c-backup.md
- docs/plans/supabase-v1/stage-c-files.txt
- docs/plans/supabase-v1/stage-c-release-checklist.md
- docs/plans/supabase-v1/stage-c-report.md
- docs/plans/supabase-v1/tests/README.md
- docs/plans/supabase-v1/tests/concurrency.py
- docs/plans/supabase-v1/tests/formats-and-acl.py
- docs/plans/supabase-v1/tests/http-auth.py
- docs/plans/supabase-v1/tests/permissions.test.sql
- docs/plans/supabase-v1/tests/run-local.py
- docs/plans/supabase-v1/tests/validate-portable.py
- package-lock.json
- package.json
- scripts/apply-cloud-migrations.py
- scripts/backup-drill.py
- scripts/backup-production.py
- scripts/build-client.mjs
- scripts/build-pages.py
- scripts/check-cloud-connection.py
- scripts/check-concurrency.py
- scripts/check-document-concurrency.py
- scripts/cloud-audit.py
- scripts/cloud-http-auth.py
- scripts/compare-databases.py
- scripts/configure-cloud-mail.py
- scripts/local-fixtures.py
- scripts/production-concurrency.py
- scripts/production-fixtures.py
- scripts/serve.py
- scripts/verify-cloud.py
- scripts/verify-recycle-bin.py
- supabase/.gitignore
- supabase/checks/cloud-smoke.sql
- supabase/config.toml
- supabase/migrations/20261030071325_001_initial_schema.sql
- supabase/migrations/20261030071327_002_rls_policies.sql
- supabase/migrations/20261030071329_003_indexes_and_constraints.sql
- supabase/migrations/20261030071332_anniversary_revisions.sql
- supabase/migrations/20261030071333_private_write_limits.sql
- supabase/migrations/20261030071335_quota_retry_identity.sql
- supabase/migrations/20261030100000_document_recycle_bin.sql
- supabase/production/supabase/config.toml
- supabase/production/supabase/templates/confirmation.html
- supabase/production/supabase/templates/invite.html
- supabase/production/supabase/templates/recovery.html
- supabase/templates/confirmation.html
- supabase/templates/invite.html
- supabase/templates/recovery.html
- supabase/tests/phase_b.test.sql
- supabase/tests/phase_c.test.sql
- supabase/tests/quota.test.sql
- tests/account-browser.cjs
- tests/cloud-documents-browser.cjs
- tests/cloud-races-browser.cjs
- tests/multi-tab-browser.cjs
- tests/sop-security-browser.cjs
- tools/plate-layout/README.md
- tools/plate-layout/app.mjs
- tools/plate-layout/files.mjs
- tools/plate-layout/index.html
- tools/plate-layout/plate-layout.css
- tools/plate-layout/tests/browser.cjs
- tools/plate-layout/tests/data-safety-browser.cjs
- tools/plate-layout/tests/files.test.mjs
- tools/sop-timeline/README.md
- tools/sop-timeline/app.mjs
- tools/sop-timeline/draft.mjs
- tools/sop-timeline/export.mjs
- tools/sop-timeline/index.html
- tools/sop-timeline/style.css
- tools/sop-timeline/tests/browser.cjs
- tools/sop-timeline/tests/draft.test.mjs
- tools/sop-timeline/tests/environment-browser.cjs
- tools/sop-timeline/tests/text-browser.cjs

## 未解决边界

网关解析前硬字节限制、失败请求持久限流、正式抗滥用压力测试、异地加密定时备份均未完成。真实手机与电脑往返须用户验收。真实邮件送达与重置未执行，公开注册保持邀请制，不会因发布而放开。
