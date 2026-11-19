# 验证与隔离测试

本文件统一维护验证命令、环境边界和测试选择。安装与部署见 [README](../README.md)，开发约束见 [AGENTS](../AGENTS.md)。命令均从仓库根目录运行；历史执行结果以 [CHANGELOG](../CHANGELOG.md) 为准，不能视为本次已通过。

## 1. 测试目录

| 目录 | 工具与职责 |
| --- | --- |
| `unit/*.test.ts` | Vitest：纯逻辑、保存协调与模拟请求 |
| `integration/*.test.ts` | Vitest：隔离 SQLite、迁移及临时文件系统 |
| `e2e/*.spec.ts` | Playwright：真实 Chromium 和 HTTP 业务回归 |
| `fixtures/` | 静态上传夹具，不使用真实账号或运行数据 |

文件按业务能力命名，优先扩充现有业务文件，不为版本复制测试。不得删关键断言或跳过权限／冲突来让检查通过。

## 2. 环境边界

| 环境 | 端口 | 数据 | 自动化写入 |
| --- | --- | --- | --- |
| 正式配置 | 3000 | 宿主 `./data` | 禁止 |
| 持久化验收 | 3001 | `cloud-notebook-test-data` 卷 | 禁止使用现有验收卷 |
| 一次性 E2E | 3002 | 独立项目 `cloud-notebook-e2e`，`/app/data` tmpfs | 仅限本次创建的服务 |

- 不通过修改测试地址把写入指向正式或持久化验收环境。部分旧脚本只检查端口，这不是数据隔离证明。
- 一次性配置 [`docker-compose.e2e.yml`](../docker-compose.e2e.yml) 不挂载正式目录或测试卷；固定凭据仅用于此环境，不能复用于真实实例。
- 停止／重建一次性容器会丢失数据。开始前确认没有其他任务占用该项目，结束时无论成功失败都清理本次服务。
- `dev`、`start`、`build` 可能通过启动钩子初始化／迁移数据库；`db:migrate` 明确写入目标数据库，不是检查命令。
- 构建验证优先使用 Dockerfile 的临时数据库；本地构建不得连接真实数据库。

## 3. 类型、Lint 与 Vitest

依赖安装使用 `npm ci`，不要为了验证升级锁文件。需要支持项目的 Node.js（要求见 README）；better-sqlite3 原生模块必须与当前 Node ABI 匹配。

```bash
npm run typecheck
npm run lint
npm test
```

定向执行：

```bash
npm test -- tests/unit/keyboard-shortcuts.test.ts
npm test -- tests/integration/cnf-round-trip.test.ts
```

集成测试应自行建立内存数据库／临时目录并清理。切换 Node 后若原生模块不匹配，应使用匹配环境安装依赖或执行下方容器验证，不能跳过相关测试。

### 隔离容器执行 Vitest

下面使用项目 Dockerfile 的 dependencies 阶段，镜像与测试均不挂载真实 `data` 或环境文件；锁文件变化后重新构建依赖镜像。

```bash
docker build --target dependencies -t cloud-notebook:validation-deps .
docker run --rm --network none \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/src:/app/src:ro" \
  -v "$PWD/drizzle:/app/drizzle:ro" \
  -v "$PWD/vitest.config.mts:/app/vitest.config.mts:ro" \
  cloud-notebook:validation-deps node node_modules/vitest/vitest.mjs run
```

此命令只验证 Vitest；不等于完成浏览器、生产构建、备份恢复或断电验证。

## 4. 浏览器与 HTTP 回归

主机需安装项目依赖与 Chromium，默认路径 `/usr/bin/chromium`；不同路径通过 `CHROMIUM_PATH` 指定。服务端运行在容器，Playwright 运行在主机。

确认一次性项目当前未被使用后，复制整个 Bash 块执行。子 Shell 的 EXIT trap 保证启动或测试失败后也执行清理，不改变调用者 Shell 的 trap。

