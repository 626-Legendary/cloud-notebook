# 界面字体与排版边界

这是 [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md) 的字体专项，不定义第二套主题、组件或布局规范。

## 1. 唯一字号来源

[`src/app/typography.css`](../src/app/typography.css) 是 UI 字号数值的唯一来源，定义紧凑、标准（默认）、大号三档，并通过 Tailwind v4 `@theme inline` 暴露语义类。文档不复制像素表；调整数值必须修改该文件并验证层级。

| 角色 | Tailwind 类 | CSS 变量 |
| --- | --- | --- |
| 辅助说明／时间 | `text-ui-caption` | `--ui-caption` |
| 菜单／按钮／状态文字 | `text-ui-secondary` | `--ui-secondary` |
| 主要信息／导航 | `text-ui-body` | `--ui-body` |
| 面板／分区标题 | `text-ui-heading` | `--ui-heading` |
| 页面标题／重要统计 | `text-ui-title` | `--ui-title` |

- 新界面使用语义类，已有组件 CSS 可引用同一变量；不能新增硬编码 UI 字号或覆盖 `text-sm` 等通用类含义。
- 紧凑档不继续压低辅助文字；字号相同时通过颜色、字重和空间区分。普通控件不滥用粗体。
- 知识库名称用 body，摘要／按钮／联想主文字用 secondary，别名／时间／提示用 caption；词条正文不使用 UI token。
- Lucide `size`、`width`、`height` 属于图标几何尺寸，不是文字字号。

## 2. 偏好与持久化

- 普通用户在“账号与设置 → 界面字号”选择三档；管理员入口为“系统设置 → 界面显示”。
- 枚举及校验由 [`src/lib/ui-typography.ts`](../src/lib/ui-typography.ts) 维护，账号偏好存于 `user_settings.ui_font_size`，对应迁移 `0005_ui_typography.sql`。
- `PATCH /api/settings/typography` 只允许修改本人偏好，保留会话、强制改密、来源和枚举校验。
- [`ui-typography-provider.tsx`](../src/components/ui-typography-provider.tsx) 在成功后统一更改 HTML 的 `data-ui-font-size`，失败保留当前值，保存期间防重复请求。
- RootLayout 根据账号偏好输出首屏属性；匿名界面使用经过枚举校验的 `cloud-notebook-ui-font-size` Cookie，账号偏好优先，新账号默认标准档。该 Cookie 不包含认证信息。
- 切换 UI 字号不能触发正文保存、改写草稿或改变自动保存间隔。

## 3. 正文、标题与打印独立

以下属于用户文档排版，不能批量替换为 UI token：

- `.title-input` 的文档标题尺寸和自适应高度。
- `.notebook-editor` 的默认正文、用户自定义字号、H1／H2／H3 层级及 code 相对尺寸。
- `.prose-print` 的页面／笔记本标题、正文和表格排版。
- [`editor-font-size.ts`](../src/lib/editor-font-size.ts)、[`editor-formatting.ts`](../src/lib/editor-formatting.ts) 和 [`render-document.tsx`](../src/lib/render-document.tsx) 的字号字段、字体与内联样式。

这些尺寸由各自文档排版源码维护；打印工具栏属于 UI，PDF 内容不跟随 UI 偏好。不能因字号或主题统一而重写 Tiptap JSON、快照、用户颜色及字体。

## 4. 字体资源

字体资源及稳定变量由 [`src/app/fonts.ts`](../src/app/fonts.ts) 加载，字体 ID、名称、分组、回退与旧值映射由 [`editor-formatting.ts`](../src/lib/editor-formatting.ts) 维护。编辑器和打印共用映射，不把 UI 字体偏好写入正文。

自托管方式、构建联网要求和字体授权见 [README 的字体说明](../README.md#字体与导出)；新增字体应同步共享映射、资源和许可证，不仅修改菜单名称。

## 5. 验证与历史

- `tests/unit/ui-typography.test.ts`：枚举、层级、最小值及硬编码 UI 字号守卫。
- `tests/integration/ui-typography-migration.test.ts`：隔离迁移与旧值保留。
- `tests/e2e/typography.spec.ts`：三档偏好、首屏恢复、失败处理、跨账号、响应式、主题及文档／打印隔离。
- `tests/e2e/knowledge-layout.spec.ts`：知识库在多档字号和窄屏下的布局。

执行方法与 Node／SQLite ABI 注意事项见 [测试说明](../tests/README.md)。最初的零散字号审计、实现过程与历次结果已有 [CHANGELOG](../CHANGELOG.md) 和历史 `PROGRESS.md` 记录，不作为当前规范重复维护，也不代表本次已重新测试。
