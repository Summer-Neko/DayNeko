# DayNeko

DayNeko 是一个本地优先的日常记录桌面应用 MVP：记录启动时间、实时状态、日程打卡、好友动态、评分评语，并预留 FastAPI + SQLite 同步接口。

## 当前 MVP

- React + Vite 前端，后续由 Tauri 包成桌面应用。
- FastAPI 后端，默认 SQLite，本地可跑，之后可部署到公网服务器。
- 前端在后端不可用时自动降级到 localStorage。
- 桌面布局包含左侧主导航、首页概览、时间竖条页、日程页和右侧好友动态栏。
- 设置页支持服务器地址、开机自启动、静默运行、关闭到托盘、背景、亮度、语言、深浅色主题、头像和昵称。
- 数据同步改为自动增量同步，默认每 1 分钟只上传 dirty queue 中变更过的数据。
- 自定义事件独立于“正在干嘛”，支持每日循环、当天临时事件、完成标记和压缩后的图片证据。
- 每日评分按天打包，只能在北京时间次日 02:00 后给前一天评分，等级为 SSS/S/A/B/C。

## 运行前端

```powershell
cmd /c npm install
cmd /c npm run dev
```

打开 Vite 输出的地址，默认是 `http://127.0.0.1:1420`。

## 运行后端

推荐使用你本机已有的 `env_py311`：

```powershell
conda run -n env_py311 pip install -r backend\requirements.txt
conda run -n env_py311 uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8787
```

## Tauri

如果当前终端还找不到 `cargo`，先把 Rust 加到本次 PowerShell 的 PATH：

```powershell
$env:PATH = "C:\Users\Sunme\.cargo\bin;$env:PATH"
cmd /c npm run tauri dev
```

构建桌面 exe：

```powershell
$env:PATH = "C:\Users\Sunme\.cargo\bin;$env:PATH"
cmd /c npm run tauri build -- --no-bundle
```

当前验证过的输出位置：

```text
src-tauri\target\release\dayneko.exe
```

托盘行为：

- 左键点击托盘图标会显示窗口。
- 托盘菜单包含“显示 DayNeko”和“退出”。
- 设置中开启“关闭时最小化到托盘”后，点击窗口关闭按钮会隐藏窗口，不会退出进程。
- 开机自启动使用 Tauri autostart 插件，设置页中切换即可。

## 同步模型

前端不再每次全量同步。所有用户、设置、启动记录、当前状态、自定义事件、好友和每日评分的变更都会进入 `dirtyQueue`，默认每 60 秒请求一次：

```text
POST /sync/changes
```

只有服务器确认成功后，本地才会清空已同步的增量记录。

## 后续建议

- 先做账号与好友权限：好友能看“所有信息”风险很高，建议至少分为公开状态、日程、历史记录三档授权。
- 活动识别在桌面端由 Tauri/Rust 采集当前前台窗口标题和进程名，前端只负责展示与纠错。
- 服务端部署时建议使用 PostgreSQL，SQLite 保留为本地开发和单机模式。
