"use client";

import { useState } from "react";

export function PrintDocument({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState("");
  async function print() {
    setError("");
    try {
      await Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("部分图片加载失败，无法生成完整打印内容")), { once: true });
        });
      }));
      if (document.fonts) await document.fonts.ready;
      window.print();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "打印内容加载失败");
    }
  }
  return <main className="print-document">
    <div className="print-toolbar no-print">
      {error && <span style={{ marginRight: "auto", color: "#b42318", alignSelf: "center" }} role="alert">{error}</span>}
      <button className="button-primary" onClick={() => void print()}>打印 / 保存为 PDF</button>
    </div>
    {children}
  </main>;
}
