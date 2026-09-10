// 渲染层共享状态（各模块脚本共享同一全局作用域）
let tasks = [];
let filter = 'pending';
let range = 'all';
let page = 1;
let pageSize = 50;
/** 待建任务媒体：{ kind:'image'|'video', value: dataUrl|{srcPath}|rel } */
let newMedia = [];
let newTags = [];
let newAttachments = []; // {path,name}
let tagFilter = [];
let tagList = [];
let editing = null;
let newTagExpanded = false;
let detailState = { mode: 'view', dataUrl: [] };
let searchQuery = '';
let sortKey = 'createdAt'; // createdAt | statusAt | updatedAt
let filtersExpanded = false; // 二级筛选（排序/时间/搜索）默认收起

const MAX_NEW_IMAGES = 10;
const MAX_NEW_VIDEOS = 3;
const MAX_VIDEO_MB = 200;

function newMediaCounts() {
  let images = 0;
  let videos = 0;
  for (const m of newMedia) {
    if (m && m.kind === 'video') videos += 1;
    else images += 1;
  }
  return { images, videos };
}