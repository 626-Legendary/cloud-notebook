import { RefreshCw } from "lucide-react";

export function WorkspaceLoading() {
  return <div className="workspace-loading" role="status" aria-label="加载中">
    <RefreshCw className="spin" size={22} aria-hidden="true" />
    <span>加载中...</span>
  </div>;
}
