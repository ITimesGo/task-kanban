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

### 3.1 归属与路径 API

```js
// 仅返回子目录名（不含 images/attachments 前缀）
subdirFor(tags, tagList) → '公共' | '{sanitize(name)}_{id8}'
// id8 = tag.id.replace(/-/g, '').slice(0, 8)
// 条件：tags.length === 1 且该 id 在 tagList 中存在；否则 '公共'

relFor(kind, subdir, filename) → `${kind}/${subdir}/${filename}`
// kind ∈ {'images','attachments'}；一律使用 POSIX `/`，禁止反斜杠写入 JSON
```

### 3.2 命名规则

- **sanitize(标签名)**：去除 `\ / : * ? " < > |`，连续空白压成 `_`，trim；若结果为空则用 `tag`
- **短 id**：`id.replace(/-/g,'').slice(0,8)`
- **公共**：字面量 `公共`，无 id 后缀
- **图片文件名**：`{taskId}_{index}.{ext}`（`index` 为非负整数）
- **附件文件名**：原名；同目标目录重名时按 §3.3 冲突规则追加序号
- **所有新写入或更新的 `rel`**：相对 `appDataDir` 的 POSIX 路径（始终 `/`）

相对路径示例：

- `images/公共/abc_0.png`
- `images/工作_a1b2c3d4/abc_1.jpg`
- `attachments/公共/报告.pdf`

### 3.3 统一冲突命名（所有搬迁与写入共用）

目标路径已存在时：**永不覆盖**。在扩展名前插入 `_{n}`（n 从 1 递增）：

- `report.pdf` → `report_1.pdf` → `report_2.pdf`
- `abc_0.png` → `abc_0_1.png` → `abc_0_2.png`

图片序号分配（update 时找空闲 index）必须只解析 `path.basename(rel)`，并用正则匹配：

```
^{taskId}_(\d+)(?:_\d+)?\.[^.]+$
```

捕获组 1 为逻辑 index；可选的 `(?:_\d+)?` 覆盖冲突后缀（如 `abc_0_1.png` → index `0`）。禁止对整段 `rel` 做 `split('_').pop()`。

### 3.4 核心搬迁原语

```js
// 将单个文件移到目标 rel；成功才返回最终 rel（可能因冲突改名）
safeMove(absFrom, absToPreferred) → finalAbs

// 按任务当前 tags 把该任务全部 images + attachments 迁到 subdirFor 目标；
// 每文件：成功才改该条 rel / {name,rel}；失败则保留旧 rel，继续其余文件
moveMediaForTask(task, tagList) → task

// 对 tasks + trash 全量跑 moveMediaForTask；有变更则各写盘一次
migrateMediaLayout() → { moved, errors }
```

## 4. 行为规格

### 4.1 写入时的标签来源

`copyImage` / `copyImageFromPath` / `copyAttachment` / `ingestImage` **不从磁盘猜 tags**，由调用方显式传入：

```js
copyImage(dataUrl, taskId, index, { tags })
copyImageFromPath(srcPath, taskId, index, { tags })
copyAttachment(srcPath, taskId, origName, { tags })
ingestImage(item, taskId, index, { tags })
```

用 `subdirFor(tags, loadTags())` 决定落盘子目录。

### 4.1.1 与现有两阶段 UI 的正确性约定

当前 UI 常见顺序：

1. 创建：先落盘图片/附件 → 再 `setTaskTags`
2. 详情：先 `updateTask`（可能含新图）→ 再 `setTaskTags`

因此允许：**新文件先落到「写入时传入的 tags」对应目录**（可能是改标签前的旧归属）。  
**`setTags` / 保存后的 `moveMediaForTask` 必须搬迁该任务全部图片+附件**（含刚写入的文件）到最终归属。实现上 `tasks:setTags` 与详情保存路径在 tags 落盘后一律调用 `moveMediaForTask`。

推荐（非必须）：create IPC 支持一并传入 `tags`，写入即用最终目录，减少一次搬迁。

### 4.2 启动幂等迁移

应用启动（`FileStore` 就绪后、对外服务 IPC 前）调用 `migrateMediaLayout()`：

1. 对 `tasks` + `trash` 中每个任务：`moveMediaForTask`
2. 有任何 `rel` 变更 → 各保存一次 tasks / trash
3. 删除**空的**子目录（仅 rmdir 空目录；不删有文件的目录）

**迁移只搬 tasks+trash 引用到的文件。** 未被引用的散落文件（含旧平铺根下孤儿）**保留**，交给 `cleanupOrphans`。迁移不得删除未引用文件。

迁移必须幂等：重复启动结果不变。

### 4.3 标签变更自动搬迁

所有自动搬迁（migrate / setTags / delete 后重归户）共用 §3.3 冲突规则与 §3.4 原语。

| 触发 | 行为 |
|---|---|
| `tasks:setTags` | 更新任务 tags 并写盘 → `moveMediaForTask` → 若 rel 变则再 saveTasks |
| 详情编辑改标签并保存 | tags 落盘后同样调用 `moveMediaForTask` |
| `tags:rename` | 见 §4.3.1 |
| `tags:delete` | 见 §4.3.2 |

目标子目录与当前相同 → `moveMediaForTask` 对每文件 no-op。

