function tagMap() {
  const m = {};
  for (const t of tagList) m[t.id] = t.name;
  return m;
}

async function loadTags() {
  tagList = await API.getAllTags();
  ui.setTagMap(tagMap());
  renderTagFilter();
  renderNewTagSelect();
}

function renderTagList() {
  const box = $('#tagList');
  box.innerHTML = tagList.map((t) => `
    <div class="tag-row">
      <input class="tag-name" value="${ui.esc(t.name)}" data-id="${t.id}" maxlength="12" />
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
      syncAfterTagChange();
    });
  });
  box.querySelectorAll('.tag-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const t = tagList.find((x) => x.id === id);
      const ok = await showConfirm(`删除标签「${t.name}」？将从所有任务中移除。`);
      restoreTagInputFocus();
      if (!ok) return;
      const res = await API.deleteTag(id);
      if (!res.ok) { alert(res.error || '删除失败'); restoreTagInputFocus(); return; }
      tagList = res.tags;
      tagFilter = tagFilter.filter((x) => x !== id);
      ui.renderTagSelected(tagFilter);
      syncAfterTagChange();
      restoreTagInputFocus();
    });
  });
}

function restoreTagInputFocus() {
  const input = $('#tagInput');
  if (input) { input.focus({ preventScroll: false }); }
}

function syncAfterTagChange() {
  ui.setTagMap(tagMap());
  renderTagList();
  renderTagFilter();
  renderNewTagSelect();
  refresh();
}

function openTagManager() {
  renderTagList();
  $('#tagOverlay').classList.remove('hidden');
  $('#tagInput').focus();
}

document.getElementById('manTagBtn').addEventListener('click', openTagManager);
document.getElementById('tagClose').addEventListener('click', () => $('#tagOverlay').classList.add('hidden'));
$('#tagOverlay').addEventListener('click', (e) => { if (e.target.id === 'tagOverlay') $('#tagOverlay').classList.add('hidden'); });

async function addTag() {
  const input = $('#tagInput');
  try {
    const res = await API.createTag(input.value);
    if (!res || !res.ok) { alert((res && res.error) || '新增失败'); restoreTagInputFocus(); return; }
    input.value = '';
    tagList = res.tags;
    syncAfterTagChange();
    restoreTagInputFocus();
  } catch (err) {
    alert('新增失败：' + (err && err.message ? err.message : err));
    restoreTagInputFocus();
  }
}
document.getElementById('tagAddBtn').addEventListener('click', addTag);
$('#tagInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
