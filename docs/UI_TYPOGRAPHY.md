# 界面字体系统与审计记录

## 修改前审计

项目使用 Tailwind CSS **v4**：`@tailwindcss/postcss`、`@import "tailwindcss"`，并通过 `@config` 继续加载已有 Tailwind 配置。

扫描范围包含全局 CSS、Tailwind 配置、所有前端组件和页面、登录／注册、后台、菜单／弹窗／Popover、Toast 和编辑器周边。

主要根因：

- `globals.css` 原有 119 条 font-size 声明，其中 13px 有 21 条、11px 有 9 条、15px 有 2 条，还存在 10px、17px、21px 等零散值。
- Sidebar、按钮、菜单、后台、移动端采用不同组件局部值；后置样式重复覆盖同一元素，字号层级与实际信息角色脱节。
- Button、Input 为项目自定义组件，部分继承父元素字号，而其他控件显式声明字号；不是 shadcn 默认 text-sm 引起的问题。
- 原生 small 的相对字号可能产生非预期小数像素；备份文件名另有 JSX 内联字号。
- 移动端通过 font-size: 0 隐藏操作文字，现改为显式隐藏标签。
- 编辑正文、文档标题与打印样式本来就是独立系统，应保留，而不能参与 UI 批量替换。

未发现现有界面大量使用 text-xs/text-sm/text-base 或 Tailwind 任意字号工具类。无需重定义这些通用工具类。

## 唯一字号来源

`src/app/typography.css` 定义全部 UI 字号值，并通过 Tailwind v4 `@theme inline` 暴露语义工具类。
`globals.css` 的组件选择器引用同一组 CSS 变量，不另建字号表。

| 角色 | Tailwind 类 | CSS 变量 | 紧凑 | 标准（默认） | 大号 |
| --- | --- | --- | --- | --- | --- |
| 辅助说明／时间 | text-ui-caption | --ui-caption | 12px | 12px | 14px |
| 菜单／按钮／标签 | text-ui-secondary | --ui-secondary | 12px | 14px | 16px |
| 主要信息／导航 | text-ui-body | --ui-body | 14px | 16px | 18px |
| 面板／分区标题 | text-ui-heading | --ui-heading | 18px | 20px | 22px |
| 页面标题／重要统计 | text-ui-title | --ui-title | 22px | 24px | 26px |

紧凑模式不将辅助文字缩小至 12px 以下；辅助与次要文字同为 12px 时，通过颜色、字重和空间区分。标题采用适量 600 字重，菜单、控件保持常规字重。

新增界面优先使用语义 Tailwind 类；已有组件 CSS 可引用同名变量。不得新增硬编码 UI font-size，也不修改 Tailwind 通用 text-sm 等类的含义。

## 设置与持久化

- 普通用户：账号与设置 → 界面字号 → 紧凑／标准／大号。
- 管理员：系统设置 → 界面显示 → 界面字号。
- 登录账号使用原有 `user_settings` 表保存 `ui_font_size`，迁移为 `0005_ui_typography.sql`；新增列默认 standard，不修改正文或旧设置值。
- 专用 `PATCH /api/settings/typography` 仅允许修改调用者自己的界面字号，校验会话、强制改密状态、来源和枚举值；不放宽原有笔记或管理员接口权限。
- 客户端在保存成功后统一更改 html 的 data-ui-font-size，失败保持当前值；保存期间阻止重复请求。
- RootLayout 根据当前账号数据库偏好输出首屏属性。登录／匿名界面通过经过枚举校验的 Cookie 恢复此浏览器偏好，不先渲染标准字号再跳变。
- Cookie 为 cloud-notebook-ui-font-size，保存一年，不包含身份或凭证；账号偏好优先于 Cookie，新账号仍为标准。
- 改变字号不触发编辑器保存、不改写本地草稿，不改变自动保存间隔。

## 文档与打印例外

以下规则保留原值，不接入 UI 变量：

