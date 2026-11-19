# Cloud Notebook File（CNF）

`.cnf` 是用户可见的原生导入导出扩展名，用于转移单页面、笔记本或完整知识库，保留可编辑正文及实际图片；不是 PDF 或整站数据库备份。当前实现为 ZIP 容器，`formatVersion=2`、`compatibility.schemaVersion=2`，下文简称 CNF2。

## 开发阶段演进原则

- 项目尚未正式上线，没有需要维护的历史用户 `.cnf` 文件；不要求兼容未发布的旧格式，不增加旧格式转换器或预设版本迁移框架。
- 现有格式已具备范围识别、完整正文、图片校验、冲突处理及事务回滚；不为内部版本改名而重构。保留 `.cnf` 扩展名与必要的文件版本识别。
- 确有简化需要时允许调整内部结构，必须同步导出、解析、导入、回归及本文；仍须明确拒绝不支持的版本和内容，不能静默丢弃数据。
- 本文记录当前实现，不把遗留占位字段或参数别名提升为永久兼容义务。仅整理文档时不顺带修改这些实现。
- 管理员用户 ZIP、系统数据库备份及恢复是独立契约，本规则不授权变更它们；说明见 [README](../README.md#数据备份与恢复)。

## 使用

- 左侧笔记本操作菜单选择“导出笔记本 (.cnf)”，下载以标题命名的文件。当前编辑先通过现有保存队列确认保存；冲突或附件缺失会阻止导出并明确提示。
- 返回 `/app`，点击“导入笔记本 (.cnf)”并选择文件。成功后新笔记本出现在首页，可正常打开编辑，再次导出。
- 页面编辑器“导出”先选择当前页面／当前笔记本，再下载原生 CNF；知识库入口支持全库导出和导入。离开或导出前等待当前编辑保存。
- 页面／笔记本导入始终新增笔记本并放入当前用户默认文件夹，不覆盖同名内容；笔记本、页面、资源、历史与新词条使用新 ID，页面／词条版本从 1 开始。完整知识库导入不会创建空笔记本。
- 名称或别名冲突默认返回 409，响应提供冲突清单，用户可明确选择 conflictPolicy=reuse 复用目标词条或 conflictPolicy=rename 保留双方并重命名。当前 HTTP 入口仍接受 `reuseExisting=true`，内部函数也接受旧布尔参数；它们是参数别名，不是旧格式读取器，也不是要求永久保留的兼容层。一个导入词条匹配多个已有目标时不可复用，但可以重命名；所有选择都不覆盖已有正文。

## 文件结构

```text
笔记本标题.cnf                    # ZIP 容器
├── manifest.json
├── notebook.json
├── knowledge.json
└── assets/
    └── <portable-id>.<png|jpg|webp|gif>
```

`manifest.json` 包含：

| 字段 | 含义 |
| --- | --- |
| format | 固定 cloud-notebook-file |
| formatVersion / scope | 容器版本 2；notebook、page 或 knowledge |
| applicationVersion | 导出端 APP_VERSION，未配置时为当前代码默认版本 |
| exportedAt | ISO 8601 导出时间 |
| notebookId | 源笔记本的便携标识，仅用于文件内部关联 |
| compatibility | editor=tiptap-json、schemaVersion=2、assets=relative-v1 |
| notebookSha256 / knowledgeSha256 | 两个 JSON 文件原始字节的 SHA-256 |
| pageCount / snapshotCount | 页面及历史版本数量 |
| assets | 每个资源的标识、相对路径、MIME、名称、字节数、创建时间与 SHA-256 |

`notebook.json` 保存标题、封面资源引用、排序、置顶与创建／更新时间，以及 pages 和 snapshots。页面包含完整的 Tiptap JSON 对象、标题、顺序、源并发版本、置顶、时间与软删除信息。正文不转换成 HTML 或 Markdown，也不通过编辑器重新序列化；保留字体、字号、颜色、高亮、列表、标题、对齐、链接、代码、表格和所有已支持的图片属性。

笔记本导出包含全部页面（含垃圾箱页面）和当时仍保留的历史版本；页面导出仅包含所选页面及其历史。knowledge.json 保存打包词条的名称、别名、完整正文和时间。当前 Schema 仍要求 `tags`、`pageTags`、`tagIds` 字段，新导出均为空数组；解析器会校验这些字段，但导入不写入标签。它们是移除标签后尚存的文件结构占位，不代表标签功能或历史兼容需求。若专项简化，按上文同步调整导入导出及测试，不影响管理员 ZIP。页面／笔记本只打包这些正文和快照直接引用的有效词条及其实际图片，不递归展开词条之间的引用。缺失或未打包目标保留原节点 ID／文字，导入后显示失效，供手动修复。

完整知识库导出包含全部有效词条，包括未被引用的词条及图片；notebook.json 此时仅为空 pages/snapshots 的容器元数据，导入不会写入真实笔记本。双向／循环引用使用结构化节点 ID 映射，不递归复制正文。导入为每个新词条分配 ID，再同步重写页面、快照和词条中的 entryId；普通文字和无关 ID 不替换。

文件不包含其他账号内容。导入后垃圾箱及历史版本继续遵循现有 7 天／24 小时清理策略；旧时间戳不会延长保留期。父文件夹归属和用户身份属于目标环境，默认文件夹位置不是原文件夹的镜像恢复；管理员整账号 ZIP 恢复仍独立保留。

## 资源与兼容性

- 当前应用附件模型支持 JPG、PNG、WebP、GIF 图片，没有独立的任意文件附件节点。封面、正文和历史版本共享的同一资源只存一份。
- 导出将本地图片属性中的 `/uploads/notes/<id>` 转为 `assets/<id>.<extension>`。导入为当前账号创建资源记录及实际文件，再将 JSON 引用转换为新 URL。图片尺寸、对齐、displayWidth 等属性保持原值。
- 仅打包所选页面、笔记本、保留快照和打包词条实际使用的资源。缺失、无权限、不安全路径、资源标识和图片路径矛盾会明确失败，不输出缺图备份。
- 外部 URL 图片、data URL 图片不自动抓取；请先上传为本地图片再导出。导入拒绝依赖外部地址的图片，保证文件自包含。
- 字体以现有 CSS 变量／字体名保存，不重复打包字体二进制；目标安装应支持相同字体集合，否则依照现有字体回退显示。
- 原始 JSON 不裁剪未知字段。导出可携带原始节点或属性；导入使用与编辑器相同的扩展 Schema 检查。不认识的节点、标记、属性或额外元字段会明确拒绝整个导入，避免打开编辑后被编辑器悄悄丢弃。后续扩展应同步共享 Schema 或提升兼容版本。
- 不导出密码、JWT、会话、密钥、用户 ID／用户名、当前导出范围以外的笔记本或管理员审计。

## 校验与失败处理

当前边界：压缩文件最多 100 MiB、解压内容合计 200 MiB、单图 10 MiB、页面 10,000、历史版本 50,000、资源 20,000、词条与标签各 10,000、文件条目 20,003；单篇正文序列化后最多 2,000,000 字节，嵌套最多 100 层并限制遍历数量。表格 rowspan／colspan 必须为 1～1000 的整数并校验列宽，防止异常网格尺寸；当前编辑器可导入的文本结构另受 Schema 限制。

导入检查扩展名、ZIP 实际结构、格式及兼容版本、数据类型、数量、SHA-256、图片签名、引用完整性与唯一性。拒绝路径穿越、绝对路径、重复条目、加密文件、符号链接和未声明文件；不向上传目录解压用户提供的路径。文件名、路径及数据库 ID 由服务器生成。

所有文件解析与正文兼容校验发生在写入前。复制资源后，在单个 SQLite 事务中创建全部关联数据；普通文件写入／数据库错误会回滚数据并删除本次创建的文件。跨文件系统和 SQLite 无法提供断电级原子提交；进程被强制中止后留下的未引用资源可按现有存储清理规则处理，不能把异常回滚测试等同于断电恢复保障。

`GET /api/notebooks/[id]/cnf` 验证当前用户和笔记本归属，返回私有、不缓存的下载响应。`POST /api/notebooks/import` 接收 multipart 的 file 字段，保留来源检查和当前认证约定；新增 `GET /api/pages/[id]/cnf` 和 `GET /api/knowledge/cnf`。成功保留 201 `{ notebook: { id, title, pages, assets, kind, entries, reusedEntries, renamedEntries } }` 包装（知识库 scope 的 id 为空字符串），名称冲突返回 409，校验失败返回 400，文件超限返回 413，未登录／无权操作保留 401／403／404 语义。

## 相关边界

封面裁剪、Markdown 编辑和表格上限属于 [README 的使用说明](../README.md#使用说明)，视觉与交互遵循 [UI 主规范](UI_DESIGN_SYSTEM.md)。CNF 只消费现有封面资源与共享正文 Schema，不另建编辑器或裁剪规则。

## 维护与测试

- src/lib/cnf-format.ts：版本化契约、ZIP、校验和、正文与引用校验。
- src/lib/cnf.ts：归属检查、数据快照、资源复制、ID 映射、事务和回滚。
- src/lib/editor-extensions.ts：客户端和 CNF 共用的正文 Schema。
- src/lib/table-limit.ts：列数命令和事务约束。
- tests/integration/cnf-round-trip.test.ts：完整往返、跨账号、异常回滚和损坏文件。
- tests/integration/user-knowledge-backup.test.ts：独立用户 ZIP2 的词条、引用、资源、遗留字段忽略及冲突回滚。
- tests/integration/knowledge-migration.test.ts：旧 Schema 升级保留原页面 JSON、时间和版本，重复迁移与外键校验。
- tests/e2e/knowledge-workspace.spec.ts：知识库交互、权限、CNF2 范围与显式复用。
- tests/e2e/native-notebook-transfer.spec.ts：真实下载、导入、编辑、再次导出及 HTTP 权限／来源检查。
- tests/e2e/notebook-home-crop.spec.ts：首页、裁剪、取消、刷新、导航和侧栏。
- tests/e2e/table-columns.spec.ts：19／20 列、合并单元格、直接命令和事务。

验证命令与隔离边界见 [tests/README.md](../tests/README.md)，全局安全约束见 [AGENTS.md](../AGENTS.md)。表格扩展沿用 [Tiptap 扩展接口](https://tiptap.dev/docs/editor/extensions/custom-extensions/extend-existing)及 [ProseMirror 事务过滤接口](https://prosemirror.net/docs/ref/#state.PluginSpec.filterTransaction)。
