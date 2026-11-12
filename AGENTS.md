# Cloud Notebook 项目上下文与修改规范

## 1. 项目概述

Cloud Notebook 是基于 Next.js App Router 的自托管云笔记应用。
当前固化基线为 v 1.0.1112。本规范适用于整个仓库；依赖和行为以当前源码及锁文件为准。

技术栈：
- Next.js 16、React 19、TypeScript strict。
- Tiptap 3，正文为序列化的 Tiptap JSON。
- Drizzle ORM、better-sqlite3、SQLite WAL。
- Radix UI、Lucide React、Tailwind CSS 和全局 CSS。
- Vitest 单元测试、Playwright 浏览器及 HTTP 集成测试。

依赖的精确版本以 package-lock.json 为准。
安装使用 npm ci，不随意更新依赖或重写锁文件。

## 2. 架构与目录约束

- src/app：
  路由、布局、服务端页面；服务端页面负责初始认证及数据读取。
- src/app/api：
  HTTP 入口、认证授权、输入校验、状态码和响应。
  保留已有实现；新增复杂业务优先提取到 src/lib。
- src/app/uploads：
  通过认证和归属校验读取附件，不能改为公开静态目录。
- src/components：
  客户端界面和交互；不能直接导入数据库、文件系统或服务端密钥。
- src/components/ui：
  可复用交互组件，沿用 Radix 和已有样式。
- src/lib：
  纯函数、业务服务、认证、保存协调、导入导出及资源维护。
  其中部分模块仅供服务端使用，不得通过客户端依赖链引入。
- src/db：
  Schema、数据库连接和迁移入口。
- drizzle：
  已提交的 SQL 迁移及元数据。
