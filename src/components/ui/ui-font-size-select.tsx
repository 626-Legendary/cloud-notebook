"use client";

import { useUiTypography } from "@/components/ui-typography-provider";
import { isUiFontSize, uiFontSizeOptions } from "@/lib/ui-typography";

export function UiFontSizeSelect() {
  const { size, pending, setSize } = useUiTypography();
  return <label className="ui-font-size-field">
    <span className="text-ui-secondary">界面字号</span>
    <select className="control-input text-ui-secondary" aria-label="界面字号" value={size} disabled={pending} onChange={(event) => {
      if (isUiFontSize(event.target.value)) void setSize(event.target.value);
    }}>
      {uiFontSizeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
    <small className="text-ui-caption">仅调整界面，不改变笔记正文和打印字号。</small>
  </label>;
}
