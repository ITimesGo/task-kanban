# 按标签整理图片/附件目录 — 设计文档

日期：2026-08-24  
范围：简易任务看板桌面版（Electron）  
相关：`docs/specs/2026-08-03-task-kanban-design.md`

## 1. 目标

将图片与附件从根目录平铺改为按任务标签分文件夹存放，便于在资源管理器中浏览；已有数据需自动迁移；标签变更时文件自动跟随搬迁。

## 2. 决策摘要

| 项 | 决定 |
|---|---|
| 多标签归属 | 仅当任务**恰好 1 个标签**时进入该标签目录；0 个或 ≥2 个进入 `公共/` |
| 变更策略 | 改标签 / 重命名 / 删除标签时**自动**搬文件并更新 `rel` |
| 文件夹命名 | `{sanitize(标签名)}_{tagId前8位}`；公共目录固定为 `公共` |
| 覆盖范围 | `images/` 与 `attachments/` 均按同一规则 |
| 实现方式 | 路径即分类（磁盘目录 = 归属），任务 JSON 中存完整相对路径 |

## 3. 目录结构

```
{appDataDir}/
  images/
    公共/
      {taskId}_0.png
    工作_a1b2c3d4/
      {taskId}_0.jpg
  attachments/
    公共/
      report.pdf
    工作_a1b2c3d4/
      note.txt
  tasks.json
  tags.json
  trash.json
```

### 3.1 归属判定

```
folderFor(task.tags, tagList) =
  if tags.length === 1 and tag exists in tagList:
    images|attachments / {sanitize(name)}_{id.slice(0,8)} /
  else:
    images|attachments / 公共 /
```

### 3.2 命名规则

- **sanitize(标签名)**：去除 `\ / : * ? " < > |`，连续空白压成 `_`，trim；若结果为空则用 `tag`
- **短 id**：标签 UUID 的前 8 个字符（不含连字符亦可，取 `id` 去掉 `-` 后前 8 位更稳；实现取 `id.replace(/-/g,'').slice(0,8)`）
- **公共**：字面量 `公共`，无 id 后缀
- **图片文件名**：保持 `{taskId}_{index}.{ext}`
- **附件文件名**：保持现有「原名 + 同目录重名追加序号」策略，但目标目录改为标签/公共子目录

相对路径示例：

- `images/公共/abc_0.png`
- `images/工作_a1b2c3d4/abc_1.jpg`
- `attachments/公共/报告.pdf`

## 4. 行为规格

### 4.1 新建写入

`FileStore.copyImage` / `copyImageFromPath` / `copyAttachment`（及 async 变体）在写入前根据任务当前 `tags` 计算子目录；`mkdir` 后写入；返回带完整子路径的 `rel`。

创建任务流程：先 `createTask` 得到 id 与 tags（创建时若 UI 已选标签，写入前需先带上 tags，或创建后再 `setTags` 并触发搬迁——推荐：**创建时一并传入 tags**，写入文件时即用正确目录，避免二次搬迁）。

### 4.2 启动幂等迁移

应用启动（`FileStore` 就绪后、开始服务 IPC 前）对 `tasks` + `trash` 执行：

1. 对每个任务计算目标目录
2. 对每张图片 / 每个附件：
   - 若当前 `rel` 已在目标目录下且文件存在 → 跳过
   - 否则将文件 `rename`（失败则 copy+unlink）到目标路径
   - 目标已存在则对文件名追加 `_1`、`_2`…
   - 更新任务/回收站 JSON 中的 `rel`（附件同步更新 `name` 若因冲突改名）
3. 保存变更后的 tasks / trash
4. 删除已空的旧子目录；根 `images/`、`attachments/` 下不再保留散落文件（未引用的孤儿交给清理工具）

迁移必须幂等：重复启动结果不变。

### 4.3 标签变更自动搬迁

| 触发 | 行为 |
|---|---|
| `tasks:setTags` | 按新 tags 重算目录，搬该任务全部图片+附件，更新 `rel` |
| 详情编辑改标签并保存 | 同 `setTags`（或保存路径统一走搬迁） |
| `tags:rename` | 重命名对应子文件夹（images + attachments 各一），批量替换所有 tasks/trash 中以旧目录前缀开头的 `rel` |
| `tags:delete` | 先从所有任务/回收站去掉该 tag id，再对「标签数因此变化」的任务执行归属搬迁；删除空文件夹 |

目标目录与当前相同 → 不操作。

### 4.4 删除任务 / 删除文件

仍按 `rel` 删除物理文件；逻辑不变。

### 4.5 协议与 UI

`taskimage://local/{rel}` 继续按完整相对路径解析；renderer 无需改展示逻辑（仍 `API.imageUrl(rel)`）。

## 5. 错误处理

- 单文件搬迁失败：保留原路径与 JSON 引用，记录错误，继续处理其余文件
- 跨设备 `rename` 失败：回退 copy + unlink
- sanitize 后空名：使用 `tag`
- 不因部分失败回滚已成功搬迁的文件（避免复杂事务）；以「最终 JSON 与磁盘一致」为准：只有搬成功才改该条 `rel`

## 6. 兼容与清理

### 6.1 孤儿清理

`cleanupOrphans` 改为递归遍历 `images/**`、`attachments/**`（跳过非文件），用完整 `rel`（POSIX 风格 `/`）与 tasks+trash 引用比对。迁完后可删空目录。

### 6.2 备份 / 导入 / 换存储目录

- 导出 zip：按当前磁盘结构与 `rel` 原样打包
- 导入旧平铺包：解压后走启动迁移即可对齐
- 换存储目录：整目录拷贝后启动迁移（幂等）

## 7. 主要改动面

| 模块 | 变更 |
|---|---|
| `fileStore.js` | 子目录计算、写入路径、`moveMediaForTask`、启动 `migrateMediaLayout` |
| `main.js` | 启动时迁移；create/update/setTags/rename/delete 钩子 |
| `tags.js` / IPC | rename/delete 触发目录同步 |
| `cleanupOrphans.js` | 递归扫描 |
| `create.js` / `detail.js` | 确保创建/编辑带 tags 时与落盘一致（若 create 已支持 tags 则顺带校验） |
| 测试 | 新增/扩展 `test/` 中路径归属、迁移、重命名、孤儿清理用例 |

## 8. 测试计划

1. 归属：0 / 1 / ≥2 标签 → 正确子目录
2. 启动迁移：旧 `images/x.png` → 新结构，JSON `rel` 更新
3. `setTags`：单标签 ↔ 公共 双向搬迁
4. 重命名标签：文件夹名与所有 `rel` 同步
5. 删除标签：受影响任务重新归属
6. 目标文件名冲突：追加序号
7. 孤儿清理能删除子目录内未引用文件
8. 回收站任务一并迁移且不被误删
9. `taskimage` 协议仍能打开新路径图片

## 9. 非目标

- 不为多标签任务复制多份文件
- 不引入软链接或独立索引数据库
- 不改变标签数据模型（仍为任务上的 `tags: string[]`）
