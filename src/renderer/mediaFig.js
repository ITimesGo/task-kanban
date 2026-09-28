/** 解析 figure.doc-media + 右键菜单项构建（纯逻辑，可单测） */

function parseMediaFig(elLike) {
  const className = String((elLike && elLike.className) || '');
  const ds = (elLike && elLike.dataset) || {};
  const dataSrc = String(ds.src || '').trim();
  const kind = (ds.kind === 'video' || /\bdoc-video\b/.test(className)) ? 'video' : 'image';
  const isPending = dataSrc.startsWith('pending:');
  const isDataUrl = dataSrc.startsWith('data:');
  const rel = (!isPending && !isDataUrl && dataSrc) ? dataSrc.replace(/^\/+/, '').replace(/\\/g, '/') : '';
  return {
    kind,
    dataSrc,
    isPending,
    isDataUrl,
    rel: rel || undefined,
    pendingIndex: isPending ? Number(dataSrc.slice('pending:'.length)) : undefined,
  };
}

/**
 * @param {{ kind: string, hasLocalPath: boolean, hasDataUrl?: boolean, canDelete?: boolean }} opts
 */
function buildMediaMenuItems(opts) {
  const kind = opts && opts.kind === 'video' ? 'video' : 'image';
  const hasLocalPath = !!(opts && opts.hasLocalPath);
  const hasDataUrl = !!(opts && opts.hasDataUrl);
  const canDelete = !!(opts && opts.canDelete);
  const noLocalTitle = '无本地文件';

  const copyDisabled = kind === 'video' && !hasLocalPath;
  const saveDisabled = kind === 'video'
    ? !hasLocalPath
    : !(hasLocalPath || hasDataUrl);
  const openDisabled = !hasLocalPath;

  const items = [
    {
      id: 'copy',
      label: '复制',
      disabled: copyDisabled,
      title: copyDisabled ? noLocalTitle : '',
    },
    {
      id: 'saveAs',
      label: '另存为…',
      disabled: saveDisabled,
      title: saveDisabled ? noLocalTitle : '',
    },
    {
      id: 'open',
      label: '在外部打开',
      disabled: openDisabled,
      title: openDisabled ? noLocalTitle : '',
    },
    {
      id: 'showInFolder',
      label: '打开所在文件夹',
      disabled: openDisabled,
      title: openDisabled ? noLocalTitle : '',
    },
  ];
  if (canDelete) {
    items.push({ id: 'delete', label: '删除', disabled: false, title: '' });
  }
  return items;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseMediaFig, buildMediaMenuItems };
}
if (typeof window !== 'undefined') {
  window.parseMediaFig = parseMediaFig;
  window.buildMediaMenuItems = buildMediaMenuItems;
}