- tests：
  unit/*.test.ts 为纯逻辑测试，integration/*.test.ts 为隔离数据库／文件系统集成测试，均使用 Vitest；e2e/*.spec.ts 使用 Playwright，fixtures 存放夹具。文件按业务能力命名，禁止使用版本号或泛化的 refinements 命名。
- data：
  运行数据，禁止作为测试夹具或源码修改对象。

当前 Route Handler 中存在直接 SQL，这是现有实现。
不要为统一分层而一次性搬迁全部业务。

## 3. 代码风格

- 使用 TypeScript strict，保持类型检查通过。
- 组件、类型使用 PascalCase；函数、变量使用 camelCase。
- Hook 使用 use 前缀，布尔变量表达明确状态。
- 使用 @/ 导入 src 内模块，沿用所在文件的格式。
- 外部输入先视为 unknown，使用 Zod 或显式类型收窄。
- 不以 any、ts-ignore 或关闭 ESLint 规则代替修复。
- 数据库类型优先使用 Drizzle 推导类型，客户端仅传递必要字段。
- 新增图标使用 lucide-react，复用已有组件与尺寸约定。
- 用户可见文案使用中文，图标按钮提供 accessible name。
- UI 字号统一使用 text-ui-caption/secondary/body/heading/title 或对应 --ui-* 变量；唯一尺寸表为 src/app/typography.css，不新增任意 UI 字号、不覆盖 text-sm 等通用工具类。
- UI 偏好与文档排版独立，正文、标题和打印字号不能引用 UI token。详细边界见 docs/UI_TYPOGRAPHY.md。

## 4. 状态与请求约定

- 保持现有 React state/ref 和 Context 的职责。
- 桌面页面面板宽度仅在当前浏览器记忆，范围 300～450px；移动抽屉宽度独立，不得覆盖桌面宽度偏好，调整布局不能重建编辑器或丢失编辑。
- isDefault 是默认文件夹属性，不代表其子笔记本没有父级；存在可见父文件夹行时，默认与普通文件夹的子项必须使用相同层级缩进。
- 编辑器扩展与初始正文按实例初始化；浮动工具栏配置保持引用稳定，不能因插件元数据事务无条件触发 React 状态更新。选区与格式的真实变化仍须同步工具栏。
- 不为局部修改引入全局状态库。
- ref 用于异步保存协调，不能通过旧闭包覆盖最新编辑状态。
- 客户端请求必须检查 response.ok，错误不能被当作成功。
- 普通 JSON 写请求使用 Content-Type: application/json。
- 文件上传使用 FormData，不手动指定 multipart boundary。
- 搜索等异步请求处理取消和过期响应。
- 快捷键精确匹配修饰键，页内搜索 Ctrl/Cmd+F、全局搜索 Ctrl/Cmd+Shift+F、插入链接 Ctrl/Cmd+K，遵循弹窗与输入框作用域；约定见 docs/KEYBOARD_SHORTCUTS.md。
- 退出需确认现有编辑已保存及服务器会话已撤销；失败不可伪装为成功，成功后完整导航，不能保留已登录路由缓存。
- HTTP 写接口保留 assertSameOrigin 检查。
- 错误响应沿用 { error: string }。
- 保持接口已有响应包装，如 { page }、{ notebook }、{ results }。
- 保持 400、401、403、404、409 的已有业务语义。
- 请求缺少 Origin 当前允许通过；不得无意改变此接口行为。
  如需收紧，应作为独立安全变更评估兼容性。

## 5. 核心业务约束

### 认证与权限

- 会话有效性由 JWT 和数据库 auth_sessions 共同决定。
- 必须核验撤销、过期、jtiHash、sessionVersion 和当前用户。
- 保留 USER、ADMIN 角色边界和强制改密限制。
- 普通用户读写资源必须限制 userId，并检查父资源状态。
- 不能以客户端提供的 userId 作为授权依据。
- 管理员读取附件的既有权限与普通用户不同，不得误删。

### 编辑与保存

- Page.content 持久化为 Tiptap JSON 字符串。
- PATCH 页面必须携带正整数 version。
- 保留事务内版本复核及 409/currentVersion 冲突响应。
- 内容与标题未变化时，不增加 version。
- 同一页面的保存通过 page-save-queue 串行协调。
- 重命名、恢复、导出等操作保留已有 flush/wait 顺序。
- 409 后不能自动换成最新版本号并覆盖服务器正文。
- 本地草稿是恢复辅助手段，不能替代服务器保存或备份。
- 保留历史文档节点、字体和自动保存配置的兼容读取。
- 自动保存默认选项文案固定为“实时保存”，不附带时间标记；内部 realtime 值和默认 10 秒间隔保持兼容。

### 删除、快照与图片

- CNF 使用版本化 ZIP + 原始 Tiptap JSON + 实际图片资源；导入始终新增、当前用户归属、全新 ID，完整校验后事务写入并回滚文件。正文兼容校验复用 editor-extensions，未知节点／属性必须明确拒绝，不能静默裁剪。边界见 docs/CNF_FORMAT.md。
- 表格列数由 TableMap 逻辑宽度判定，上限 20；命令与事务层同时约束，不能只禁用按钮。
- 页面与笔记本的普通删除保留软删除语义，不改为直接物理删除。
- 管理员永久删除普通用户必须经过确认、权限与来源检查，使用 admin-user-deletion 的事务及文件隔离／回滚流程，并保留审计；不能直接删除管理员。
- 缺失附件仅在路径安全、扫描完整且无正文／快照／封面／回收站引用时清理记录，不能宣称释放了不存在文件的磁盘空间。
- 父笔记本被删除后，其页面不能出现在普通读取和搜索中。
- 保留回收站 7 天、快照 24 小时的现有策略。
- 正文、快照、封面和回收站引用均影响图片清理。
- 扫描不完整、引用不明确或路径不安全时，不得冒险删除。
- 封面字段省略表示不修改，显式 null 表示移除。
- 附件必须验证实际文件内容、归属及受控存储路径。

## 6. Strict DO NOTs

禁止未经兼容性设计、回归验证和明确迁移方案：

- 删除、重建、清空真实数据库或 data 目录。
- 将正式数据、真实账户或已有测试卷用于自动化写入测试。
- 修改已发布迁移来代替新增迁移。
- 修改真实数据库结构却遗漏对应迁移；纯 TypeScript 类型调整应确认是否实际改变 SQL 结构。
- 关闭外键、绕过事务或移除页面版本校验。
- 移除 userId、角色、会话或父资源状态检查。
- 将认证改成仅验证 JWT 签名。
- 改动 Cookie 名称、会话字段或响应契约而不处理兼容性。
- 将正文格式直接替换为 HTML、Markdown 或其他不可兼容格式。
- 通过编辑器重新初始化解决状态问题并导致未保存内容丢失。
- 忽略快照、回收站引用而清理图片。
- 直接复制正在写入的 SQLite 主文件并宣称是完整在线备份。
- 将数据库路径变更误认为附件路径也随之变更。
- 修改真实 .env、泄露账户、密钥或隧道凭证。
- 执行全局 Docker 清理、生产部署或数据恢复作为普通验证步骤。
- 为让测试通过而删除关键断言、跳过权限或屏蔽真实冲突。

这些约束保护兼容性，不意味着禁止演进。
需要调整时，先说明影响、迁移及回滚方案，再增加对应回归测试。

## 7. 验证指令与隔离环境

安装依赖：

```bash
npm ci
```

快速验证：

```bash
npm run typecheck
npm run lint
npm test
```

本地开发、构建和生产启动：

```bash
npm run dev
npm run build
npm run start
```

以上为独立命令，按用途分别执行。本地启动和构建可能通过启动钩子触发数据库初始化及迁移。
优先使用下方隔离 Docker 环境构建和验证，不得让检查连接真实数据库。
需要显式迁移时使用 `npm run db:migrate`；该命令会写入目标数据库，不是只读检查。

环境边界：

| 环境 | 端口 | 数据 |
| --- | --- | --- |
| 正式 | 3000 | `./data`，禁止用作自动化写入测试 |
| 持久化测试 | 3001 | `cloud-notebook-test-data`，禁止随意清空 |
| 一次性 E2E | 3002 | tmpfs，停止或重建容器后数据丢失 |

启动一次性服务（包含生产镜像构建），执行测试后清理：

```bash
docker compose -f docker-compose.e2e.yml up -d --build --wait

E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 \
  npm run test:e2e -- tests/e2e/workspace-search-settings.spec.ts

E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 \
  npm run test:e2e -- tests/e2e/save-lifecycle.spec.ts

docker compose -f docker-compose.e2e.yml down
```

浏览器测试需安装 Chromium，默认路径 `/usr/bin/chromium`；其他路径通过 `CHROMIUM_PATH` 指定。
无论测试成功或失败，都应清理本次创建的一次性服务。
端口或环境变量检查只是防误操作，实际隔离依赖 Compose 的独立数据库和 tmpfs。
不得通过修改测试地址，将写入测试指向正式或持久化测试环境。

验证范围：

- 使用现有 Vitest 覆盖纯函数、保存协调、内容转换和资源引用判断。
- 使用 Playwright 覆盖真实浏览器交互及 HTTP 集成行为。
- 涉及认证、页面版本、恢复和附件归属时，增加真实 HTTP / 隔离数据库回归。
- CNF 接口已有专项回归；其他核心接口应按实际修改补充专项测试，不能把文档中的方案当作已创建、已通过的测试。
- 备份恢复、清理和迁移升级需专项验证，不能由普通单元测试推断其完整可靠性。

## 8. 修改交付要求

- 修改前识别受影响的业务契约与数据路径。
- 小范围改动，保留与任务无关的用户修改。
- 根据风险执行类型、Lint、单元、接口或浏览器检查。
- 报告实际执行的检查，不能把历史通过结果当作本次结果。
- 涉及版本发布时更新中文 CHANGELOG.md。
- 报告数据库迁移、配置变化、兼容性影响和未验证事项。
## 9. 核心数据流与已知边界

- 认证：密码校验 → JWT Cookie + auth_sessions → 每次请求核验会话与用户状态。
- 编辑：Tiptap JSON → 本地草稿 → 同页保存队列 → 带 version 的 PATCH → 事务内复核 → 快照及正文更新。
- 恢复：软删除标记 → 正常入口隐藏 → 回收站恢复；父资源状态决定子页面可见性。
- 附件：内容验证 → 文件和元数据写入 → 归属校验 → 正文、快照、封面及回收站引用保护。
- 系统备份使用 SQLite 在线 backup 和附件归档；用户 ZIP 导入采用校验、ID 重映射和追加恢复。
- SQLite 保持 busy_timeout、WAL 和 foreign_keys 设置，客户端不能绕过服务端读写数据库。
- 当前全局搜索在应用层扫描用户数据，没有独立全文索引。
- 当前快照恢复的保留快照与页面更新不在一个整体事务中；改动该流程时专项检查失败和并发行为。

详细命令见 README.md 和 tests/README.md，运行及部署说明见 `README.md`，发布变更见 `CHANGELOG.md`。

