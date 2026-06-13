import React from "react";
import { compressImage } from "../../lib/media";
import type { EvidenceDraft } from "../../types";

export function EvidenceUploadDialog({
  draft,
  onClose,
  onConfirm,
  onPasteImage
}: {
  draft: EvidenceDraft | null;
  onClose: () => void;
  onConfirm: () => void;
  onPasteImage: (dataUrl: string) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && draft.dataUrl) onConfirm();
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, onClose, onConfirm]);

  const onPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    onPasteImage(await compressImage(file));
  };
  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onPasteImage(await compressImage(file));
  };

  if (!draft) return null;
  return (
    <div className="paste-dialog" role="dialog" aria-modal="true">
      <button className="lightbox-backdrop" onClick={onClose} />
      <div className="paste-panel" onPaste={onPaste} tabIndex={0}>
        <header>
          <div>
            <strong>上传证据</strong>
            <span>粘贴图片或选择图片后，按 Enter 才会上传</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <button
          className={`paste-zone ${draft.dataUrl ? "has-image" : ""}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          {draft.dataUrl ? <img src={draft.dataUrl} alt={draft.name} /> : <span>在这里粘贴图片</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void onFile(event.currentTarget.files)}
          />
        </button>
        <footer>
          <span>{draft.name}</span>
          <label className="file-button compact-file">
            选择图片
            <input type="file" accept="image/*" onChange={(event) => void onFile(event.currentTarget.files)} />
          </label>
          <button className="primary-button" disabled={!draft.dataUrl} onClick={onConfirm}>确认上传</button>
        </footer>
      </div>
    </div>
  );
}
