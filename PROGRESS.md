# Cloud Notebook 执行与验证记录

日期：2026-10-23（America/Los_Angeles）。本轮为现有项目增量修改。

## 数据安全

未改动正式数据库、正式 Docker 容器、正式卷或现有 3001 测试服务。未执行数据库迁移文件变更、数据重写或账号迁移。构建数据库使用 Dockerfile 既有的 `/tmp/cloud-notebook-build.db`。浏览器回归使用独立 Compose project `cloud-notebook-e2e`、端口 3002、`/app/data` tmpfs；测试账号、附件、快照、垃圾箱数据均位于可丢弃容器内。

## 修复与实现

- 字体根因：原菜单仅将显示名称写入 `font-family`，没有加载对应字体。现使用 `next/font/google` 构建时下载、自托管 WOFF2、`display: swap`、`preload: false`，按实际使用的字体与字形请求资源。五种中文、五种英文字体均已接入。字体 ID、分组、显示名、稳定 CSS 变量和 fallback 在共享配置中管理。旧名称在渲染时映射，JSON 和快照不迁移。编辑器与打印页使用同一组变量。
- H1/H2/H3 使用 30/24/20px、700/650/600 字重与明确段间距。显式字号 mark 保持优先；混合字号步进仍分别调整，默认标题按可见字号步进。
- 搜索改为按钮锚定的 Radix Popover，支持 Toggle、自动聚焦、Escape、清空、关闭、Enter/Shift+Enter。浏览器发现跳转匹配时抢焦点导致关闭，已改为保留搜索输入焦点。高亮为临时 ProseMirror decorations，不写入正文。
- BubbleMenu 移除字号下拉，使用 A−/A+；与主工具栏复用字号命令。主工具栏仍支持精确与自定义 8–96px 字号。
- 删除 Markdown Source UI、状态及样式；保留 Markdown 输入、粘贴、表格、导入导出。移除 Inline Code UI、专属输入/粘贴规则与快捷键，保留旧 code mark 的 schema、保存和渲染；新增明确的代码块按钮。
- 垃圾箱改为 Editor Panel 内的工作台视图，增加搜索和类型筛选，Sidebar active state，关闭后恢复之前页面；原恢复、永久删除确认、清空与 retention API 保留。采用内部 view state，没有新增 `/app/trash` 路由。
- Notebook Rename 与 Edit Cover 分离；封面对话框只处理预览、上传、更换和移除，不再包含标题输入。上传按钮无图标，使用统一高度、间距和不换行布局。Notebook 菜单重命名、封面、置顶、移动分组；Page 菜单置顶位于重命名之前。
- Logout 改为 Lucide LogOut；增加置顶组间距和柔和分隔，统一菜单图标槽。三栏独立滚动，修复收起 Sidebar 后切换移动宽度仍保留桌面网格的问题。
- 长标题初次挂载和面板宽度改变时重新计算 textarea 高度，计算包含边框；移动工具组允许换行，避免工具按钮被面板裁切。
- Favicon 已存在且为自定义云图标。复用 `src/app/favicon.ico` 的 Next.js App Router 文件约定，不额外增加 metadata icons；现有 PNG 留作原始素材。

## PDF 根因与方案

原 `render-document.tsx` 没有 table/tableRow/tableHeader/tableCell 分支，走 default fragment 会丢失全部表格语义。现输出真实 table/thead/tbody/tr/th/td，保留合法 colspan/rowspan、块对齐和行内格式；第一行全为 header cells 时使用 thead 支持跨页重复表头。打印直接渲染数据，不依赖编辑器横向滚动容器。固定表格布局、单元格换行和安全的单元格 padding 限制宽度；移除整表禁止分页，按行尽量避免拆分，允许长表格自然跨页。保留颜色和高亮的 print-color-adjust。

Page Title 使用独立 32px/700 标题类，Notebook Title 38px。标题仍独立存储，不插入 Tiptap JSON。打印仍为浏览器原生流程；Playwright 仅作为开发测试依赖，不是生产 PDF 服务。