```bash
(
  set -e
  trap 'docker compose -f docker-compose.e2e.yml down' EXIT
  docker compose -f docker-compose.e2e.yml up -d --build --wait
  E2E_BASE_URL=http://127.0.0.1:3002 \
  E2E_ALLOW_MUTATIONS=1 \
  E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 \
    npm run test:e2e
)
```

- 该命令同时验证生产镜像构建。固定管理员口令与 Compose 一致，仅适用于一次性环境。
- 要定向运行，将块中的 `npm run test:e2e` 换为 `npm run test:e2e -- tests/e2e/knowledge-input-admin.spec.ts` 等命令，保留环境变量及清理逻辑。
- 不并行启动多个针对同一实例的浏览器套件，后台设置／会话等全局操作可能互相影响。
- 端口和 `E2E_ALLOW_MUTATIONS` 只是防误操作；实际安全依赖独立数据库、tmpfs 和资源路径。
- 产物写入被 Git 忽略的 `test-results/`，包括截图、PDF、字体报告和失败追踪；需要保留时先复制，后续执行可能覆盖。

仅检查生产镜像、无需启动浏览器时：

```bash
docker compose -f docker-compose.e2e.yml build
```

如前一次操作中断留下服务，在确认属于自己的测试后清理：

```bash
docker compose -f docker-compose.e2e.yml down
```

## 5. 根据变更选择专项

| 变更领域 | 优先检查 |
| --- | --- |
| 保存、版本、草稿 | `unit/save-coordination.test.ts`、`e2e/save-lifecycle.spec.ts` |
| 编辑器空闲／实例生命周期 | `e2e/editor-idle.spec.ts`；原理见 [MEMORY_AUDIT](../docs/MEMORY_AUDIT.md) |
| 字号与文档／打印隔离 | `unit/ui-typography.test.ts`、`integration/ui-typography-migration.test.ts`、`e2e/typography.spec.ts` |
| 快捷键、退出 | `unit/keyboard-shortcuts.test.ts`、`e2e/keyboard-logout-layout.spec.ts` |
| 知识库、引用、IME | `integration/knowledge.test.ts`、`unit/knowledge-mention-plugin.test.ts`、`e2e/knowledge-workspace.spec.ts`、`e2e/knowledge-input-admin.spec.ts` |
| 知识库与引用弹窗布局 | `e2e/knowledge-layout.spec.ts` |
| CNF／名称冲突 | `integration/cnf-round-trip.test.ts`、`e2e/native-notebook-transfer.spec.ts`、`e2e/knowledge-workspace.spec.ts` |
| 管理员用户 ZIP 恢复 | `integration/user-knowledge-backup.test.ts`、`e2e/knowledge-workspace.spec.ts` |
| 图片、永久删除、存储清理 | `integration/admin-user-deletion.test.ts`、`integration/missing-asset-cleanup.test.ts`、`unit/asset-references.test.ts`、`e2e/admin-users-storage.spec.ts` |
| 管理员知识库访问限制 | `e2e/knowledge-input-admin.spec.ts`（入口移除、旧页面跳转及接口拒绝） |
| 封面、面板、滚动 | `e2e/notebook-home-crop.spec.ts`、`e2e/workspace-panels.spec.ts`、`e2e/sidebar-scrolling.spec.ts` |
| 表格逻辑列上限 | `unit/table-limit.test.ts`、`e2e/table-columns.spec.ts` |

表中路径相对 `tests/`。按实际修改补充测试；涉及认证、版本、恢复和附件归属时，不能只测纯函数。备份、迁移升级和清理必须做专项失败／回滚验证。

## 6. 结果与限制

交付报告本次执行的命令、结果、环境和未验证项，不引用旧计数冒充当前结果。浏览器进程中止不算完整通过，补跑要说明范围。

Chromium 视口回归不能代替 Safari／Firefox、真实手机、系统原生打印或长期内存分析。CDP 组合输入经过真实编辑器事件链，但不等于实测所有操作系统输入法；事务回滚测试不等于断电恢复保障。

只改文档时检查 Markdown 链接、代码块语法、脚本名与源码描述即可，不为文档整理连接真实数据或执行部署。
