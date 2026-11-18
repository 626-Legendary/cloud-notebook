# 测试目录

按测试层级和业务能力组织，不用发布版本号命名文件。

- `unit/`：纯逻辑及模拟请求测试，使用 Vitest。
- `integration/`：隔离 SQLite、迁移及临时文件系统测试，使用 Vitest。
- `e2e/`：浏览器与 HTTP 业务回归，使用 Playwright。
- `fixtures/`：上传等测试使用的静态夹具。

浏览器测试按能力命名，例如 `editor-workspace`（编辑、搜索、打印及恢复）、`notebook-sort-cover`（排序和封面）、`editor-navigation-notifications`（导航和通知）、`keyboard-logout-layout`（快捷键及退出）、`sidebar-scrolling`（列表滚动）。新测试优先加入相应业务文件；跨功能主流程保留在工作区测试中，不为新版本复制整套测试。

在项目根目录运行全部 Vitest 测试：

```bash
npm test
```

运行单个文件：

```bash
npm test -- tests/unit/keyboard-shortcuts.test.ts
```

浏览器测试仅使用一次性 3002 环境，禁止指向真实数据：

```bash
docker compose -f docker-compose.e2e.yml up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 npm run test:e2e -- tests/e2e/sidebar-scrolling.spec.ts
docker compose -f docker-compose.e2e.yml down
```

包含后台登录的测试还需设置一次性环境的 `E2E_ADMIN_PASSWORD`。无论成功或失败都清理本次创建的服务；详细边界见根目录 AGENTS.md。

## v1.0.1110 原生笔记本专项

```bash
npm test -- tests/integration/cnf-round-trip.test.ts tests/unit/table-limit.test.ts

docker compose -f docker-compose.e2e.yml up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 npm run test:e2e -- tests/e2e/native-notebook-transfer.spec.ts tests/e2e/notebook-home-crop.spec.ts tests/e2e/table-columns.spec.ts
docker compose -f docker-compose.e2e.yml down
```

新增校验覆盖完整 CNF 往返、资源去重和归属、失败回滚、损坏与不支持格式、封面裁剪取消、首页导航及 19／20 列（包含合并单元格、命令和事务）。格式及限制见 ../docs/CNF_FORMAT.md。

## v1.0.1110 本轮实际验证命令

宿主检查使用可用 Node.js（无安装或改写宿主依赖）；SQLite 测试使用与服务相同的 Node20 容器，避免原生模块 ABI 差异。以下为实际命令主体，在项目根目录执行；宿主需将 Node 加入 PATH。

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src

docker build --target dependencies -t cloud-notebook:validation-deps .
docker run --rm --network none \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/src:/app/src:ro" \
  -v "$PWD/drizzle:/app/drizzle:ro" \
  -v "$PWD/vitest.config.mts:/app/vitest.config.mts:ro" \
  cloud-notebook:validation-deps node node_modules/vitest/vitest.mjs run

docker build -t cloud-notebook:v3.1-test .
docker compose -f docker-compose.e2e.yml up -d --force-recreate --wait
E2E_ALLOW_MUTATIONS=1 E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 \
  node node_modules/@playwright/test/cli.js test --output=test-results/native-final
