# DayNeko

DayNeko 是一个本地优先的日常记录桌面应用。它把「今天做了什么」「应用什么时候运行」「有哪些自定义日程」「好友当天完成情况与评分」放在一个轻量桌面端里，并提供 FastAPI + SQLite 后端用于好友、同步、排行榜和后台管理。

## 当前能力

- Tauri 2 + React 19 + Vite 桌面端。
- 本地优先存储：前端状态保存在本机，配置项默认只在本地生效。
- FastAPI 后端：使用 SQLite 存储用户、好友关系、增量同步记录、评分和日程快照。
- 自动活动记录：桌面端采集前台窗口和进程，按规则归类为活动时间轴。
- 时间页：展示当天应用启动区间、活动甘特图、活动时长和好友可见时间记录。
- 自定义日程：支持单日事件、每日重复、完成标记、图片证据上传和查看。
- 好友系统：设备注册、好友申请、好友状态、好友日程查看、评分和排行榜。
- 全局应用内消息：同步、好友、服务器和更新状态会以全局通知展示。
- 外观设置：主题、字号、强调色、自定义背景、背景亮度、卡片透明度、卡片模糊和阴影。
- 桌面行为：自启动、静默运行、关闭到托盘、自绘窗口标题栏。
- 官方 Tauri updater：支持检查 GitHub Release 上的 `latest.json`，弹出独立更新窗口并下载重启更新。
- 后台管理页：可登录管理用户和记录，支持分页、类型筛选和时间筛选。

## 项目结构

```text
backend/
  app/
    main.py              # FastAPI 主接口
    admin.py             # 后台管理接口
    admin_static/        # 后台管理页面 HTML/CSS/JS
src/
  components/            # 通用组件、日程证据、时间面板
  hooks/                 # 通知和 ticker hooks
  lib/                   # 状态、API、日期、活动、更新等逻辑
  pages/                 # 首页、时间、日程、好友、排行、设置
  main.tsx               # 主应用入口
  updateWindow.tsx       # 独立更新窗口入口
src-tauri/
  src/                   # Tauri/Rust 桌面能力
  icons/                 # 应用图标
  tauri.conf.json        # Tauri 配置和 updater 配置
```

## 开发环境

需要：

- Node.js 22 或兼容版本
- Rust stable
- Windows WebView2
- Python 3.11 或兼容版本

安装前端依赖：

```powershell
npm.cmd install
```

启动前端开发服务器：

```powershell
npm.cmd run dev
```

默认地址是：

```text
http://127.0.0.1:1420
```

## 启动后端

安装后端依赖：

```powershell
pip install -r backend\requirements.txt
```

启动 API：

```powershell
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8787
```

健康检查：

```text
GET http://127.0.0.1:8787/health
```

后台管理页：

```text
http://127.0.0.1:8787/admin
```

首次进入后台时需要初始化管理员密码。之后后台接口会要求登录态，普通 DayNeko 用户不会自动拥有后台权限。

## 启动桌面端

```powershell
npm.cmd run tauri -- dev
```

如果当前 PowerShell 找不到 `cargo`，先把 Rust 加到本次终端的 PATH：

```powershell
$env:PATH = "C:\Users\Sunme\.cargo\bin;$env:PATH"
```

## 打包

普通构建：

```powershell
npm.cmd run build
```

Tauri 打包：

```powershell
npm.cmd run tauri -- build
```

构建产物通常在：

```text
src-tauri\target\release\
src-tauri\target\release\bundle\
```

注意：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号最好保持一致，否则发布包、updater 和 release 命名容易混乱。

## 发布更新

项目当前使用 Tauri 官方 updater。

发布时通常需要：

1. 更新版本号。
2. 执行 `npm.cmd run tauri -- build`。
3. 上传安装包或可更新产物到 GitHub Release。
4. 上传 Tauri 生成的签名文件。
5. 上传或更新 `latest.json`，并确保里面的版本、下载地址、签名和平台信息正确。

当前 updater endpoint 配置在：

```text
src-tauri/tauri.conf.json
```

应用启动时会自动检查一次更新，也可以在设置页手动检查。发现新版本时会打开独立更新窗口展示 release 公告，并提供下载重启更新、跳过版本、下次提醒。

## 数据与同步

本地：

- 应用状态保存在浏览器本地存储。
- 如果设置了自定义数据路径，也会把状态快照写入该目录。
- 外观、语言、桌面行为等设置属于本地设置，不需要同步到云端。

云端：

- 用户资料
- 设备登录信息
- 好友关系和好友申请
- presence 当前状态
- boot 启动区间
- activity 活动记录
- event 自定义日程和证据
- friend-rating 好友评分
- leaderboard 排行榜所需评分数据

同步模型是增量同步。前端把变更写入 `dirtyQueue`，默认按设置的同步间隔请求：

```text
POST /sync/changes
```

只有服务器确认成功后，本地才会清理对应增量记录。

## 图标说明

应用图标位于：

```text
src-tauri/icons/icon.ico
```

更换图标后需要重新 Tauri 打包。Windows 可能缓存旧的 exe、快捷方式或任务栏图标，必要时取消固定再重新固定，或者等待系统图标缓存刷新。

自绘标题栏里的图标也引用同一个 `icon.ico`，所以重新构建前端后标题栏图标会同步变化。

## 国际化建议

当前中文文案主要直接写在组件里，还没有统一 i18n 层。并不是不能改，只是一次性替换会比较机械。

推荐后续逐步做：

1. 新建 `src/lib/i18n.ts`，定义 `messages` 字典。
2. 先替换导航、设置页和高频按钮。
3. 再逐步替换各页面标题、空状态、通知和错误提示。
4. 最后处理后端返回错误、更新窗口和后台管理页。

最小示例：

```ts
import type { Language } from "../types";

export const messages = {
  "zh-CN": {
    settings: "设置",
    restoreAppearance: "恢复默认外观设置"
  },
  "en-US": {
    settings: "Settings",
    restoreAppearance: "Reset appearance"
  }
} satisfies Record<Language, Record<string, string>>;

export function t(language: Language, key: keyof typeof messages["zh-CN"]) {
  return messages[language]?.[key] ?? messages["zh-CN"][key] ?? key;
}
```

## 常用命令

```powershell
npm.cmd run build
npm.cmd run tauri -- dev
npm.cmd run tauri -- build
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8787
```

## 仍需继续完善

- 建立统一 i18n 字典，避免中文文案继续散落。
- 进一步清理 `main.tsx` 中仍然偏集中的业务逻辑。
- 为后台管理增加更细的权限和审计日志。
- 为同步冲突处理增加更明确的策略。
- 为核心流程补充自动化测试。
