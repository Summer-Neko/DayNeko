import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { Download, RotateCcw } from "lucide-react";
import { GlobalTooltip } from "./components/common/GlobalTooltip";
import { WindowChrome } from "./components/common/WindowChrome";
import { appVersion } from "./lib/config";
import { hexToRgb } from "./lib/color";
import { installContextMenuGuard } from "./lib/contextMenu";
import { fetchGitHubReleaseNotes, markdownToHtml } from "./lib/update";
import type { UpdateInfo } from "./types";
import "./styles.css";

const skippedUpdateVersionKey = "dayneko-skipped-update-version";
const pendingUpdateInfoKey = "dayneko-pending-update-info";
const sharedAccentColorKey = "dayneko-accent-color";

function applyStoredAccentColor() {
  const accentColor = localStorage.getItem(sharedAccentColorKey)?.trim();
  if (!accentColor) return;
  document.documentElement.style.setProperty("--accent", accentColor);
  document.documentElement.style.setProperty("--accent-rgb", hexToRgb(accentColor));
}

applyStoredAccentColor();

function readPendingUpdate() {
  const raw = localStorage.getItem(pendingUpdateInfoKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UpdateInfo;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function UpdateWindow() {
  const [info, setInfo] = React.useState<UpdateInfo | null>(() => readPendingUpdate());
  const [status, setStatus] = React.useState("准备下载更新");
  const [busy, setBusy] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(0);
  const [total, setTotal] = React.useState<number | null>(null);

  React.useEffect(() => installContextMenuGuard(), []);

  React.useEffect(() => {
    applyStoredAccentColor();
    const onStorage = (event: StorageEvent) => {
      if (event.key === sharedAccentColorKey) applyStoredAccentColor();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  React.useEffect(() => {
    if (info) return;
    void check()
      .then(async (update) => {
        if (!update) {
          setStatus("当前已经是最新版本");
          return;
        }
        const releaseNotes = await fetchGitHubReleaseNotes(update.version).catch(() => null);
        setInfo({
          currentVersion: update.currentVersion || appVersion,
          latestVersion: update.version,
          hasUpdate: true,
          title: `DayNeko ${update.version}`,
          notes: releaseNotes || update.body || "这个版本没有填写更新日志。",
          url: "",
          publishedAt: update.date,
          assets: []
        });
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "检查更新失败"));
  }, [info]);

  const close = () => {
    void getCurrentWebviewWindow().close();
  };

  const skip = () => {
    if (info?.latestVersion) localStorage.setItem(skippedUpdateVersionKey, info.latestVersion);
    close();
  };

  const install = async () => {
    if (busy) return;
    setBusy(true);
    setDownloaded(0);
    setTotal(null);
    setStatus("正在准备更新...");
    try {
      const update = await check();
      if (!update) {
        setStatus("当前已经是最新版本");
        return;
      }
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
          setDownloaded(0);
          setStatus("开始下载更新...");
        }
        if (event.event === "Progress") {
          setDownloaded((value) => value + event.data.chunkLength);
        }
        if (event.event === "Finished") {
          setStatus("更新已安装，正在重启...");
        }
      });
      await relaunch();
    } catch (error) {
      console.error("Update install failed", error);
      setStatus(error instanceof Error ? `更新失败：${error.message}` : "更新失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const progress = total ? Math.min(100, Math.round((downloaded / total) * 100)) : busy && downloaded > 0 ? 45 : 0;

  return (
    <>
      <WindowChrome title="DayNeko 更新" />
      <main className="update-window-page">
        <section className="update-window-card">
          <header>
            <div>
              <span className="section-kicker">Update Available</span>
              <h1>{info?.title ?? "正在检查更新"}</h1>
              <p>当前 {info?.currentVersion ?? appVersion} · 最新 {info?.latestVersion ?? "--"}</p>
            </div>
          </header>

          <div className="update-window-notes" dangerouslySetInnerHTML={{ __html: markdownToHtml(info?.notes ?? "正在获取更新日志...") }} />

          <div className="update-window-progress" aria-hidden={!busy}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="muted">
            {status}
            {busy && downloaded > 0 ? `（${formatBytes(downloaded)}${total ? ` / ${formatBytes(total)}` : ""}）` : ""}
          </p>

          <footer>
            <button className="primary-button" disabled={busy || !info} onClick={() => void install()}>
              {busy ? <RotateCcw size={16} /> : <Download size={16} />}
              {busy ? "更新中..." : "下载并重启更新"}
            </button>
            <button className="primary-button accent-soft" disabled={busy || !info} onClick={skip}>跳过这个版本</button>
            <button className="primary-button accent-soft" disabled={busy} onClick={close}>下次再提醒我</button>
          </footer>
        </section>
        <GlobalTooltip />
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("update-root")!).render(<UpdateWindow />);