- `.title-input`：文档标题使用原有 clamp(30px, 3.5vw, 36px)。
- `.notebook-editor`：正文默认 16px；用户自定义 8～96px（含奇数字号）继续由 Tiptap 文档控制。
- `.notebook-editor h1/h2/h3`：保留现有正文标题层级及最终 30/24/20px 值；历史相对字号规则未作无关修改。
- `.notebook-editor code`：保留 .9em，属于文档排版。
- `.prose-print`：正文默认 16px，正文标题 30/24/20px，页面标题 32px，笔记本标题 38px。
- `render-document.tsx` 与 `editor-font-size.ts` 的字号字段、内联样式和步进值属于用户文档格式，不是 UI 字号，应保持兼容。
- Lucide SVG 的 size/width/height 是图标几何尺寸，不属于文字字号，不应替换成文字 token。

打印工具栏属于 UI，可跟随偏好；PDF 中的正文与标题不跟随。自动化守卫要求其他 UI CSS 不再出现数字字号。

## 验证

- 类型检查与 ESLint。
- Vitest 覆盖枚举默认值、三档偶数字号／最小值／层级、硬编码 UI 字号守卫。
- 迁移测试仅使用内存数据库，验证旧数据不被改写、全新迁移和重复迁移正常。
- Chromium 测试：三档设置、账号持久化及刷新首屏、菜单与对话框、明暗主题、桌面／平板／手机、搜索和 Toast、失败保留原值、管理员及匿名偏好。
- 文档回归：8px、96px、自定义字体、默认正文与标题，切换 UI 后正文与版本不变；打印媒体及 PDF 产物。

命令：

```bash
npm run typecheck
npm run lint
npm test
docker compose -f docker-compose.e2e.yml up -d --build --wait
E2E_BASE_URL=http://127.0.0.1:3002 E2E_ALLOW_MUTATIONS=1 E2E_ADMIN_PASSWORD=V31DisposableAdmin12345 npm run test:e2e -- tests/e2e/typography.spec.ts
docker compose -f docker-compose.e2e.yml down
```

Node 与 better-sqlite3 原生模块 ABI 必须匹配。如果本地 Node 已切换版本，应在匹配的 Node 环境安装依赖或在 Docker 中运行测试，不能通过跳过迁移测试来隐藏此问题。

## 修改文件与职责

| 文件 | 用途 |
| --- | --- |
| src/app/typography.css | 唯一字号表与 Tailwind v4 语义工具类 |
| src/app/globals.css | 全界面语义字号引用、控件行高和文字层级 |
| src/app/layout.tsx | 服务端恢复偏好并输出首屏属性，挂载 Provider |
| src/components/ui-typography-provider.tsx | 统一切换、保存状态及匿名 Cookie |
| src/lib/ui-typography.ts | 偏好枚举、类型及校验 |
| src/components/workspace.tsx | 账号设置中的界面字号菜单及语义工具类 |
| src/components/ui/ui-font-size-select.tsx | 后台字号选择器 |
| src/app/admin/settings/page.tsx | 管理员显示设置入口 |
| src/app/admin/backups/page.tsx | 移除备份文件名内联字号 |
| src/components/page-editor.tsx | 移动端操作文字使用标签隐藏，不再依靠零字号 |
| src/app/api/settings/typography/route.ts | 自己账号的字号偏好写入接口 |
| src/db/schema.ts | user_settings 的 uiFontSize 类型 |
| drizzle/0005_ui_typography.sql、drizzle/meta/_journal.json | 追加迁移及迁移注册 |
| tests/unit/ui-typography.test.ts | 字号层级、合法值及硬编码守卫 |
| tests/integration/ui-typography-migration.test.ts | 旧数据兼容、迁移和重复运行检查 |
| tests/e2e/typography.spec.ts | 三档设置、首屏恢复、跨账号、响应式和文档打印回归 |
| tests/e2e/admin-buttons.spec.ts、tests/e2e/v31.spec.ts | 更新过时夹具／断言，保留既有完整回归 |
| tests/fixtures/cover.png | 上传测试专用图片，不再依赖站点 favicon |
| AGENTS.md、README.md、CHANGELOG.md、PROGRESS.md | 维护约束、使用说明和变更验证记录 |
| docs/UI_TYPOGRAPHY.md | 根因、规范、例外及本次结果 |