## 验证

- TypeScript `tsc --noEmit`：通过。
- ESLint `eslint src`：通过。
- Vitest：12 个测试文件、37 项通过，较 V3.0 新增 7 项针对性回归，覆盖字体映射、表格结构/合并/格式/长内容、旧 code mark 和标题字号步进。
- Production Build：Docker builder 内真实 `npm run build` 通过，包含 `next/font/google` 字体获取和静态资源打包。
- Docker Build：`cloud-notebook:v3.1-test` 完整多阶段镜像构建通过；未部署正式环境。
- Chromium/Playwright：三个端到端场景，使用本机 Chromium 连接隔离容器。最终 3/3 通过（34.2 秒），结果及截图位于 `test-results/`。

浏览器覆盖：

1. 十种字体实际加载与渲染，读取 computed font-family、FontFaceSet 和 CDP `CSS.getPlatformFontsForNode`，确认真实 custom font glyphs。重点中文 Noto Sans SC→Noto Serif SC、英文 Inter→Merriweather 的文本测量宽度不同；未选择段落保持原样。检查持久化、刷新、Undo/Redo、字号步进。
2. 正文/H1/H2/H3 下拉切换、移除源码/行内代码入口、保留代码块和旧 mark；字体快照真实恢复。
3. 搜索开关、锚定位置、焦点、临时高亮、Enter/Shift+Enter、清空和 Escape；全局搜索结果跳转。
4. Page/Notebook 菜单顺序、置顶显示与取消后隐藏、Trash 内嵌布局、恢复、永久删除 AlertDialog；封面上传、更换、移除和纯封面对话框。
5. 1920、1440、768、390px 的页面宽度、工具按钮边界、标题高度；收起 Sidebar 后移动布局。
6. 2×2、3×5 富文本表格，长单元格、对齐、Bold/Color/Highlight、深色模式发起单页和整本打印；中文 Markdown 表格粘贴与打印、行编辑、图片插入后继续输入。
7. 密码显示/隐藏、实际关闭注册后的 Toast、Login/Admin 的共享 favicon。
8. 60×5 长表格输出 31 页 A4 PDF；`pdftotext` 检查全部 300 个单元格坐标、末行和结束标记，未丢失后续内容。

字体验证中的环境细节：Linux 缺少 Next.js 可选 Arial fallback，直接 `document.fonts.load` 整个 computed stack 会因 fallback 报错。E2E 明确加载主自托管字体，并检查实际渲染 glyphs，而不是忽略错误或只验证 JSON。

## 证据与命令

- [实际字体报告](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/actual-fonts.json)
- [1440px 截图](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/workspace-1440.png)
- [390px 截图](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/workspace-390.png)
- [单页 PDF](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/page.pdf)
- [整本 PDF](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/notebook.pdf)
- [长表格 PDF](test-results/v31-V3-1-isolated-workspac-bdb14-trash-and-responsive-layout/long-table.pdf)
- [中文 Markdown 表格 PDF](test-results/v31-image-continuation-Mar-8b63f-e-and-font-snapshot-restore/markdown-table.pdf)

`test-results/` 是本地生成、被 Git 忽略的测试产物，重新执行会替换。可复现命令见 README 的「独立浏览器回归」。

## UNVERIFIED / 范围限制

- 未人工操作有界面的系统原生 Print Preview / 打印机驱动；实际验证的是 Chromium print media 和其真实 PDF 输出。
- 未运行 Safari、Firefox、真实 iOS/Android 和物理设备字体差异；响应式验证为 Chromium viewport。
- 未等待现实 7 天/24 小时验证定时垃圾箱与 Snapshot 到期；沿用既有后端实现，本轮未改动其生命周期逻辑。
- 不宣称覆盖全部管理员备份恢复、每种拖拽操作、极大量 Sidebar 项目或所有可能的合并表格。本轮保留既有 API 并运行原有单元回归。

