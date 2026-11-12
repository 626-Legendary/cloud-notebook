"use client";

import Image from "next/image";
import { useRef } from "react";
import { NotebookPen, Plus, FileUp, LoaderCircle } from "lucide-react";

type HomeNotebook = { id: string; title: string; coverAssetId: string | null };
export function NotebookHome({ notebooks, importing, onOpen, onCreate, onImport }: {
  notebooks: HomeNotebook[]; importing: boolean; onOpen: (notebook: HomeNotebook) => void;
  onCreate: () => void; onImport: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="notebook-home">
    <header className="notebook-home-heading"><div><h1 className="text-ui-title">我的笔记本</h1><p>选择一本笔记，继续记录。</p></div>
      <div className="notebook-home-actions">
        <input ref={input} type="file" accept=".cnf" hidden aria-label="选择 CNF 笔记本" disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImport(file); }} />
        <button className="button-outline" disabled={importing} onClick={() => input.current?.click()}>{importing ? <LoaderCircle size={15} className="spin" /> : <FileUp size={15} />}{importing ? "导入中…" : "导入笔记本 (.cnf)"}</button>
        <button className="button-primary" onClick={onCreate}><Plus size={15} />新建笔记本</button>
      </div>
    </header>
    {notebooks.length ? <div className="notebook-home-grid">{notebooks.map((notebook) => <button type="button" className="notebook-home-card" key={notebook.id} onClick={() => onOpen(notebook)} aria-label={`打开笔记本：${notebook.title}`}>
      <span className="notebook-home-cover">{notebook.coverAssetId ? <Image src={`/uploads/notes/${notebook.coverAssetId}`} width={640} height={344} alt={`${notebook.title}封面`} unoptimized /> : <NotebookPen size={48} aria-hidden="true" />}</span>
      <span className="notebook-home-title" title={notebook.title}>{notebook.title || "无标题"}</span>
    </button>)}</div> : <div className="notebook-home-empty"><NotebookPen size={44} /><strong className="text-ui-heading">开始记录你的想法</strong><p>新建一本笔记，或导入已有的 CNF 笔记本。</p></div>}
  </div>;
}
