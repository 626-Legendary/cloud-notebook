"use client";

import { useRef, useState } from "react";

export const MIN_PAGES_WIDTH = 300;
export const MAX_PAGES_WIDTH = 450;
export const pagesWidthStorageKey = "cloud-notebook:pages-panel-width";
export const clampPagesWidth = (width: number) => Math.max(MIN_PAGES_WIDTH, Math.min(MAX_PAGES_WIDTH, Number.isFinite(width) ? width : MIN_PAGES_WIDTH));

export function PanelResizer({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const start = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  return <div className="pages-panel-resizer" role="separator" tabIndex={0} aria-label="调整页面面板宽度" aria-controls="pages-panel" aria-orientation="vertical"
    aria-valuemin={MIN_PAGES_WIDTH} aria-valuemax={MAX_PAGES_WIDTH} aria-valuenow={Math.round(width)} aria-valuetext={`${Math.round(width)} 像素`}
    title="拖动调整宽度；方向键微调，双击恢复默认" data-resizing={resizing}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { pointerId: event.pointerId, x: event.clientX, width };
      setResizing(true);
    }}
    onPointerMove={(event) => {
      const origin = start.current;
      if (origin?.pointerId === event.pointerId) onChange(clampPagesWidth(origin.width + event.clientX - origin.x));
    }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { start.current = null; setResizing(false); }}
    onLostPointerCapture={() => { start.current = null; setResizing(false); }}
    onDoubleClick={() => onChange(MIN_PAGES_WIDTH)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 25 : 10;
      const next = event.key === "Home" ? MIN_PAGES_WIDTH : event.key === "End" ? MAX_PAGES_WIDTH : event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step : null;
      if (next === null) return;
      event.preventDefault(); onChange(clampPagesWidth(next));
    }} />;
}
