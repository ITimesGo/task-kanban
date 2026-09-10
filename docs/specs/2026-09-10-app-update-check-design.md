# 应用内检查更新 — 设计

日期：2026-09-10  
范围：简易任务看板（portable）

## 目标

用户可在设置中查看当前版本并手动检查是否有新版；有新版时打开下载页，不自动覆盖 portable 程序。

## 行为

- 设置新增「关于」面板：显示当前版本、`检查更新` 按钮、结果文案。
- 启动不自动检查。
- 请求仓库 feed：`https://raw.githubusercontent.com/ITimesGo/task-kanban/main/docs/kanban-latest.json`
- Feed JSON：`{ "version": "x.y.z", "notes"?: string, "url": "https://..." }`
- 比较 semver（major.minor.patch，忽略前缀 `v`）；远程更高 → 提示更新并提供打开下载页；否则「已是最新」。
- 网络/JSON 错误 → 友好错误提示，不崩溃。
- 发版时更新 `docs/kanban-latest.json` 并推送到 `main`；下载 `url` 建议用 GitHub Release 资源直链。

## 实现要点

- 纯函数 `compareVersions` / `evaluateUpdate` 可单测。
- 主进程 `net.fetch` 拉 feed；`shell.openExternal` 打开下载 URL。
- 渲染层只调 IPC，不直连外网。