## 本轮实测结果

- TypeScript、ESLint 和 Docker 内 Next.js 生产构建通过。
- Node 20 Docker 依赖环境中 15 个文件、47 项单元测试通过；源文件只读挂载，迁移仅操作内存数据库。本机 Node 24 与已有 Node 20 SQLite 原生模块 ABI 不匹配，未重装本地依赖或跳过测试。
- 一次性 3002 / tmpfs 服务中，新增 4 项字体回归及原有 9 项回归均通过。
- 验证三档字号及明暗主题、1440 / 768 / 390px 布局、Portal 菜单和弹窗、按钮与搜索、Toast、保存失败、账号持久化、匿名 Cookie 首屏及新账号默认值。
- 文档正文与 version 在切换字号后保持一致；既有真实字体、保存协调、图片续写、Markdown 表格、历史恢复和导出测试通过。
- 生成 2 页字号隔离 PDF 及 31 页长表格 PDF；pdftotext 验证 8px／96px 样例文字及长表格结束标记存在。
- 复查 UI 无硬编码数字字号，12 条保留规则均属于文档或打印例外。
- Safari、Firefox、真实手机和操作系统原生打印对话框未验证；移动验证为 Chromium 的手机宽度测试。
- 正式服务、原有 3001 环境和真实数据库未改动；新增迁移仅在内存数据库及一次性服务中验证，正式部署时按现有启动流程执行。


## v1.1.1118 知识库界面复核

知识库标题使用 `--ui-title`，列表词条名称使用 `--ui-body`；摘要、操作和输入控件使用 `--ui-secondary`，别名、时间与提示使用 `--ui-caption`。联想菜单主文字按菜单角色使用 secondary，别名和键盘提示使用 caption，文字不跟随正文的标题／字号。词条阅读和编辑正文继续使用文档字号，没有将 UI token 写入文档。

知识库采用标题／操作、检索／排序、结果说明和独立纵向滚动列表四个区域；长名称、摘要和别名都限制在自身列内。联想背景约 90% 不透明、文字保持完全不透明，候选列表单独滚动，避免键盘选择滚动正文。预览摘要限制为三行并显示省略，底部操作由分割线隔开。引用检查将页头与页脚固定，结果列表与所选引用修复分为两个任务视图，修复方式在窄屏下单列排列；导入冲突提示同步引用语义字号。

新建词条直接编辑，保存保留编辑状态，不再并列提供阅读切换按钮；移除无意义的返回按钮及返回栈。页内查找移到撤销／重做旁边，随工具栏整体换行。Lucide 定向升级为 1.22.0，导入／导出使用官方 DatabaseArrowUp／DatabaseArrowDown，无手绘图标或临时适配组件。

对应 `tests/e2e/knowledge-layout.spec.ts` 验证三档 UI 字号与 1440／768／390／320px 宽度、长标题／摘要／别名、预览截断、联想菜单滚动和引用修复布局；实际执行结果见 tests/README.md。

本轮实际结果：类型检查、ESLint、隔离生产构建及 92 项单元／集成测试通过，最终 Chromium 回归分两组通过全部 38 项（15 + 23）。已复核桌面、移动、深色联想、预览及引用修复截图；不代表真实设备和所有浏览器均完成验收。测试服务已清理。

后续交互修正：引用检查采用“结果列表 → 选择修复方式 → 确认提交”的单任务视图，避免同屏并列多个提交入口。管理控制台的品牌、词条统计、筛选、状态与分页继续使用 body／secondary／caption 等 UI token，不读取文档字号。