## 关键文件

- `src/app/fonts.ts`、`src/app/layout.tsx`、`src/lib/editor-formatting.ts`：字体资源、全局变量、稳定映射与旧值兼容。
- `src/components/page-editor.tsx`、`src/lib/editor-font-size.ts`：搜索、字号、旧 code 兼容、工具栏和标题高度。
- `src/components/workspace.tsx`：垃圾箱面板、封面、菜单、导航与图标。
- `src/lib/render-document.tsx`、`src/app/print/page/[pageId]/page.tsx`、`src/app/print/notebook/[notebookId]/page.tsx`、`src/app/globals.css`：表格语义、打印层级与响应式样式。
- `tests/unit/print-table.test.ts`、`tests/unit/editor-font-size.test.ts`：新增单元回归。
- `tests/e2e/v31.spec.ts`、`playwright.config.ts`、`docker-compose.e2e.yml`：真实浏览器回归与可丢弃环境。
- `package.json`、`package-lock.json`、`.dockerignore`、`.gitignore`、`README.md`：开发依赖、测试入口、产物隔离与使用说明。

最终临时 E2E 服务已清理；测试镜像 `cloud-notebook:v3.1-test` 和本地验证产物保留，可按 README 重建测试环境。

## V3.1 后续八项交互细化（2026-10-23）

- 文件夹重命名补齐 Pencil 图标；账号与设置改为 Settings 齿轮。
- 深色高亮采用原色 26% 与透明背景混合，仅影响编辑器呈现，文字保持完整不透明度；原始 highlight color、JSON、快照与打印不变。浏览器验证蓝色高亮在 dark mode 中透明合成，打印仍为原来的 `#BFDBFE`。
- 全局搜索固定模态框尺寸、内部滚动与 scrollbar gutter，固定提示区空间，保留已有结果，忽略取消请求的旧响应；逐字输入四组关键词验证对话框和输入框的位置、高度保持不变。
- 导出范围仅保留「当前页面」「当前笔记本」两个选项。
- 置顶条目增加 18px 左侧缩进及内容 padding。
- 正在编辑的 Page ID 同步到 `/app?page=…`；刷新后通过已有鉴权接口加载该页面和所属笔记本/页面列表。浏览器以笔记本中的第二篇页面测试刷新恢复；无效/删除/不可访问的页面清理定位参数，不跨用户恢复内容。
- 设置改为分组菜单：外观和自动保存采用 RadioGroup + Check 指示；账号信息使用二级菜单展示用户名、注册时间。仅登录设备打开独立模态框，保留退出单个/其他设备功能；「当前设备」颜色为 `#4d765b`。
- 新增 `tests/e2e/workspace-search-settings.spec.ts`，覆盖八项细化，包括原色持久化与打印、菜单选中状态、刷新第二篇页面、无效页面回退、导出文案及搜索定位。

本轮沿用独立 3002/tmpfs 环境，未修改生产或原有 3001 服务。TypeScript、ESLint、37 项 Vitest 通过；新增场景与原三个场景首轮合计 4/4 通过。最终提示区稳定性改动已复验：4/4 Chromium E2E 通过（43.5 秒）；最终 TypeScript、ESLint、生产构建及 Docker Build 通过。独立测试容器已清理，测试证据保留。

证据（本地生成文件）：

- [深色高亮](test-results/refinements-workspace-refi-67448-ighlight-and-settings-menus/dark-highlight.png)
- [账号信息菜单](test-results/refinements-workspace-refi-67448-ighlight-and-settings-menus/account-menu.png)
- [登录设备](test-results/refinements-workspace-refi-67448-ighlight-and-settings-menus/devices-dialog.png)
- [稳定搜索框](test-results/refinements-workspace-refi-67448-ighlight-and-settings-menus/stable-search.png)

## 1.0.1023：加载、保存竞争与字体扩展

对应本轮 13 项请求，继续使用独立 3002/tmpfs 测试环境。未修改生产数据库、实际 `.env`、正式容器或已有 3001 测试服务。

