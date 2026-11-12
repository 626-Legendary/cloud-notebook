"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { X, Move, RotateCcw } from "lucide-react";
import { safeFileName } from "@/lib/filename";
import { notify } from "@/lib/notifications";

// Same 16 / 8.6 ratio as the existing notebook-cover-card.
const ratio = 16 / 8.6;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
export function CoverCropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (file: File) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const imageRef = useRef<HTMLImageElement>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const height = width / ratio;
  const scale = size.width ? Math.max(width / size.width, height / size.height) * zoom : 0;
  const excessX = Math.max(0, (size.width * scale - width) / 2);
  const excessY = Math.max(0, (size.height * scale - height) / 2);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  async function save() {
    if (!imageRef.current || !size.width || !width || busy || error) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1600; canvas.height = 860;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法生成裁剪图片");
      const sourceWidth = width / scale, sourceHeight = height / scale;
      const sourceX = (size.width - sourceWidth) / 2 - offset.x * excessX / scale;
      const sourceY = (size.height - sourceHeight) / 2 - offset.y * excessY / scale;
      context.drawImage(imageRef.current, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法生成裁剪图片")), "image/webp", .92));
      const extension = blob.type === "image/webp" ? "webp" : "png";
      onConfirm(new File([blob], `${safeFileName(file.name.replace(/\.[^.]+$/, ""), 150)}-裁剪.${extension}`, { type: blob.type }));
    } catch (cause) { notify.error(cause instanceof Error ? cause.message : "封面裁剪失败"); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="form-dialog-overlay crop-overlay" />
      <Dialog.Content className="form-dialog-content cover-crop-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <header className="modal-header"><Dialog.Title>裁剪笔记本封面</Dialog.Title><Dialog.Close className="icon-button" aria-label="取消裁剪" disabled={busy}><X size={16} /></Dialog.Close></header>
        <div className="modal-body">
          <Dialog.Description className="cover-crop-description"><Move size={15} />拖动图片调整位置，使用滑块缩放。裁剪框即为保存后的封面。</Dialog.Description>
          <div ref={setViewport} className="cover-crop-viewport" tabIndex={0} role="group" aria-label="封面裁剪区域，可拖动或使用方向键调整位置"
            onKeyDown={(event) => {
              const delta = event.shiftKey ? .15 : .04;
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              setOffset((current) => ({ x: clamp(current.x + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0)), y: clamp(current.y + (event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0)) }));
            }}
            onPointerDown={(event) => {
              if (busy || !size.width) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              setOffset({ x: excessX ? clamp(start.offsetX + (event.clientX - start.x) / excessX) : 0, y: excessY ? clamp(start.offsetY + (event.clientY - start.y) / excessY) : 0 });
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            {/* A local decoded image is required as the canvas crop source. */}
            <img ref={imageRef} src={url} alt="裁剪预览" draggable={false} style={{ width: size.width * scale, height: size.height * scale, left: -excessX + offset.x * excessX, top: -excessY + offset.y * excessY }}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth * image.naturalHeight > 40_000_000 || image.naturalWidth > 20_000 || image.naturalHeight > 20_000) setError("图片尺寸过大，请选择不超过 4000 万像素的图片");
                else setSize({ width: image.naturalWidth, height: image.naturalHeight });
              }} onError={() => setError("图片无法解码，请选择有效的图片文件")} />
          </div>
          <label className="cover-crop-zoom">缩放<input type="range" min={1} max={4} step={.05} value={zoom} aria-label="封面缩放" disabled={busy || Boolean(error)} onChange={(event) => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span></label>
          <button type="button" className="button-subtle" disabled={busy} onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={14} />重置裁剪</button>
          {file.type === "image/gif" && <p className="status-line">GIF 将保存为静态封面。</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
        <footer className="form-dialog-actions"><Dialog.Close className="button-outline" disabled={busy}>取消</Dialog.Close><button className="button-primary" disabled={busy || !size.width || !width || Boolean(error)} onClick={() => void save()}>{busy ? "生成中…" : "确认裁剪"}</button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
