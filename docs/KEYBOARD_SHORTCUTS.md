# 快捷键与退出交互约定

`Ctrl/Cmd` 表示 Windows／Linux 使用 Ctrl，macOS 使用 Command。

| 操作 | 快捷键 | 生效范围 |
| --- | --- | --- |
| 当前页面正文搜索 | Ctrl/Cmd+F | 当前正文或工具栏获得焦点时 |
| 全局搜索 | Ctrl/Cmd+Shift+F | 工作区内，未打开其他模态框时 |
| 插入链接 | Ctrl/Cmd+K | 正文或工具栏内，排除输入框和弹窗 |
| 保存页面 | Ctrl/Cmd+S | 编辑文档时，排除模态框 |
| 折叠／展开侧栏 | Ctrl/Cmd+\ | 工作区内，排除正在输入的表单控件 |

参考 [Tiptap 链接扩展的 Mod-K 建议](https://tiptap.dev/docs/editor/extensions/marks/link) 与 [VS Code 的跨文件搜索约定](https://code.visualstudio.com/docs/reference/default-keybindings)。

旧全局 Ctrl/Cmd+Shift+K 与未检查 Shift 的链接监听会同时命中，现已移除这个冲突组合。
匹配逻辑集中在 `src/lib/keyboard-shortcuts.ts`：精确匹配 Shift，忽略 Alt、同时按 Ctrl 与 Cmd、输入法组合及已处理的事件。正文以外的浏览器快捷键不被链接命令抢占。

## 退出登录

普通用户与管理员共用 `useLogout`：

1. 立即显示等待界面并限制重复操作；使用已有 Radix 模态焦点管理，防止等待期间继续编辑。
2. 普通用户先通过现有 flush 队列确认正文已保存；有错误或版本冲突时保留草稿并取消退出。
3. 等待服务器撤销当前会话、清除 Cookie；不通过客户端删除 HttpOnly Cookie 冒充成功。
4. 成功后使用完整页面跳转进入 `/login`，丢弃已登录状态的客户端路由缓存。
5. 退出请求超时或响应不明确时，使用不缓存的 `/api/auth/me` 核实状态。仅服务器明确返回 401 时视为已退出；仍登录或无法确认时显示错误并允许重试。
6. 服务端撤销失败返回 503，保留原会话 Cookie 以便重试，不静默宣称成功。

已验证慢响应、失败重试、旧 Cookie 重放失效、刷新保持退出、退出前保存以及版本冲突阻止退出。
实际部署的网络或数据库性能仍需结合服务端日志判断，本次没有将“响应慢”的具体原因假定为数据库或代理故障。