#### 4.3.1 `tags:rename`

1. 计算 `oldSub = subdirFor([id], tagsBefore)` 与 `newSub = subdirFor([id], tagsAfter)`  
2. 若 `oldSub === newSub`（例如仅改大小写但 sanitize 后相同，或未改名段）→ **磁盘与 JSON 均不动**
3. 否则对 `kind ∈ {images, attachments}`：
   - 若 `kind/newSub` **不存在**：`rename(kind/oldSub → kind/newSub)`
   - 若 `kind/newSub` **已存在**：将 `oldSub` 内每个文件 `safeMove` 进 `newSub`（冲突按 §3.3），然后删除空的 `oldSub`
4. **原子性偏好**：先完成 images 与 attachments 两侧磁盘操作；**两侧都成功后**，再批量把 tasks/trash 中 `rel` 前缀 `kind/oldSub/` 替换为 `kind/newSub/`（若 merge 时个别文件因冲突改名，对该文件用最终 basename）
5. 若任一侧失败：**必须先把磁盘恢复到操作前布局，再向调用方返回错误，且不改 JSON `rel`**：
   - 整夹 `rename` 已成功的一侧 → `rename` 回 `oldSub`
   - merge 路径已 `safeMove` 进 `newSub` 的文件 → 逐个 `safeMove` 回 `oldSub`（冲突仍按 §3.3）；恢复完成后再报错
   - 若回滚本身失败：记录严重错误；此时允许按「磁盘实际位置」改写受影响 `rel` 以免断链（兜底，应有测试覆盖尽力回滚的主路径）

#### 4.3.2 `tags:delete`

1. 从所有 tasks + trash 中 strip 该 tag id，保存 tags / tasks / trash
2. 对**每一个曾包含该 deletedId** 的任务/回收站项调用 `moveMediaForTask`（归属未变则 no-op；例如 3→2 仍在 `公共/`，2→1 则从 `公共/` 迁入剩余单标签目录）
3. 若该标签对应的 `images/{oldSub}`、`attachments/{oldSub}` 已空则删除空目录

不要用「标签数量是否变化」作为是否搬迁的条件，只用「`subdirFor` 结果是否变化」。

### 4.4 删除任务 / 删除文件

仍按 `rel` 删除物理文件；逻辑不变。

### 4.5 协议与 UI

`taskimage://local/{rel}` 继续按完整相对路径解析；renderer 展示仍用 `API.imageUrl(rel)`。

## 5. 错误处理

- 单文件搬迁失败：保留该文件原 `rel`，记录错误，继续处理其余文件
- 跨设备 `rename` 失败：回退 copy + unlink
- sanitize 后空名：使用 `tag`
- 只有搬成功才改该条 `rel`；不因其他文件失败回滚已成功条目
- `tags:rename` 整夹操作失败时优先回滚文件夹名，且失败则不改 JSON（§4.3.1）

## 6. 兼容与清理

### 6.1 孤儿清理

`cleanupOrphans` 递归遍历 `images/**`、`attachments/**`（只处理文件），用完整 `rel`（POSIX `/`）与 tasks+trash 引用比对后删除未引用文件；随后删除因此变空的目录。

### 6.2 备份 / 导入 / 换存储目录

- 导出 zip：按当前磁盘结构与 `rel` 原样打包
- 导入旧平铺包：解压后走 `migrateMediaLayout` 即可对齐
- 换存储目录：整目录拷贝后启动迁移（幂等）

## 7. 主要改动面

| 模块 | 变更 |
|---|---|
| `fileStore.js` | `subdirFor` / `relFor` / `safeMove` / `moveMediaForTask` / `migrateMediaLayout`；copy* 增加 `{ tags }` |
| `main.js` | 启动迁移；create/update/setTags/rename/delete 传入 tags 并钩子搬迁；图片 index 分配改 basename 正则 |
| `tags.js` / IPC | rename/delete 按 §4.3 |
| `cleanupOrphans.js` | 递归扫描 |
| `create.js` / `detail.js` | 写入时传入当前选择的 tags；保存后依赖 setTags/move 校正 |
| 测试 | 归属、迁移、冲突改名、rename 回滚、delete 后 2→1、孤儿子目录、index 分配 |

## 8. 测试计划

1. 归属：0 / 1 / ≥2 标签 → 正确子目录
2. 启动迁移：旧 `images/x.png` → 新结构，JSON `rel` 更新；未引用散落文件不被迁移删除
3. `setTags`：单标签 ↔ 公共 双向搬迁；含刚写入文件
4. 重命名标签：文件夹名与所有 `rel` 同步；目标目录已存在时 merge；一侧失败不改 JSON
5. sanitize 后文件夹名不变时 rename no-op
6. 删除标签：曾含该 id 的任务重算归属（含 2→1 离开公共）
7. 目标文件名冲突：追加 `_n`；随后再添加图片时 index 不冲突
8. 孤儿清理能删除子目录内未引用文件
9. 回收站任务一并迁移且不被误删
10. `taskimage` 协议仍能打开新路径图片

## 9. 非目标

- 不为多标签任务复制多份文件
- 不引入软链接或独立索引数据库
- 不改变标签数据模型（仍为任务上的 `tags: string[]`）