docker compose -f docker-compose.e2e.yml down
```

本轮单元／集成测试：21 个文件、71 项通过。类型检查、ESLint、生产构建及完整 26 项 Chromium 回归通过；随后首页按钮对齐修正的两项专项复验和双色图片裁剪像素单项复验通过。结果记录至 CHANGELOG.md。

依赖保持原锁定版本；本次依赖镜像安装报告既有 npm audit 告警（11 moderate、1 high），未执行自动升级或 audit fix。Safari、Firefox、真实触屏设备与断电恢复未验证。

最终视觉与像素补充验证的实际命令：

```bash
E2E_ALLOW_MUTATIONS=1 node node_modules/@playwright/test/cli.js test tests/e2e/native-notebook-transfer.spec.ts tests/e2e/notebook-home-crop.spec.ts --output=test-results/native-visual
E2E_ALLOW_MUTATIONS=1 node node_modules/@playwright/test/cli.js test tests/e2e/notebook-home-crop.spec.ts --output=test-results/crop-pixels
```

以上命令也须使用一次性 3002 环境并在运行后清理。

## 面板布局专项

`tests/e2e/workspace-panels.spec.ts` 覆盖 300～450px 拖动／键盘边界、宽度记忆、编辑器及编辑内容保留、移动抽屉、默认文件夹缩进、贴边滚动条、品牌图标和右侧搜索。

```bash
E2E_ALLOW_MUTATIONS=1 npm run test:e2e -- tests/e2e/workspace-panels.spec.ts
```

须先按上文启动一次性 3002 服务，验证后清理。

本轮面板调整实际运行并通过：

```bash
E2E_ALLOW_MUTATIONS=1 E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 node node_modules/@playwright/test/cli.js test --output=test-results/panel-layout
E2E_ALLOW_MUTATIONS=1 node node_modules/@playwright/test/cli.js test tests/e2e/sidebar-scrolling.spec.ts tests/e2e/workspace-panels.spec.ts tests/e2e/notebook-home-crop.spec.ts tests/e2e/keyboard-logout-layout.spec.ts tests/e2e/typography.spec.ts --grep 'sidebar labels|page panel resizing|home cards|exact keyboard|all presets remain usable' --output=test-results/sidebar-final
```

完整 27 项通过，最后 5 项专项通过；另有工具栏和多档字号 3 项补充通过。类型检查、ESLint 与 Docker 生产构建通过；本轮未改数据库或真实环境配置。

## 编辑器空闲性能回归（1.0.1112）

`tests/e2e/editor-idle.spec.ts` 检查聚焦、纯元数据事务、编辑、加粗、字号、撤销／重做、保存与切页后的空闲状态。使用真实编辑器事件统计，检查停止操作后事务数量不继续增加，不以容易波动的固定内存阈值作为断言。保存返回不重建编辑器，切页返回保留正文与格式。

```bash
docker compose -f docker-compose.e2e.yml up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 \
  npm run test:e2e -- tests/e2e/editor-idle.spec.ts
docker compose -f docker-compose.e2e.yml down
```

测试成功或失败后均清理本次一次性环境。该用例不能替代长时间、多浏览器的内存分析。

本次实际执行的静态检查入口（Node 路径按本机环境设置）：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src
```

本机通过已有 Node 执行对应的 TypeScript 和 ESLint 入口；全部 71 项 Vitest 测试在 Node20 隔离容器中通过，避免本机原生 SQLite 模块的 ABI 差异。生产镜像构建通过。新增空闲专项单独执行通过，并额外测量输入后静置 60 秒：事务增量 0，配置更新 0，节点／监听器数量不增长。有限时间测量不代表所有浏览器和复杂文档均已完成长期内存验证。

完整浏览器回归实际执行并通过（28 项）：

```bash
E2E_ALLOW_MUTATIONS=1 E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 \
  node node_modules/@playwright/test/cli.js test --output=test-results/editor-idle-full
```

该口令仅属于一次性 Compose 环境；本轮独立的空闲专项也通过（1 项），完整套件包含该专项。测试后执行 `docker compose -f docker-compose.e2e.yml down` 清理。


## 知识库系统回归（1.1.1118）

新增 `knowledge-document`、`knowledge-http` 单元测试；`knowledge`、`knowledge-migration`、`user-knowledge-backup` 集成测试，并扩展 `cnf-round-trip` 与 `missing-asset-cleanup`。实际在 Node20 隔离容器通过 26 个文件、89 项测试，覆盖别名唯一与归一、正文版本、代码／链接输入边界、精确修复及事务回滚、全局标签、迁移保留旧正文、图片保护、CNF2 范围／冲突／ID 映射和用户 ZIP2 恢复。

`tests/e2e/knowledge-workspace.spec.ts` 包含 6 个真实浏览器／HTTP 场景：阅读与共用编辑器、别名／循环导航／来源、手动联想与剪贴板／撤销重做／合成组合输入、引用检查与标签管理、认证权限与 CNF2、新建空词条及详情框中的标签／快捷键、别名跨会话冲突与明确放弃流程。仍保留所有原有浏览器测试和关键断言。

```bash
docker compose -f docker-compose.e2e.yml up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 \
  E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 npm run test:e2e
# 无论测试成功或失败，都执行清理：
docker compose -f docker-compose.e2e.yml down
```

此管理员口令仅用于一次性环境。不能将测试指向正式 3000 或持久化测试 3001。当前 Chrome 桌面／移动视口的自动化不替代真实设备、操作系统中文输入法、Safari／Firefox或多小时／大规模压力验收。词条的 409 与权限由集成及真实 HTTP 用例覆盖；不把页面历史快照测试当作词条具备同样的历史恢复入口。

本次完整 Chromium 回归实际通过 34 项（`test-results/knowledge-release`），涵盖原有 28 项和新增 6 项知识库场景；TypeScript、ESLint 和隔离 Docker 生产构建均通过。最后调整知识库按钮的移动端图文对齐后，再次构建成功并通过全部 6 项知识库专项（`test-results/knowledge-layout-verified`），已查看移动视口截图；界面截图不等同于真实设备验收。测试服务已清理。