### 保存冲突调查与修复

发现可复现的客户端竞争：原编辑器没有进行中请求锁，自动保存、快捷键保存与卸载补保存可以携带同一 version 同时发出；另一个同标签页来源是重命名/恢复快照更新版本后重建仍有脏内容的编辑器。这里没有证据表明字体文件或 SQLite 同步本身损坏，字体命令只是会产生文档更新并触发保存。

- `page-save-queue.ts` 按 page ID 串行执行请求；编辑器复用进行中任务，后续编辑在已确认版本上继续保存。
- 重新进入页面先等待本标签页先前的保存完成，避免在旧保存响应返回前加载旧版本。
- 重命名、恢复快照、删除活动内容和导出先 flush 编辑器；不能保存或有真实冲突时停止这些操作，不绕过版本检查。
- 保存期间的新草稿在 ACK 后更新为新的 base version，保留后续刷新恢复机会。草稿恢复只检查一次，不再因保存偏好变化重复弹出恢复确认。
- 真实服务器 409 保留；自动保存不会持续重试冲突或强行覆盖远端内容。
- 浏览器控制第一笔保存响应延迟，同时修改字体、连续 Ctrl+S、重新打开 Notebook 以销毁旧编辑器，确认最大在途请求为 1、版本单调递增、内容保留且无自冲突；同页未保存内容再重命名也保留。另通过独立 API 修改远端版本，确认本地后续保存仍收到 409，远端内容未被覆盖。

### 自动保存

默认实时保存改为每 10 秒；其他间隔为 1 分钟、5 分钟、10 分钟，保留关闭。连续输入不会无限延后定时保存；正在请求时切换偏好以最新设置为准。已有 `10s`/`30s` 值通过读取时归一兼容，不迁移数据库；schema 的 text enum 仅扩展 TypeScript 允许值，没有 SQL 迁移或数据重写。浏览器实际等待并验证了默认 10 秒自动保存。

### 界面与版本

- 新增 App Router `app/loading.tsx` 与统一同步旋转加载视图；读取初始 Workspace、恢复页面和初始化编辑器期间不先显示空白工作台。
- 面包屑超过 60 个字符显示 `...`，title 属性保留全文；按 Unicode code point 截断，不切断代理对。
- 置顶条目的更多菜单增加取消置顶。
- 删除 Pages Panel 的页面搜索输入及过滤状态；全局搜索、正文查找保留。
- `APP_VERSION` 支持运行时配置，默认 `1.0.1023`，Editor Panel 右下角显示 `v 1.0.1023`。配置示例和三个 Compose 文件均已接入，未重启正式环境。
- 测试徽标只显示在测试环境的登录页；App/Admin 不显示环境标签，正式登录页也不显示。
- 导出操作按钮无图标；打印预览按钮纯文字、顶部右对齐，下面增加 divider。打印前仍等待字体和图片。

### 字体扩展

字体选择仅显示名称，去除 Noto 英文别名和「云笔记 Aa」样例。当前 8 种中文、11 种英文，共 19 种。

