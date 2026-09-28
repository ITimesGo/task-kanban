function tagMap() {
  const m = {};
  for (const t of tagList) m[t.id] = t.name;
  return m;
}

/** 编辑弹窗打开时注册：({ deletedId, selectedId }) => void */
let editTagRedraw = null;
function setEditTagRedraw(fn) {
  editTagRedraw = typeof fn === 'function' ? fn : null;
}

function afterTagMutation(opts) {
  const deletedId = opts && opts.deletedId;
  const selectedId = opts && opts.selectedId;
  if (deletedId) {
    tagFilter = tagFilter.filter((x) => x !== deletedId);
    newTags = newTags.filter((x) => x !== deletedId);
  }
  if (selectedId && opts && opts.selectCreate && !newTags.includes(selectedId)) {
    newTags.push(selectedId);
  }
  ui.setTagMap(tagMap());
  renderTagList();
  renderTagFilter();
  renderNewTagSelect();
  if (editTagRedraw) {
    editTagRedraw({
      deletedId,
      selectedId: opts && opts.selectEdit ? selectedId : null,
    });
  }
  refresh();
}

async function loadTags() {
  tagList = await API.getAllTags();
  ui.setTagMap(tagMap());
  renderTagFilter();
  renderNewTagSelect();
}

/** 有任务在用则禁止删并提示；无人使用再确认删除。成功返回 { ok, tags }，否则 null */
async function confirmDeleteTag(id) {
  const t = tagList.find((x) => x.id === id);
  if (!t) return null;
  try {
    const usage = await API.countTagUsage(id);
    const count = usage && usage.ok ? Number(usage.count) || 0 : 0;
    if (count > 0) {
      alert(`标签「${t.name}」正被 ${count} 个任务使用，请先从任务上移除后再删除。`);
      return null;
    }
  } catch (err) {
    alert('无法检查标签占用：' + (err && err.message ? err.message : err));
    return null;
  }
  const ok = await showConfirm(`删除标签「${t.name}」？`);
  if (!ok) return null;
  const res = await API.deleteTag(id);
  if (!res || !res.ok) {
    alert((res && res.error) || '删除失败');
    return null;
  }
  return res;
}

function renderTagList() {
  const box = $('#tagList');
  if (!box) return;
  box.innerHTML = tagList.map((t) => `
    <div class="tag-row">
      <input class="tag-name" value="${ui.esc(t.name)}" data-id="${t.id}" maxlength="15" />
      <div class="tag-row-actions">
        <button class="tag-save" data-id="${t.id}">保存</button>
        <button class="tag-del danger" data-id="${t.id}">删除</button>
      </div>
    </div>`
  ).join('') || '<p class="hint">暂无标签</p>';
  box.querySelectorAll('.tag-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const input = box.querySelector(`.tag-name[data-id="${id}"]`);
      const res = await API.renameTag(id, input.value);
      if (!res.ok) { alert(res.error || '保存失败'); return; }
      tagList = res.tags;
      afterTagMutation();
    });
  });
  box.querySelectorAll('.tag-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const res = await confirmDeleteTag(id);
      restoreTagInputFocus();
      if (!res) return;
      tagList = res.tags;
      afterTagMutation({ deletedId: id });
      restoreTagInputFocus();
    });
  });
}

function restoreTagInputFocus() {
  const input = $('#tagInput');
  if (input) { input.focus({ preventScroll: false }); }
}

function syncAfterTagChange() {
  afterTagMutation();
}

function openTagManager() {
  renderTagList();
  $('#tagOverlay').classList.remove('hidden');
  $('#tagInput').focus();
}

document.getElementById('tagClose').addEventListener('click', () => $('#tagOverlay').classList.add('hidden'));
$('#tagOverlay').addEventListener('click', (e) => { if (e.target.id === 'tagOverlay') $('#tagOverlay').classList.add('hidden'); });

async function addTag() {
  const input = $('#tagInput');
  try {
    const res = await API.createTag(input.value);
    if (!res || !res.ok) { alert((res && res.error) || '新增失败'); restoreTagInputFocus(); return; }
    input.value = '';
    tagList = res.tags;
    afterTagMutation();
    restoreTagInputFocus();
  } catch (err) {
    alert('新增失败：' + (err && err.message ? err.message : err));
    restoreTagInputFocus();
  }
}
document.getElementById('tagAddBtn').addEventListener('click', addTag);
$('#tagInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
