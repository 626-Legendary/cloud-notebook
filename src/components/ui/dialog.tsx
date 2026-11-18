"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";

import { CoverCropDialog } from "@/components/cover-crop-dialog";
import { notify } from "@/lib/notifications";

type DialogField = {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  type?: "text" | "select" | "file";
  accept?: string;
  cropNotebookCover?: boolean;
  options?: { value: string; label: string }[];
};
type DialogRequest = { title: string; submitLabel?: string; fields: DialogField[] };
type DialogResult = { values: Record<string, string>; files: Record<string, File> } | null;
type DialogContextValue = (request: DialogRequest) => Promise<DialogResult>;
const DialogContext = createContext<DialogContextValue | null>(null);

export function FormDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [crop, setCrop] = useState<{ name: string; file: File } | null>(null);
  const resolver = useRef<((result: DialogResult) => void) | null>(null);
  const finish = useCallback((result: DialogResult) => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
    setCrop(null);
  }, []);
  const ask = useCallback<DialogContextValue>((nextRequest) => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setFiles({});
    setCrop(null);
    setValues(Object.fromEntries(nextRequest.fields.map((field) => [field.name, field.value ?? ""])));
    setRequest(nextRequest);
  }), []);

  return <DialogContext.Provider value={ask}>
    {children}
    <DialogPrimitive.Root open={request !== null} onOpenChange={(open) => { if (!open) finish(null); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="form-dialog-overlay" />
        <DialogPrimitive.Content className="form-dialog-content">
          <DialogPrimitive.Title className="form-dialog-title">{request?.title}</DialogPrimitive.Title>
          <form onSubmit={(event) => { event.preventDefault(); finish({ values, files }); }}>
            {request?.fields.map((field) => <label className="form-dialog-field" key={field.name}>
              <span>{field.label}</span>
              {field.type === "file"
                ? <><input type="file" accept={field.accept} onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (field.cropNotebookCover) {
                    event.target.value = "";
                    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || !file.size) return notify.error("请选择有效的 JPG、PNG、WebP 或 GIF 图片");
                    if (file.size > 10 * 1024 * 1024) return notify.error("封面图片不能超过 10 MB");
                    setCrop({ name: field.name, file });
                  } else setFiles((current) => ({ ...current, [field.name]: file }));
                }} /><small>{files[field.name]?.name ?? "可选"}</small></>
                : field.options
                ? <select autoFocus={request.fields[0] === field} className="control-input" required value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}>
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                : <input autoFocus={request.fields[0] === field} className="control-input" required={field.required ?? true} minLength={field.required === false ? undefined : 1} maxLength={field.maxLength ?? 120} placeholder={field.placeholder} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />}
            </label>)}
            <div className="form-dialog-actions">
              <DialogPrimitive.Close type="button" className="button-outline">取消</DialogPrimitive.Close>
              <button className="button-primary" type="submit">{request?.submitLabel ?? "确定"}</button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    {crop && <CoverCropDialog file={crop.file} onCancel={() => setCrop(null)} onConfirm={(file) => { setFiles((current) => ({ ...current, [crop.name]: file })); setCrop(null); }} />}
  </DialogContext.Provider>;
}

export function useFormDialog() {
  const ask = useContext(DialogContext);
  if (!ask) throw new Error("useFormDialog must be used inside FormDialogProvider.");
  return ask;
}
