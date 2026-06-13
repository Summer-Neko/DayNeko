import { Maximize2, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIconUrl from "../../../src-tauri/icons/icon.ico?url";

export function WindowChrome({ title }: { title: string }) {
  const window = getCurrentWindow();
  return (
    <header className="window-chrome" onPointerDown={() => void window.startDragging()}>
      <div className="window-chrome-title">
        <span>
          <img src={appIconUrl} alt="" />
        </span>
        <strong>{title}</strong>
      </div>
      <div className="window-chrome-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button aria-label="最小化" onClick={() => void window.minimize()}>
          <Minus size={16} />
        </button>
        <button aria-label="最大化" onClick={() => void window.toggleMaximize()}>
          <Maximize2 size={14} />
        </button>
        <button aria-label="关闭" onClick={() => void window.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
