import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, ImagePlus, Moon, Power, RefreshCw, Sun, Upload, UsersRound } from "lucide-react";
import { ChoicePicker } from "../components/common/ChoicePicker";
import { PanelTitle, Toggle } from "../components/ui";
import { accentOptions, appVersion } from "../lib/config";
import { compressImage } from "../lib/media";
import type { AppSettings, Language, UserProfile } from "../types";

export function SettingsPage({
  cloudLoggedIn,
  loginStatus,
  loginBusy,
  settings,
  serverTestBusy,
  serverStatus,
  updateBusy,
  updateStatus,
  user,
  onAvatarSelected,
  onCheckUpdate,
  onLogin,
  onSettings,
  onProfile,
  onServerTest
}: {
  cloudLoggedIn: boolean;
  loginStatus: string;
  loginBusy: boolean;
  settings: AppSettings;
  serverTestBusy: boolean;
  serverStatus: string;
  updateBusy: boolean;
  updateStatus: string;
  user: UserProfile;
  onAvatarSelected: (dataUrl: string) => void;
  onCheckUpdate: () => void | Promise<void>;
  onLogin: () => void | Promise<void>;
  onSettings: (settings: AppSettings) => boolean | Promise<boolean>;
  onProfile: (user: UserProfile) => void;
  onServerTest: () => void;
}) {
  const [dataPathDraft, setDataPathDraft] = React.useState(settings.dataPath);
  const update = (patch: Partial<AppSettings>) => onSettings({ ...settings, ...patch });
  const updateUser = (patch: Partial<UserProfile>) => onProfile({ ...user, ...patch });
  const commitDataPath = async () => {
    if (dataPathDraft === settings.dataPath) return;
    const applied = await update({ dataPath: dataPathDraft });
    if (!applied) setDataPathDraft(settings.dataPath);
  };
  const chooseDataPath = async () => {
    try {
      const selected = await invoke<string | null>("choose_data_dir", { currentDir: dataPathDraft || settings.dataPath });
      if (selected) {
        const applied = await update({ dataPath: selected });
        setDataPathDraft(applied ? selected : settings.dataPath);
      }
    } catch {
      // Browser preview keeps the manual input path.
    }
  };

  React.useEffect(() => {
    setDataPathDraft(settings.dataPath);
  }, [settings.dataPath]);

  const setAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onAvatarSelected(String(reader.result));
    reader.readAsDataURL(file);
  };
  const setBackground = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    update({ background: await compressImage(file, 1800, 0.72) });
  };
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Settings</span>
          <h1>设置</h1>
        </div>
        <p>有什么想调整的？</p>
      </header>

      <section className="settings-layout">
        <nav className="settings-toc">
          <button onClick={() => jumpTo("settings-profile")}>个人资料</button>
          <button onClick={() => jumpTo("settings-server")}>服务器</button>
          <button onClick={() => jumpTo("settings-update")}>更新</button>
          <button onClick={() => jumpTo("settings-desktop")}>桌面行为</button>
          <button onClick={() => jumpTo("settings-look")}>外观语言</button>
        </nav>

        <div className="settings-list">
          <section className="workspace-panel settings-section" id="settings-profile">
            <PanelTitle label="Profile" title="头像和昵称" icon={<UsersRound size={20} />} />
            <div className="profile-card">
              <label className="avatar large profile-avatar" data-tooltip="点击更换头像">
                {user.avatar ? <img src={user.avatar} alt="" /> : user.name.slice(0, 1).toUpperCase()}
                <input type="file" accept="image/*" onChange={(event) => void setAvatar(event.currentTarget.files)} />
              </label>
              <div className="profile-fields">
                <label className="field">
                  <span>昵称</span>
                  <input value={user.name} onChange={(event) => updateUser({ name: event.target.value })} />
                </label>
                <label className="field">
                  <span>账号标识</span>
                  <input value={user.handle} readOnly />
                </label>
              </div>
            </div>
            <p className="muted">
              {cloudLoggedIn ? `已登录：${user.handle}。` : "当前是本地用户。请登录以启用云同步和好友功能。"}
            </p>
            <label className="field">
              <span>自定义数据路径</span>
              <div className="path-picker-row">
                <input
                  placeholder="默认是应用所在目录下的 data 文件夹"
                  value={dataPathDraft}
                  onChange={(event) => setDataPathDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitDataPath();
                  }}
                />
                <button type="button" onClick={() => void chooseDataPath()}>
                  <FolderOpen size={16} />
                  选择
                </button>
              </div>
            </label>
            {/* <p className="muted">桌面端会把用户状态快照写入该目录下的 dayneko-state.json；网页预览仍会使用 localStorage 作为兜底。</p> */}
          </section>

          <section className="workspace-panel settings-section" id="settings-server">
            <PanelTitle label="Server" title="同步服务器" icon={<Upload size={20} />} />
            <label className="field">
              <span>服务器地址</span>
              <input value={settings.serverUrl} onChange={(event) => update({ serverUrl: event.target.value })} placeholder="http://127.0.0.1:8787" />
            </label>
            <div className="settings-row">
              <label className="field">
                <span>自动同步频率</span>
                <ChoicePicker
                  value={settings.syncIntervalSeconds}
                  onChange={(value) => update({ syncIntervalSeconds: Number(value) })}
                  options={[
                    { label: "30 秒", value: 30 },
                    { label: "1 分钟", value: 60 },
                    { label: "5 分钟", value: 300 }
                  ]}
                />
              </label>
              <button className={`primary-button ${serverTestBusy ? "busy" : ""}`} aria-disabled={serverTestBusy} onClick={() => !serverTestBusy && void onServerTest()}>
                {serverTestBusy ? "测试中..." : "测试服务器"}
              </button>
            </div>
            <Toggle checked={settings.autoDiscoverServer} label="连接失败时自动获取最新服务器" onChange={(value) => update({ autoDiscoverServer: value })} />
            <button className={`primary-button ${loginBusy ? "busy" : ""}`} aria-disabled={loginBusy} onClick={() => !loginBusy && void onLogin()}>
              {loginBusy ? "登录中..." : cloudLoggedIn ? "重新登录本设备" : "登录 / 注册本设备"}
            </button>
            <p className="muted">登录状态：{loginStatus}</p>
            <p className="muted">状态：{serverStatus}</p>
          </section>

          <section className="workspace-panel settings-section" id="settings-update">
            <PanelTitle label="Update" title="应用更新" icon={<RefreshCw size={20} />} />
            <div className="settings-row">
              <div>
                <p className="muted">当前版本：{appVersion}</p>
                <p className="muted">状态：{updateStatus}</p>
              </div>
              <button className={`primary-button ${updateBusy ? "busy" : ""}`} aria-disabled={updateBusy} onClick={() => !updateBusy && void onCheckUpdate()}>
                {updateBusy ? "检查中..." : "检查更新"}
              </button>
            </div>
          </section>

          <section className="workspace-panel settings-section" id="settings-desktop">
            <PanelTitle label="Desktop" title="桌面行为" icon={<Power size={20} />} />
            <Toggle checked={settings.autoStart} label="开机自启动" onChange={(value) => update({ autoStart: value })} />
            <Toggle checked={settings.silentRun} label="静默运行" onChange={(value) => update({ silentRun: value })} />
            <Toggle checked={settings.closeToTray} label="关闭时最小化到托盘" onChange={(value) => update({ closeToTray: value })} />
          </section>

          <section className="workspace-panel settings-section" id="settings-look">
            <PanelTitle label="Look" title="外观和语言" icon={settings.theme === "dark" ? <Moon size={20} /> : <Sun size={20} />} />
            <div className="field">
              <span>主题</span>
              <div className="theme-segment" style={{ "--seg-index": settings.theme === "light" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
                <button className={settings.theme === "light" ? "active" : ""} onClick={() => update({ theme: "light" })}>浅色</button>
                <button className={settings.theme === "dark" ? "active" : ""} onClick={() => update({ theme: "dark" })}>深色</button>
              </div>
            </div>
            <div className="field">
              <span>字体大小</span>
              <div
                className="theme-segment three"
                style={{
                  "--seg-index": settings.fontSize === "small" ? 0 : settings.fontSize === "medium" ? 1 : 2,
                  "--seg-count": 3
                } as React.CSSProperties}
              >
                <button className={settings.fontSize === "small" ? "active" : ""} onClick={() => update({ fontSize: "small" })}>小</button>
                <button className={settings.fontSize === "medium" ? "active" : ""} onClick={() => update({ fontSize: "medium" })}>中</button>
                <button className={settings.fontSize === "large" ? "active" : ""} onClick={() => update({ fontSize: "large" })}>大</button>
              </div>
            </div>
            <div className="field">
              <span>强调色</span>
              <div className="accent-grid">
                {accentOptions.map((item) => (
                  <button
                    className={settings.accentColor.toLowerCase() === item.value.toLowerCase() ? "active" : ""}
                    key={item.value}
                    onClick={() => update({ accentColor: item.value })}
                  >
                    <span style={{ background: item.value }} />
                    {item.name}
                  </button>
                ))}
                <label>
                  <input type="color" value={settings.accentColor} onChange={(event) => update({ accentColor: event.target.value })} />
                  自定义
                </label>
              </div>
            </div>
            <div className="settings-row">
              <label className="field">
                <span>语言</span>
                <ChoicePicker<Language>
                  value={settings.language}
                  onChange={(value) => update({ language: value })}
                  options={[
                    { label: "简体中文", value: "zh-CN" },
                    { label: "English", value: "en-US" }
                  ]}
                />
              </label>
            </div>
            <label className="field">
              <span>背景亮度 {settings.backgroundBrightness}%</span>
              <div className="brightness-control">
                <small>暗</small>
                <input
                  className="brightness-range"
                  type="range"
                  min={35}
                  max={100}
                  value={settings.backgroundBrightness}
                  style={{ "--brightness-progress": `${((settings.backgroundBrightness - 35) / 65) * 100}%` } as React.CSSProperties}
                  onChange={(event) => update({ backgroundBrightness: Number(event.target.value) })}
                />
                <small>亮</small>
              </div>
            </label>
            <div className="settings-row">
              <label className="field">
                <span>卡片透明度 {settings.cardOpacity}%</span>
                <div className="brightness-control">
                  <small>透</small>
                  <input
                    className="brightness-range"
                    type="range"
                    min={45}
                    max={96}
                    value={settings.cardOpacity}
                    style={{ "--brightness-progress": `${((settings.cardOpacity - 45) / 51) * 100}%` } as React.CSSProperties}
                    onChange={(event) => update({ cardOpacity: Number(event.target.value) })}
                  />
                  <small>实</small>
                </div>
              </label>
              <label className="field">
                <span>卡片模糊 {settings.cardBlur}px</span>
                <div className="brightness-control">
                  <small>清</small>
                  <input
                    className="brightness-range"
                    type="range"
                    min={0}
                    max={32}
                    value={settings.cardBlur}
                    style={{ "--brightness-progress": `${(settings.cardBlur / 32) * 100}%` } as React.CSSProperties}
                    onChange={(event) => update({ cardBlur: Number(event.target.value) })}
                  />
                  <small>柔</small>
                </div>
              </label>
            </div>
            <label className="field">
              <span>卡片阴影 {settings.cardShadow}%</span>
              <div className="brightness-control">
                <small>轻</small>
                <input
                  className="brightness-range"
                  type="range"
                  min={0}
                  max={28}
                  value={settings.cardShadow}
                  style={{ "--brightness-progress": `${(settings.cardShadow / 28) * 100}%` } as React.CSSProperties}
                  onChange={(event) => update({ cardShadow: Number(event.target.value) })}
                />
                <small>重</small>
              </div>
            </label>
            <div className="settings-action-row">
              <label className="file-button">
                <ImagePlus size={16} />
                自定义背景
                <input type="file" accept="image/*" onChange={(event) => void setBackground(event.currentTarget.files)} />
              </label>
              <button
                className="primary-button accent-soft"
                type="button"
                onClick={() => update({ background: undefined, backgroundBrightness: 86, cardOpacity: 74, cardBlur: 18, cardShadow: 11 })}
              >
                恢复默认外观设置
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
