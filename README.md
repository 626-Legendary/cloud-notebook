# Cloud Notebook

面向个人学习与知识管理的自托管笔记应用。使用 SQLite 和本地附件目录保存数据，提供文件夹、笔记本、富文本页面、多用户隔离、历史快照、垃圾箱和管理员备份功能。

软件包版本以 [`package.json`](package.json) 为准（当前开发基线 `1.1.1119`）。界面右下角的显示版本可通过 `APP_VERSION` 配置。版本更新内容见 [版本更迭记录](CHANGELOG.md)。

1.1.1118 新增独立个人知识库、`@` 结构化引用、反向引用和手动检查／精确修复。词条复用现有富文本编辑器，详见 [知识库说明](docs/KNOWLEDGE_BASE.md)。已有编辑器空闲性能约束继续保留。

## 目录

- [主要功能](#主要功能)
- [技术栈与环境要求](#技术栈与环境要求)
- [选择运行环境](#选择运行环境)
- [本地开发](#本地开发)
- [Docker 部署与更新](#docker-部署与更新)
- [常规测试环境](#常规测试环境)
- [环境变量](#环境变量)
- [使用说明](#使用说明)
- [字体与导出](#字体与导出)
- [数据、备份与恢复](#数据备份与恢复)
- [检查与浏览器测试](#检查与浏览器测试)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [开发规范与文档导航](#开发规范与文档导航)

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 工作台 | /app 笔记本封面卡片首页；打开后为文件夹 → 笔记本 → 页面三栏布局，支持桌面与移动宽度 |
| 知识库 | 不归属笔记本的独立词条；`/app/library` 独立路由、名称与别名、全文搜索、宽屏／移动模态框、共享富文本编辑 |
| 知识关联 | 页面／词条通过 @ 引用词条；预览、反向来源、引用管理与精确修复 |
| 内容管理 | 文件夹、笔记本和页面管理；固定比例封面裁剪、缩放、更换与移除；跨文件夹移动笔记本 |
| 页面导航 | 页面排序、笔记本与页面置顶、取消置顶；刷新恢复正在编辑的页面 |
| 富文本 | H1/H2/H3、列表、引用、代码块、链接、表格、图片、对齐、颜色和多色高亮 |
| 字体与字号 | 19 种自托管字体、8–96px 字号、精确字号输入与 A−/A+ 快捷调整 |
| 搜索 | 当前正文查找、匹配高亮与前后导航；全局搜索文件夹、笔记本、标题和正文，包含中文表格内容 |
| 保存与恢复 | 定时自动保存、手动保存、本地未保存草稿恢复、乐观版本控制、历史快照预览与恢复 |
| 垃圾箱 | 工作台内嵌视图，保留 7 天，支持筛选、恢复、单项永久删除和清空 |
| 导入／导出 | CNF2 单页面、笔记本与完整知识库导出／新增导入；当前页面或整本笔记的浏览器打印 / PDF 导出 |
| 账号与设置 | 浅色、深色、跟随系统；保存频率；账号信息；登录设备查看与会话撤销 |
| 管理后台 | 用户／词条统计、修改用户名、临时密码重置、用户数据导出/恢复、系统备份与图片存储清理 |

## 技术栈与环境要求

- **应用**：Next.js 16 App Router、React 19、TypeScript。
- **编辑器**：Tiptap / ProseMirror，正文以 Tiptap JSON 保存。
- **存储**：SQLite、better-sqlite3、Drizzle ORM；附件保存在本地文件系统。
- **界面**：Tailwind CSS、Radix UI、Lucide 图标、next-themes。
- **测试**：Vitest、Playwright；Playwright 仅用于开发测试。

本地开发需要 Node.js **20.9+** 和 npm。Dockerfile 使用 Node.js 20；若本机需要编译 better-sqlite3，还需 Python、make 和 C/C++ 编译工具。容器部署需要 Docker Engine 和支持 `docker compose` 的 Compose 插件。

生产构建会通过 `next/font/google` 获取字体，因此构建机器需要能访问 Google 字体资源；应用运行后从自身提供字体文件，不依赖浏览器访问 Google Fonts。

## 选择运行环境

仓库包含三个 Compose 文件，用途和数据生命周期不同：

| 文件 | 用途 | 默认访问地址 | 数据位置与生命周期 |
| --- | --- | --- | --- |
| `docker-compose.yml` | 正式使用 | `http://localhost:3000` | 绑定宿主机 `./data`，更新容器后保留 |
| `docker-compose.test.yml` | 手动验收、常规测试 | `http://localhost:3001` | 独立命名卷 `cloud-notebook-test-data`，停止或重建容器后保留 |
| `docker-compose.e2e.yml` | 自动化浏览器测试 | `http://127.0.0.1:3002` | 独立 Compose 项目，数据位于容器 tmpfs，停止或重建后不保留 |

**E2E（End-to-End，端到端测试）**会启动真实浏览器，模拟选中文字、切换字体、搜索、上传封面、恢复内容等完整用户操作。

不指定 `-f` 时，Compose 默认读取正式配置。常规测试和 E2E 请使用对应文件。3001、3002 仅绑定宿主机回环地址；远程机器不能直接通过其自身的 `localhost` 访问这些服务。

## 本地开发

以下步骤适用于首次初始化；已有 `.env` 时直接检查和补充配置，不要覆盖。

```bash
cp -n .env.example .env
npm ci
```

编辑 `.env`，至少设置：

```dotenv
JWT_SECRET=替换为至少32个字符的随机密钥
ADMIN_INITIAL_PASSWORD=替换为至少12个字符的独立强密码
APP_URL=http://localhost:3000
APP_VERSION=1.1.1119
```

启动开发服务：

```bash
npm run db:migrate
npm run dev
```

访问 <http://localhost:3000>。应用启动时也会自动执行已有数据库迁移；显式迁移命令适合提前检查迁移是否成功。

普通用户进入 `/app`，管理员进入 `/admin`。首次启动会根据环境变量创建管理员，首次登录后必须设置新密码。普通账号注册是否开放，由初始化配置和管理员后台设置决定。

本地生产模式可使用：

```bash
npm run build
npm run start
```

本地运行默认使用 `./data/cloud-notebook.db`。不要让开发服务与正式服务共享正在使用的数据库；需要隔离验证时，优先使用下方测试 Compose 配置。

## Docker 部署与更新

### 首次启动

准备 `.env` 并替换示例密钥和密码后，启动应用服务：

```bash
docker compose up -d --build cloud-notebook
docker compose logs -f cloud-notebook
```

访问 <http://localhost:3000>。正式配置将 `3000` 端口发布到宿主机，数据映射到 `./data`，容器内路径为 `/app/data`。

正式 Compose 还包含 Cloudflare Tunnel 的 `tunnel` 服务。上面的命令仅启动笔记应用；需要 Tunnel 时，在本地 `.env` 设置 `CLOUDFLARE_TUNNEL_TOKEN`，再运行 `docker compose --env-file .env up -d tunnel`。该变量留空时仍可单独启动笔记应用，但隧道服务需要有效 Token。Token 仅保存在未纳入 Git 的 `.env`，不要写入 Compose、示例配置或提交记录。修改 Token 后需重新创建隧道容器才能生效。

### 更新与停止

更新前先通过管理后台创建并下载备份，再更新代码并重建应用：

```bash
docker compose up -d --build cloud-notebook
docker compose logs --tail=100 cloud-notebook
```

只停止应用、不删除容器：

```bash
docker compose stop cloud-notebook
```

停止并移除此 Compose 项目的容器及网络：

```bash
docker compose down
```

保持相同的 `./data` 绑定路径即可保留账号、笔记、附件与快照。应用启动会执行迁移，不要在同一数据库上同时启动多个应用实例。更新或回滚涉及数据库结构时，应同时核对备份与版本兼容性。

## 常规测试环境

常规测试使用独立的 3001 端口和持久化测试卷，适合长期保留验收账号与笔记。

首次准备配置：

```bash
cp -n .env.test.example .env.test
```

将 `.env.test` 中的 `JWT_SECRET` 和 `ADMIN_INITIAL_PASSWORD` 替换为独立的测试值。示例管理员名为 `admin-test`，默认关闭普通用户注册；需要测试注册时，可由管理员在后台开启。

```bash
# 仅构建测试镜像
docker compose --env-file .env.test -p cloud-notebook-test -f docker-compose.test.yml build

# 构建并启动，等待健康检查通过
docker compose --env-file .env.test -p cloud-notebook-test -f docker-compose.test.yml up -d --build --wait

# 查看日志
docker compose --env-file .env.test -p cloud-notebook-test -f docker-compose.test.yml logs -f cloud-notebook-test

# 停止并移除容器，保留测试卷
docker compose --env-file .env.test -p cloud-notebook-test -f docker-compose.test.yml down
```

访问 <http://localhost:3001>。登录页显示“测试版”，工作台和管理界面不显示环境徽标。重新执行 `up -d` 可启动已构建的服务；`build` 本身不启动服务。

`--env-file .env.test` 用于 Compose 变量替换，服务还会通过配置中的 `env_file` 读取测试环境变量。这样 `APP_VERSION` 等值不会意外从正式 `.env` 取值。

`down` 不删除命名卷。只有确定要清空全部测试账号、笔记和图片时，才在上述 **测试项目命令**后使用 `down -v`；这会永久删除 `cloud-notebook-test-data`。不要将该操作用于正式数据。

## 环境变量

下表为应用读取的配置；Docker 实际收到的值以对应服务的 `environment` / `env_file` 为准。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 签名密钥，至少 32 字符；更换后旧登录凭证将失效 | 必填 |
| `DATABASE_URL` | SQLite 文件路径，支持相对路径、绝对路径或 `file:` 前缀 | `./data/cloud-notebook.db` |
| `APP_URL` | 写请求 Origin 校验额外允许的公开地址，多个地址用逗号分隔；也接受请求实际到达的地址 | 示例为 `http://localhost:3000` |
| `APP_VERSION` | Editor Panel 右下角显示的版本号 | `1.1.1119` |
| `CLOUD_NOTEBOOK_ENV` | 设为 `test` 时，登录页显示“测试版” | Compose 分别指定 `production` / `test` |
| `ALLOW_REGISTRATION` | 尚无数据库设置时的注册开关初始值，之后以管理员设置为准 | `true` |
| `MAX_UPLOAD_SIZE_MB` | 单张图片上传上限，单位 MB | `10` |
| `ASSET_CLEANUP_GRACE_HOURS` | 图片成为安全清理候选前的宽限期，范围 1–8760 小时 | `48` |
| `ADMIN_USERNAME` | 初始管理员用户名 | `admin` |
| `ADMIN_INITIAL_PASSWORD` | 首次创建管理员时读取，至少 12 字符 | 首次生产启动必填 |
| `BACKUP_ENABLED` | 是否启用后台定期自动备份 | `true` |
| `BACKUP_RETENTION_DAILY` | 近期按天保留的备份上限 | `7` |
| `BACKUP_RETENTION_WEEKLY` | 较早按周保留的备份上限 | `4` |
| `BACKUP_DIRECTORY` | 系统备份目录 | `./data/backups` |

修改 `.env` 不会改变已运行进程的环境。Docker 配置变更后需重新创建容器；仅执行 `docker compose restart` 不会重新注入修改后的环境变量。版本号属于运行时配置，无需仅为 `APP_VERSION` 重新构建镜像。

当前正式 Compose 显式映射部分变量，常规测试则同时使用 `env_file`。例如 `ASSET_CLEANUP_GRACE_HOURS` 尚未在正式服务中显式透传；若需覆盖，应在对应服务环境中提供，仅写入宿主机 `.env` 并不会自动传入所有变量。`DATABASE_URL` 等容器路径由 Compose 固定配置覆盖。

管理员账号存在后，`ADMIN_INITIAL_PASSWORD` 不会重置其密码；但当前正式 Compose 仍要求该变量非空，保留配置即可。登录 Cookie 会依据 HTTPS 或 `X-Forwarded-Proto: https` 设置 `Secure`；配置反向代理时，应正确传递实际协议，并将公开访问地址加入 `APP_URL`。

## 使用说明

### 导航、封面与搜索

- 按“文件夹 → 笔记本 → 页面”组织内容；页面可手动排序，或按更新时间、创建时间、标题排序。
- 笔记本“重命名”和“编辑封面”分开；封面对话框支持上传、更换和移除封面。封面共用 `CoverCropDialog`，固定比例 `16 / 8.6`，支持拖动、方向键和 1～4 倍缩放；确认裁剪生成 1600×860 WebP（不支持时为 PNG），点击保存或创建后才上传。取消不替换原封面，GIF 提示转为静态；裁剪前最多 10 MiB、4000 万像素且单边不超过 20,000px。
- 置顶笔记本和页面可从侧栏快速打开，条目菜单提供“取消置顶”。
- 页面 ID 写入 `/app?page=…`，刷新后会检查访问权限并恢复页面；无效或不可访问的页面回到工作台。
- 首次恢复显示简洁的同步加载动画；面包屑超过 60 个字符显示 `...`，悬停可查看完整标题。
- Pages Panel 不再提供独立搜索框；正文搜索位于工具栏，全局搜索位于顶部操作区。
- 正文搜索支持按钮开关、Escape 关闭、清空关键词、Enter 下一项、Shift+Enter 上一项；高亮为临时标记，不写入笔记。

### 编辑、保存与版本冲突

主工具栏提供精确字号，选区 BubbleMenu 提供 A−/A+。H1/H2/H3 有独立字号和字重层级，手动设置的字号优先。深色模式降低高亮背景强度，原始颜色仍保留在保存数据和打印输出中。表格列上限由 `TableMap` 逻辑宽度计算为 20，按钮、命令与事务层同时限制；已有超限表格仍可读取和删列，不允许继续扩大。

“账号与设置”的默认文案固定为“实时保存”，不附带时间标记；内部 `realtime` 配置对应以下间隔：

| 选项 | 保存间隔 |
| --- | --- |
| 实时保存（默认） | 10 秒 |
| 每 1 分钟 | 60 秒 |
| 每 5 分钟 | 300 秒 |
| 每 10 分钟 | 600 秒 |
| 关闭 | 使用手动保存 |

可使用 `Ctrl/Cmd+S` 手动保存。连续输入不会无限延后定时保存，同一页面的请求串行处理；切回页面会等待本标签页之前的保存完成。重命名、恢复快照和导出前会先保存当前编辑。

未保存内容会在浏览器本地保留草稿，重新打开时按版本条件提示恢复。草稿不是备份：清除浏览器数据或更换设备后不能依赖它恢复内容。

真实的多标签页或多设备同时编辑仍可能触发版本冲突。提示出现后，可加载服务器版本，或确认以本地内容覆盖；覆盖前保留服务器版本快照。不要把反复刷新当作解决冲突的方法，应先确认要保留哪一份内容。

### 快照、垃圾箱与登录设备

历史快照支持预览、恢复、删除和清空，超过 24 小时的记录由后台定期清理。快照不是每次键入的完整历史，也不能替代长期备份。

删除页面或笔记本后进入垃圾箱，通常可在 7 天保留期内恢复。垃圾箱位于主工作区，支持搜索、类型筛选、恢复和永久删除；超过保留期的内容由后台定期清理。

界面字号可选择紧凑、标准、大号，保存到账号并在刷新时恢复；管理员入口为“系统设置 → 界面显示”。只改变界面，不改变正文和 PDF。实现边界见 [字体规范](docs/UI_TYPOGRAPHY.md)。

账号与设置使用分组菜单展示外观、保存频率和账号信息。“登录设备”打开独立对话框，支持退出某个设备或退出其他设备；当前设备使用绿色文字标示。

### 工作区布局与图片记录

- 页面列表面板在桌面端可拖动右侧边界，从默认／最小 300px 拉宽至 450px；支持左右方向键（10px）、Shift＋方向键（25px）、Home／End、双击恢复默认。宽度保存在当前浏览器，刷新后恢复；移动端继续使用原有抽屉宽度。
- 默认文件夹与普通文件夹都显示为父级，其下笔记本统一缩进；新建按钮与上方分隔保留间距。
- 侧栏、长置顶列表与页面列表共用滚动条样式，滚动条贴右缘，内容保留内边距，继续支持操作时显示和空闲隐藏。
- 当前页搜索位于撤销／重做旁，快捷键与作用域见 [快捷键规范](docs/KEYBOARD_SHORTCUTS.md)；左上品牌使用现有站点图标。
- 管理后台“图片记录”统一显示存储 UUID 的前 8 位，悬停查看完整存储文件名；原始文件名元数据仍保留用于备份兼容，磁盘文件继续使用完整 UUID。

## 字体与导出

### 自托管字体

中文 8 种：思源黑体、思源宋体、站酷小薇体、站酷庆科黄油体、马善政毛笔字体、粉圆体、织芒行书、龙苍草书／行草。

英文 11 种：Inter、Roboto、Open Sans、Merriweather、IBM Plex Mono、Montserrat、Poppins、Plus Jakarta Sans、Lora、Cinzel、Caveat。

Google 字体通过 `next/font/google` 在构建时获取，粉圆体使用 `next/font/local` 加载官方字体的 WOFF2 版本。均采用 `display: swap`、关闭主动 preload，通过稳定 CSS 变量关联 Tiptap JSON；浏览器按实际字体与字形需求加载资源。旧字体值在渲染时兼容，不改写原笔记和快照。

字体配置见 [src/app/fonts.ts](src/app/fonts.ts) 与 [src/lib/editor-formatting.ts](src/lib/editor-formatting.ts)。粉圆体来源及授权见 [justfont 官方项目](https://github.com/justfont/open-huninn-font)和[随项目分发的 OFL 文件](public/font-licenses/OFL-huninn.txt)。界面中的织芒行书、龙苍分别对应 Zhi Mang Xing、Long Cang。

### 知识库与引用

从侧栏“知识库”（`/app/library`）创建独立词条，新建后直接编辑，保存后可继续书写；空词条显示“暂无内容”。在正文手动输入 `@` 搜索正式名称／别名，明确确认后插入或创建。点击引用可预览和阅读完整内容，词条间在同一模态框导航。“账号与设置 → 数据管理 → 引用管理”可手动检查并修复所选引用。未引用词条不会被自动删除。操作、权限与迁移边界见 [知识库说明](docs/KNOWLEDGE_BASE.md)。

### CNF、Markdown 编辑与 PDF

从 /app 首页或知识库导入 .cnf，在笔记本菜单、页面导出框或知识库分别导出。CNF2 保留正文 JSON、封面、本地图片和结构化引用；页面／笔记本只打包直接引用的词条，独立知识库导出包含全部词条。名称冲突时列出冲突项，可取消、复用已有词条或保留双方并重命名，不覆盖已有正文。当前仅接收格式版本 2；项目尚未正式上线，不要求兼容未发布的旧 `.cnf`，也不为改名重构现有格式。文件结构、版本、资源校验与边界见 [CNF 格式说明](docs/CNF_FORMAT.md)。

保留 Markdown 快捷输入、粘贴和中文表格识别，工具栏已移除 Markdown 文件导入／导出；不提供 Markdown 源码编辑模式。已有 Inline Code 标记继续兼容，新建入口已移除，代码块保留。

Markdown 无法完整表示字体、字号、颜色、高亮等富文本样式。需要可恢复的完整原始笔记时使用 CNF，需要阅读与打印时使用 PDF 导出。

通过顶部“导出”选择“当前页面”或“当前笔记本”，打开打印预览后点击“打印 / 保存为 PDF”。打印使用固定浅色纸张，保留表格、文本格式和图片排版，长表格允许跨页；标题与正文分开存储，不会为导出修改正文 JSON。

生产 PDF 流程使用用户浏览器原生打印，不需要服务器 Chromium 或 Playwright。Playwright 只用于浏览器回归测试。

## 数据、备份与恢复

### 数据目录

默认目录结构如下；正式 Docker 环境对应容器内 `/app/data`：

```text
data/
├── cloud-notebook.db
├── cloud-notebook.db-wal
├── cloud-notebook.db-shm
├── uploads/
│   └── notes/
└── backups/
```

SQLite 使用 WAL 与外键约束。`-wal`、`-shm` 是运行期文件，不应在服务运行时手动删除。调整 `DATABASE_URL` 只改变数据库位置，附件目录仍基于应用工作目录下的 `data/uploads/notes`，不会随数据库路径自动迁移。

### 系统备份与用户恢复

管理后台支持系统备份创建、下载和删除。备份通过 SQLite 在线备份 API 制作数据库副本，再将附件打包为 ZIP；文件完成后原子重命名，并记录 SHA-256 校验值。

系统 ZIP 包含数据库、`uploads/` 与 `manifest.json`，不包含 `.env`、源码或部署配置。请另行安全保管配置，并将下载的备份复制到其他设备；同一磁盘上的备份不能防止整盘故障。

用户管理支持用户数据 ZIP 导出和恢复。用户恢复会追加为目标用户的新内容，不覆盖其现有笔记；它与完整系统数据库替换是两种操作。用户备份上传上限为 100 MB。新版用户 ZIP 格式 2 同时包含知识库、别名和引用；管理员恢复遇到名称冲突时显示清单，可复用已有词条或保留双方并重命名。标签功能已移除，文件中的标签字段仅作为兼容壳保留，新导出为空。原用户 ZIP 格式 1 仍可恢复。用户 ZIP 同时保留页面／笔记本的删除和置顶状态，以及已删除词条；内容恢复不会覆盖目标账号的密码、登录会话和偏好，完整实例设置使用系统备份。

### 完整系统恢复（维护模式）

1. 下载系统备份，并核对管理员后台记录的 SHA-256 校验值。
2. 停止目标应用，例如 `docker compose stop cloud-notebook`，确认没有其他进程写入该数据库。
3. 在临时目录解压，检查 `manifest.json`、`cloud-notebook.db` 和 `uploads/`。可运行 `sqlite3 cloud-notebook.db 'PRAGMA integrity_check;'`，结果应为 `ok`。
4. 完整保留现有数据目录作为回滚副本，再把备份中的数据库与附件还原到干净的数据目录；不要将旧数据库的 `-wal` / `-shm` 文件混入还原后的数据库。需要保留已有备份文件时，另行保留 `backups/`。
5. 核对目录所有权和权限，确保容器内 UID/GID `1000:1000` 可读写；核对 `.env`，包括原来的 JWT 密钥及目标数据库路径。
6. 使用 `docker compose up -d cloud-notebook` 启动，检查日志、账号、笔记、封面和图片。验证失败时停止应用，使用事前保留的完整副本回滚。

不要在应用写入期间只复制数据库主文件，也不要通过覆盖正在使用的 SQLite 文件执行恢复。优先使用管理后台生成的在线备份。

### 管理员密码重置

在安装了依赖的源码目录中，确认 `DATABASE_URL`、`ADMIN_USERNAME` 和环境配置指向目标实例，再运行：

```bash
npm run admin:reset-password
```

脚本默认生成一次性随机临时密码，也支持通过 `NEW_ADMIN_PASSWORD` 指定 12–128 字符的新临时密码；执行后原有会话失效，下次登录必须修改密码。临时密码只在命令输出中展示，请安全保存。

此命令是源码目录的维护脚本；生产 standalone 运行镜像不包含完整开发工具链，不应假定它能直接运行所有 npm 维护脚本。

## 检查与浏览器测试

验证命令、一次性 3002 环境、浏览器准备、专项选择和失败清理由 [tests/README.md](tests/README.md) 统一维护。自动化写入不能指向正式数据或 3001 持久化验收卷；启动、构建及迁移可能写库，应使用隔离配置。

当前功能以源码和专项规范为准，[CHANGELOG](CHANGELOG.md) 记录版本变化，`PROGRESS.md` 是历史执行记录。历史测试结果不代表本次已重新验证。

## 项目结构

```text
src/
├── app/                  # App Router 页面、API、打印页与全局样式
│   ├── admin/            # 用户、存储清理、备份与设置
│   ├── app/              # 笔记本卡片首页、编辑工作台与加载页
│   └── print/            # 单页与整本打印预览
├── components/           # 编辑器、工作台、账号及基础 UI
├── db/                   # 数据库连接、schema 与迁移入口
├── lib/                  # 保存协调、知识库／引用、导入冲突处理、共享正文 Schema、CNF、搜索、备份与资产引用
└── assets/fonts/         # 本地字体资源
drizzle/                  # 版本化 SQL 迁移
public/font-licenses/     # 随字体分发的授权文件
scripts/                  # 管理员维护脚本
tests/                    # unit / integration / e2e / fixtures，详见 tests/README.md
```

数据库 schema 见 [src/db/schema.ts](src/db/schema.ts)，已有迁移保存在 [drizzle/](drizzle/)。修改数据库结构时，应同时审阅 schema 与迁移 SQL；不要直接修改正式数据库来替代版本化迁移。

## 常见问题

**启动提示管理员密码或 JWT 配置无效**  
检查当前实例实际接收的环境变量。JWT 密钥至少 32 字符；首次创建管理员需要至少 12 字符的密码。更改初始化密码不会重置已有账号。

**测试环境无法注册**  
`.env.test.example` 默认关闭注册，管理员名为 `admin-test`。登录管理员后台开启注册后再创建测试用户；已有数据库的注册开关以后台设置为准。

**修改版本号后页面没有变化**  
检查 `APP_VERSION` 是否已传入应用容器。Compose 环境变量变更需要重新创建容器；常规测试命令应带上 `--env-file .env.test`。刷新工作台后查看右下角版本号。

**构建时字体下载失败**  
检查构建环境能否访问 Google 字体资源。字体在构建阶段获取，运行时无需 Google Fonts CDN；仅调整运行容器网络不能补齐失败的构建资源。

**容器无法写入数据目录**  
检查挂载路径及 UID/GID `1000:1000` 的读写权限。不要通过删除数据库或测试卷解决权限问题。

**图片无法访问或成为清理候选**  
确认登录状态、数据库资产记录及附件文件是否匹配。存储清理会保护当前笔记、快照、封面和垃圾箱中的引用；宽限期内、不确定或未登记文件不会自动删除。

**频繁提示版本冲突**  
先确认是否有其他标签页或设备在编辑，再通过冲突提示选择保留版本。客户端已协调同页保存请求；若仍可复现，请在独立环境记录操作步骤和请求响应，不要直接覆盖生产数据库或关闭版本检查。

**浏览器访问不到 3001 / 3002**  
先确认健康检查和日志，再检查浏览器是否运行在同一主机。测试端口只绑定回环地址；远程浏览器需要可达的测试网络地址，不能把远端 `localhost` 当作应用地址。


## 开发规范与文档导航

开发从 [AGENTS.md](AGENTS.md) 开始，按任务读取专项：

| 文档 | 职责 |
| --- | --- |
| [UI/UX 主规范](docs/UI_DESIGN_SYSTEM.md) | 品牌、语义颜色、组件、布局、交互与响应式 |
| [字体专项](docs/UI_TYPOGRAPHY.md) | UI 字号、偏好、字体与正文／打印边界 |
| [知识库规范](docs/KNOWLEDGE_BASE.md) | 词条、引用、反向来源与精确修复 |
| [CNF 格式](docs/CNF_FORMAT.md) | `.cnf` 结构、校验、冲突与开发阶段演进 |
| [快捷键与退出](docs/KEYBOARD_SHORTCUTS.md) | 修饰键、作用域及会话退出流程 |
| [测试说明](tests/README.md) | 验证命令、隔离环境和测试选择 |
| [版本记录](CHANGELOG.md) | 版本变化与当时验证摘要 |

[空闲性能审计](docs/MEMORY_AUDIT.md) 和 [上传前检查](docs/REPOSITORY_PUBLISHING.md) 分别保留性能根因、提交前检查方法；其中标注日期的历史结果不是当前状态保证。被 Git 忽略的 `Command.md` 是本地运维便笺，不作为共享规范维护。
