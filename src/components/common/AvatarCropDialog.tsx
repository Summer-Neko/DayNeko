import React from "react";
import type { AvatarCropDraft } from "../../types";

export function AvatarCropDialog({
  draft,
  onChange,
  onClose,
  onConfirm
}: {
  draft: AvatarCropDraft | null;
  onChange: (draft: AvatarCropDraft | null) => void;
  onClose: () => void;
  onConfirm: (avatar: string) => void;
}) {
  const dragRef = React.useRef<{ x: number; y: number; draftX: number; draftY: number } | null>(null);
  const [imageSize, setImageSize] = React.useState<{ width: number; height: number } | null>(null);
  if (!draft) return null;

  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const update = (patch: Partial<AvatarCropDraft>) => onChange({ ...draft, ...patch });
  const previewSize = 220;
  const coverScale = imageSize ? Math.max(previewSize / imageSize.width, previewSize / imageSize.height) : 1;
  const drawWidth = imageSize ? imageSize.width * coverScale * draft.scale : previewSize;
  const drawHeight = imageSize ? imageSize.height * coverScale * draft.scale : previewSize;
  const overflowX = Math.max(0, drawWidth - previewSize);
  const overflowY = Math.max(0, drawHeight - previewSize);
  const confirm = async () => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = draft.dataUrl;
    });
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cover = Math.max(size / image.width, size / image.height) * draft.scale;
    const drawWidth = image.width * cover;
    const drawHeight = image.height * cover;
    const overflowX = Math.max(0, drawWidth - size);
    const overflowY = Math.max(0, drawHeight - size);
    const dx = -overflowX * (draft.x / 100);
    const dy = -overflowY * (draft.y / 100);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
    onConfirm(canvas.toDataURL("image/jpeg", 0.82));
  };

  return (
    <div className="crop-dialog" role="dialog" aria-modal="true">
      <button className="lightbox-backdrop" onClick={onClose} />
      <div className="crop-panel">
        <header>
          <div>
            <strong>裁剪头像</strong>
            <span>滚轮缩放，按住图片拖动选择显示范围。</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div
          className="avatar-crop-preview"
          onWheel={(event) => {
            event.preventDefault();
            update({ scale: Math.max(1, Math.min(5, draft.scale + (event.deltaY < 0 ? 0.1 : -0.1))) });
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, draftX: draft.x, draftY: draft.y };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            update({
              x: clamp(drag.draftX - (event.clientX - drag.x) * 0.32),
              y: clamp(drag.draftY - (event.clientY - drag.y) * 0.32)
            });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          <img
            src={draft.dataUrl}
            alt=""
            draggable={false}
            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={{
              width: `${drawWidth}px`,
              height: `${drawHeight}px`,
              transform: `translate(${-overflowX * (draft.x / 100)}px, ${-overflowY * (draft.y / 100)}px)`
            }}
          />
        </div>
        <label className="field crop-scale-field">
          <span>缩放 {draft.scale.toFixed(2)}x</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.05}
            value={draft.scale}
            onChange={(event) => update({ scale: Number(event.target.value) })}
          />
        </label>
        <p className="muted crop-hint">滚轮缩放，拖动图片调整位置。最小缩放会始终填满头像框。</p>
        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary-button" onClick={() => void confirm()}>使用这个头像</button>
        </footer>
      </div>
    </div>
  );
}
