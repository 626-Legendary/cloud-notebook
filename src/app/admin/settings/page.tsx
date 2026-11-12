import { UiFontSizeSelect } from "@/components/ui/ui-font-size-select";
import { AdminRegistrationSwitch } from "@/components/admin-registration-switch";
import { getRegistrationEnabled } from "@/lib/system-settings";

export default async function AdminSettingsPage() {
  const registrationEnabled = await getRegistrationEnabled();
  return <>
    <h1 className="admin-title text-ui-title">系统设置</h1>
    <p className="admin-description">部署与恢复操作说明</p>
    <div className="admin-settings-sections">
    <section className="admin-section">
      <h2 className="text-ui-heading">界面显示</h2>
      <UiFontSizeSelect />
    </section>
    <section className="admin-section">
      <h2 className="text-ui-heading">注册状态</h2>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p className="status-line" style={{ margin: 0 }}>{registrationEnabled ? "当前开放新用户注册。" : "当前已关闭新用户注册。"}</p>
        <AdminRegistrationSwitch initialEnabled={registrationEnabled} />
      </div>
      <p className="status-line">环境变量 ALLOW_REGISTRATION 作为初始化默认值；当前运行中的注册状态由数据库保存，并可在此开关中动态控制。</p>
    </section>
    <section className="admin-section">
      <h2 className="text-ui-heading">系统完整恢复</h2>
      <p className="status-line">完整系统备份包含数据库和附件。在线替换正在使用的 SQLite 数据库存在完整性风险；请先停止应用服务、校验备份文件及 SHA-256 校验和，再由服务器管理员按 README 中的维护流程恢复。</p>
      <p className="status-line">不要将未经验证的上传文件直接覆盖到运行中的数据库。完整恢复后应重启应用，使旧会话失效。</p>
    </section>
    </div>
  </>;
}