新增：粉圆、织芒行书（Zhi Mang Xing）、龙苍草书/行草（Long Cang）；Montserrat、Poppins、Plus Jakarta Sans、Lora、Cinzel、Caveat。粉圆使用 [justfont 官方 2.1 文件](https://github.com/justfont/open-huninn-font/releases/tag/v2.1)，转为 WOFF2 后从约 4.9MB 缩至约 2.2MB，通过 `next/font/local` 按需自托管；其余沿用 `next/font/google`。保留 SIL OFL 文件，Docker 加入 public 资源以分发 `/font-licenses/OFL-huninn.txt`。

浏览器逐一读取新字体的 FontFaceSet 与 CDP 实际 glyph 使用信息，九种都使用了真实自托管字体，不只是 JSON 字段。

### 测试与证据

新增 `tests/unit/save-coordination.test.ts` 和 `tests/e2e/save-lifecycle.spec.ts`，更新已有字体计数及设置菜单断言。单元测试为 13 个文件、42 项通过；TypeScript、ESLint、生产构建和 Docker Build 通过。完整六组 Chromium 回归的最终结果在本节末尾记录。

- 加载截图：`test-results/save-lifecycle-loading-ver-89fac-pin-and-nine-new-real-fonts/refresh-loading.png`
- 登录页测试徽标：同目录 `test-login.png`
- Workspace 版本号：同目录 `workspace-version.png`
- 打印工具区：同目录 `print-toolbar.png`
- 九种新字体实际渲染：同目录 `new-fonts.json`
- 保存竞争记录：`test-results/save-lifecycle-slow-saves--ec4dc--conflicts-remain-protected/save-coordination.json`

范围限制：这些是隔离环境中可复现问题的修复与验证，未读取正式用户笔记或生产日志，不据此宣称所有生产 409 都是同一原因。真实多标签页/多设备同时修改仍可能产生合理冲突。原有跨浏览器/原生打印对话框等 UNVERIFIED 项继续适用。

最终统一回归：六组 Chromium E2E 全部通过（约 1.2 分钟）。13 个文件、42 项 Vitest 通过；最终 TypeScript、ESLint、Production Build 与 Docker Build 通过。临时 E2E 服务已清理，镜像及本地证据保留。

## 管理页面按钮布局修复

针对 `/admin/users` 和 `/admin/assets` 的按钮图标、文字上下排列问题，统一后台按钮为横向 flex：图标固定 14px、文字不换行、间距 7px、高度至少 36px。outline/danger 原来没有横向布局，浏览器默认 SVG 块布局导致图标独占一行。样式限定在 `.admin-main`，不影响编辑器工具栏。

用户管理移除用户行 760px 固定最小宽度，按用户信息、统计、操作按钮分组；小屏允许整颗按钮换行，恢复备份的 label 与普通按钮使用同一套样式，禁用状态保持一致。临时密码操作也统一按钮间距，注册用户标题图标横向对齐。资产页的重新扫描、清理、选择、排序、分页按钮均应用公共修复，保留原有 API 和确认流程。

新增 `tests/e2e/admin-buttons.spec.ts`。隔离测试创建临时用户和宽限期内的图片，实际访问两个管理页面，在 1440/768/390px 检查所有按钮的布局、图标与文字中心线、不换行及页面无横向溢出，并确认重新扫描仍可操作。没有执行密码重置、用户恢复或资产清理。截图生成在 `test-results/admin-buttons-admin-user-a-3828b-t-desktop-and-mobile-widths/`。

TypeScript、ESLint 和 Docker 内生产构建通过。首轮针对性浏览器测试通过，最终标题排版修正后的复验结果如下记录。正式环境及原有 3001 服务未更改，使用独立 3002/tmpfs 服务验证。

最终后台按钮浏览器复验通过（7.2 秒），两个页面共六张截图已更新。生产构建和 Docker Build 通过；临时 E2E 服务已清理，正式环境未部署。


## v 1.0.1024 — 2026-10-24

- 完成页面排序按钮式向下菜单、图标一致性检查和封面上传弹窗重构。
- 版本信息同步至软件包、锁文件、界面默认值、Compose 默认值及示例配置。
- 新建中文 CHANGELOG.md，后续版本更新按版本追加到顶部。
- 类型检查、ESLint、42 项单元测试、生产 Docker 构建及 v1024 Chromium 端到端测试通过。
- 详细修改与验证范围见 CHANGELOG.md。本次没有数据库迁移，没有部署或重启正式服务。


## v 1.0.1026 — 2026-10-26

- 版本配置更新至 1.0.1026，站点 Metadata 使用已有 favicon.ico。
- 清除搜索使用 Eraser，关闭使用 X；登录／注册复用 ThemeToggle。
- 编辑器顶部改为主题行＋面包屑及操作行；Toast 在 editor-scroll 顶部居中并随滚动保持可见，非编辑界面回退全局通知。
- 类型检查、ESLint、42 项单元测试、生产 Docker 构建及 2 项 Chromium 浏览器回归通过。
- 桌面、平板及手机尺寸验证通过。无数据库迁移，未部署正式服务。详细记录见 CHANGELOG.md。


## v 1.0.1026 — 全局 UI 字体系统

- 完成 Tailwind v4 字体审计：根因为全局 CSS 硬编码、重复组件覆盖及继承混用；原有 119 条字号声明中，UI 已统一到五个语义 token。
- 新增紧凑／标准／大号，账号与后台设置均可切换，数据库保存账号偏好；服务端恢复首屏，匿名界面读取 Cookie。
- 追加 0005_ui_typography.sql，不修改旧迁移；正文、文档标题和打印的独立字号保持不变。
- 类型检查、ESLint、Docker 生产构建、Node 20 隔离环境 47 项单元测试及 13 项浏览器回归全部通过。
- 生成 2 页字号隔离 PDF 和 31 页长表格 PDF，文字与末尾标记提取通过。原有测试的过时图片夹具、菜单顺序及 favicon 定位已修正。
- Safari／Firefox、真实移动设备和原生打印对话框未验证。未部署正式服务，真实数据未改动。
- 完整审计、文件职责、维护规则与例外见 docs/UI_TYPOGRAPHY.md。


## v 1.0.1026 — 图标透明问题修复

- 实测 localhost:3001 返回当前 ICO，但 ICO 目录标记256×256、内部PNG为512×512，Chromium缩至32px时可见像素为0；直接PNG正常。
- 保留原文件至 src/assets/branding/favicon-original.ico，逐字节提取原PNG至 src/app/icon.png；Metadata使用PNG，Next配置保留 /favicon.ico 的307兼容跳转。
- 新增16px和32px非透明像素及HTTP响应回归；更新现有图标测试。类型、ESLint、Docker构建和3项浏览器测试通过。
- 只操作一次性3002测试环境，3001与正式服务未重启，真实数据未改动。


## v 1.0.1026 — 偏好入口、登录稳定性与后台完善

- App 移除顶部主题行及空白编辑区主题控件，仅偏好设置可切换，登录界面继续使用主题控件。
- 登录固定预留两行错误区域，长消息可滚动和键盘访问；空白及活跃编辑器保持单行导航。
- 后台移动导航独立自动高度，主区域占剩余高度并铺满右侧；用户用量采用笔记本、页面、图片、存储四项统计卡片。
- 新增红色删除用户按钮、永久删除确认及管理员 DELETE 接口。只删除普通用户，事务级联删除关联记录和会话，图片隔离后提交／清除，失败恢复，保留审计；交叉引用或不安全路径阻止删除。
- 无引用、路径安全且扫描完整的缺失图片记录可单选或批量清理，实际释放空间计为0；仍引用、格式不明和危险路径保持保护，补充隔离文件处理入口。
- env 与 package 均保持1.0.1026。本次无新增迁移。
- 类型检查、ESLint、Docker生产构建、54项Node20单元测试和12项Chromium回归通过，含事务／文件回滚与审计失败回滚测试。
- 仅在3002/tmpfs及内存／临时目录验证，未删除真实用户数据、未重启3001或正式服务。


## v 1.0.1026 — 快捷键、退出与编辑界面完善

- 自动保存选项统一为“实时保存”，内部默认 10 秒间隔不变。
- 深色辅助文字和状态颜色改为统一语义配色，验证深色辅助文字在三种界面背景上对比度达到 4.5:1；保留用户正文颜色。
- 标题样式、字号调整、自定义字号后增加分隔，字号增减按钮移除边框；页面标题使用 Body，面板分隔与侧栏一致。
- 当前页搜索 Ctrl/Cmd+F、全局搜索 Ctrl/Cmd+Shift+F、链接 Ctrl/Cmd+K，精确区分修饰键并尊重输入法与弹窗。
- 用户和管理员共用退出流程：即时等待提示、保存确认、服务器撤销确认、完整跳转；不确定响应核验、失败重试、版本冲突保留草稿。未推断实际部署延迟根因。
- 系统设置三个分区统一 20px 间距，手机编辑器导航与操作分两行。
- 恢复缺失的 app/icon.png，内容直接取自保留的原始 ICO 内嵌 PNG。
- TypeScript、ESLint、生产 Docker 构建和 61 项 Node20 单元测试通过；22 项 Chromium 回归累计通过，前 17 项后进程被终止，剩余 5 项补跑通过。
- 测试仅使用一次性 3002/tmpfs；清理该环境，未重启或部署 3001 与正式服务。快捷键与退出约定见 docs/KEYBOARD_SHORTCUTS.md。


## v 1.0.1026 — 测试目录与侧栏滚动整理

- Vitest 测试分为 unit 与 integration，统一源码别名导入；Playwright 文件使用编辑工作区、笔记本封面排序、导航通知等业务名称，移除版本号和泛化 refinements 文件名。
- 同步规范、命令与文档引用，新增 tests/README.md，保留现有测试断言及夹具。
- 垃圾箱使用与工作空间、置顶一致的 Caption token（标准 12px）。
- 两个列表复用 ScrollArea，滚动结束 800ms 后隐藏滚动条，稳定预留滚动槽；仅隐藏内容所在边缘渐隐，动态内容与尺寸更新会重新计算，支持键盘与高对比模式。
- 本次未改动数据库结构、配置与真实服务。
- 本轮 TypeScript、ESLint、生产 Docker 构建、19 个文件的 61 项单元／集成测试及完整 23 项 Chromium 浏览器回归通过；测试后清理一次性 3002 容器及网络。


## v 1.0.1026 — 滚动条按操作意图显示

- 两个列表鼠标进入即显示滑块，停留、焦点位于列表或子按钮、按住操作期间保持可见；鼠标移出且没有其他交互后延迟 800ms 隐藏。再次进入不改变原滚动位置。
- 触摸按下立即显示，释放或取消后在空闲时隐藏；滚动过程继续续期。保留原生滚动、键盘操作、边缘渐隐及稳定滚动槽。
- 悬停显示参考 Radix Scroll Area 官方交互约定，并保留键盘焦点显示：https://www.radix-ui.com/primitives/docs/components/scroll-area 。
- 本轮类型检查、ESLint、生产 Docker 构建及两项针对性 Chromium 回归通过，覆盖鼠标离开／重入、位置保持、焦点持续显示、模拟触摸取消、边缘和宽度，以及既有快捷键与移动导航。真实触屏设备未验证。
- 验证仅使用一次性 3002/tmpfs，完成后清理；未部署或重启 3001 和正式服务。


## v 1.0.1110 — 原生 CNF、笔记本首页与封面裁剪

- 新增版本 1 的 CNF 原生容器：manifest.json、notebook.json 与去重的实际图片，正文保留原始 Tiptap JSON；转移排序、置顶、时间、垃圾箱页面及现存历史，导入全新 ID 和当前用户归属，始终新增默认文件夹内的笔记本。
- 校验格式／兼容版本、校验和、引用、图片类型、严格 ZIP 路径、加密／链接／重复条目与压缩／解压大小；实际接收的上传字节也受限制。未知编辑能力明确拒绝，不默默丢弃。事务失败回滚数据并删除本次文件。
- /app 为封面卡片首页，支持导入、既有新建、空状态和手机浅深色；品牌通过路由返回，先确认编辑保存。文档和空笔记本均可从 URL 刷新恢复。
- 现有新建表单与封面编辑共用 CoverCropDialog，固定 16/8.6、拖动、方向键、缩放、重置和预览；生成实际 1600×860 图片，取消不覆盖原封面，GIF 明示静态保存。
- 工作空间新建按钮放在置顶下方和工作空间标签上方；笔记本使用 NotebookPen，默认根位置与文件夹子项区分缩进；标题读取当前笔记本并随重命名更新。保留原笔记本菜单顺序。
- 正文扩展抽到 editor-extensions 供编辑器与导入验证复用；移除 Markdown 文件工具栏入口，保留 Markdown 编辑／粘贴和 PDF。20 列使用 TableMap 逻辑宽度，在命令与事务层同时限制；保留旧表格读取与删列。
- 包、锁文件根版本、默认显示、环境模板和 Compose 默认／隔离版本为1.0.1110。真实 .env / .env.test 仍为1.0.1026，遵守配置保护，发布时需显式设置 APP_VERSION=1.0.1110。没有新依赖或数据库迁移。
- 类型、ESLint、生产 Docker 构建通过，Node20 隔离环境71项单元／集成测试通过，完整26项Chromium回归通过；最后首页图标对齐后额外2项复验，双色图片像素与刷新持久化再单项通过。
- 检查桌面裁剪和手机深色截图；320／390px首页无横向溢出。未验证Safari、Firefox、真实触屏或断电恢复；现存依赖审计告警未自动升级。
- README、AGENTS.md、CHANGELOG.md、tests/README.md、docs/CNF_FORMAT.md 已更新。所有写测试使用3002/tmpfs、内存或临时目录；清理一次性服务，未部署或重启持久测试／正式服务。


## v 1.0.1110 — 图片记录与工作区面板完善

- 后台图片记录统一显示存储 UUID 前8位，悬停查看完整文件名；原始名字仅保留为元数据，未改磁盘文件或存量数据库。
- 默认文件夹与普通文件夹均有可见父项，子笔记本统一缩进；新建按钮增加16px顶部间距及42px高度。
- 侧栏文件夹、长置顶列表与页面列表共用ScrollArea，滚动条贴右缘；长置顶列表限制高度并独立滚动，保留文件夹与账号访问。
- 页面面板桌面宽度300～450px，拖动、方向键、Home/End及双击复位，150ms防抖保存浏览器本地宽度；移动端维持抽屉，不影响编辑器实例和编辑内容。
- 当前页搜索移至工具栏右上独立位置，支持格式按钮换行；保留快捷键及弹层焦点。brand-small复用 /icon.png 站点图标。
- README、AGENTS、CNF说明、CHANGELOG及测试说明同步更新；版本保持1.0.1110。
- 本轮类型检查、ESLint及Docker生产构建通过；完整27项Chromium回归通过。独立搜索布局后补充3项通过，长置顶列表及最终布局5项通过。
- 核对桌面拉宽截图，检查后台UUID名称清理、默认层级、边缘滚动条、宽度记忆、编辑保留和移动抽屉。仅使用3002/tmpfs，清理一次性服务，未部署或重启3001／正式服务。

## v 1.0.1112 — 编辑器空闲性能修复

- 稳定浮动工具栏的显示回调与定位选项，切断配置更新事务与页面渲染的循环。
- 正文、选区和输入格式变化继续同步工具栏；纯插件元数据不再触发无效 React 状态更新，上传书签映射保留。
- 扩展配置和初始正文按编辑器实例初始化，正常保存不重置正文或重建编辑器。
- 新增 `tests/e2e/editor-idle.spec.ts`，覆盖仅聚焦、元数据、选区／输入格式、字号、撤销重做、保存和切页后的静置行为。
- 包、锁文件根版本、环境模板、Compose 和应用／CNF 默认版本更新为 1.0.1112。未新增依赖、数据库迁移或变更保存协议；真实环境配置和正式服务未修改。
- 更新中文 CHANGELOG、README、AGENTS、编辑器性能说明和测试文档。
- 本轮实际验证通过：TypeScript、ESLint、隔离生产构建、71 项单元／集成、完整 28 项 Chromium 回归，以及单独的空闲专项。60 秒静置事务增量 0，节点和监听器不增长；未验证其他浏览器、真实设备或多小时运行。
