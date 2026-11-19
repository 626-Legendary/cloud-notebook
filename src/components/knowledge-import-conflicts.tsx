"use client";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ImportConflict } from "@/lib/knowledge-import";

export type ImportConflictDetails = { conflicts: ImportConflict[]; canReuse: boolean };
export function KnowledgeImportConflicts({ details, onChoose }: {
  details: ImportConflictDetails;
  onChoose: (policy: "reuse" | "rename" | null) => void;
}) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onChoose(null); }}><Dialog.Portal>
    <Dialog.Overlay className="alert-overlay" />
    <Dialog.Content className="alert-content knowledge-import-conflicts">
      <Dialog.Title className="text-ui-heading">处理导入词条冲突</Dialog.Title>
      <Dialog.Description>尚未写入本次导入。请选择统一处理方式，已有词条的正文与别名都不会被覆盖。</Dialog.Description>
      <ul className="knowledge-conflict-list">{details.conflicts.map((item, index) => <li key={index}><strong>{item.incomingTitle}</strong><span>与 {item.existingTitles.join("、")} 的名称或别名冲突</span></li>)}</ul>
      {!details.canReuse && <p className="status-line">部分导入项同时匹配多个已有词条，不能直接复用；可保留双方并重命名。</p>}
      <p className="text-ui-secondary">复用：导入引用指向已有词条，保留已有正文。保留双方：为冲突名称和别名添加“（导入 N）”，引用指向新词条。</p>
      <div className="alert-actions"><button className="button-outline" onClick={() => onChoose(null)}>取消导入</button><button className="button-outline" disabled={!details.canReuse} onClick={() => onChoose("reuse")}>复用已有词条</button><button className="button-primary" onClick={() => onChoose("rename")}>保留双方并重命名</button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

type ConflictPolicy = "reuse" | "rename" | null;
export function useKnowledgeImportConflicts() {
  const [details, setDetails] = useState<ImportConflictDetails | null>(null);
  const resolver = useRef<((policy: ConflictPolicy) => void) | null>(null);
  useEffect(() => () => { resolver.current?.(null); }, []);
  function choose(policy: ConflictPolicy) { resolver.current?.(policy); resolver.current = null; setDetails(null); }
  function chooseConflictPolicy(value: ImportConflictDetails) {
    if (!Array.isArray(value.conflicts) || typeof value.canReuse !== "boolean") {
      throw new Error("导入目标已发生变化，请重新选择文件后重试");
    }
    resolver.current?.(null);
    return new Promise<ConflictPolicy>((resolve) => { resolver.current = resolve; setDetails(value); });
  }
  return { chooseConflictPolicy, conflictDialog: details && <KnowledgeImportConflicts details={details} onChoose={choose} /> };
}
