"use client";
import { useEffect, useRef, useState } from "react";
import { Tags, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { knowledgeRequest } from "@/lib/knowledge-client";
import { serializePageSave } from "@/lib/page-save-queue";
import { notify } from "@/lib/notifications";
type Tag = { id: string; name: string };
export function ContentTags({ sourceType, sourceId }: { sourceType: "page" | "entry"; sourceId: string }) {
  const [tags, setTags] = useState<Tag[]>([]), [selected, setSelected] = useState<Tag[]>([]), [name, setName] = useState(""), [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); let loadSequence = 0;
    const load = () => { const started = revision.current, request = ++loadSequence; void knowledgeRequest<{ tags: Tag[]; selected: Tag[] }>(`/api/tags?sourceType=${sourceType}&sourceId=${sourceId}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted && started === revision.current && request === loadSequence) { setTags(data.tags); setSelected(data.selected); } }).catch(() => {}); };
    load(); window.addEventListener("cloud-notebook:tags-change", load);
    return () => { controller.abort(); window.removeEventListener("cloud-notebook:tags-change", load); };
  }, [sourceType, sourceId]);
  async function assign(ids: string[]) {
    if (busy) return;
    revision.current += 1;
    const previous = selected;
    setSelected(tags.filter((tag) => ids.includes(tag.id))); setBusy(true);
    try { const result = await serializePageSave(sourceType === "entry" ? `entry:${sourceId}` : sourceId, () => knowledgeRequest<{ tags: Tag[] }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign", sourceType, sourceId, tagIds: ids }) })); setSelected(result.tags); window.dispatchEvent(new Event("cloud-notebook:tags-change")); }
    catch (error) { setSelected(previous); notify.error(error instanceof Error ? error.message : "标签保存失败"); } finally { setBusy(false); }
  }
  async function create() {
    if (!name.trim() || busy) return; setBusy(true);
    try { const result = await knowledgeRequest<{ tags: Tag[] }>("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name: name.trim() }) }); setTags(result.tags); setName(""); window.dispatchEvent(new Event("cloud-notebook:tags-change")); }
    catch (error) { notify.error(error instanceof Error ? error.message : "无法创建标签"); } finally { setBusy(false); }
  }
  return <div className="content-tags">
    {selected.map((tag) => <span className="knowledge-tag" key={tag.id}>{tag.name}<button type="button" aria-label={`移除标签${tag.name}`} disabled={busy} onClick={() => void assign(selected.filter((item) => item.id !== tag.id).map((item) => item.id))}><X size={12} /></button></span>)}
    <Popover><PopoverTrigger asChild><button type="button" className="button-subtle" aria-label="设置标签"><Tags size={14} />标签</button></PopoverTrigger><PopoverContent className="knowledge-tag-menu">
      <div className="knowledge-tag-options">{tags.map((tag) => <label key={tag.id}><input type="checkbox" disabled={busy} checked={selected.some((item) => item.id === tag.id)} onChange={(event) => void assign(event.target.checked ? [...selected.map((item) => item.id), tag.id] : selected.filter((item) => item.id !== tag.id).map((item) => item.id))} />{tag.name}</label>)}</div>
      <div className="knowledge-controls"><input className="control-input" aria-label="新标签名称" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><button type="button" className="button-outline" disabled={busy || !name.trim()} onClick={() => void create()}>新建标签</button></div>
    </PopoverContent></Popover>
  </div>;
}
