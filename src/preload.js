const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  getAllTasks: () => ipcRenderer.invoke('tasks:getAll'),
  createTask: (data) => ipcRenderer.invoke('tasks:create', data),
  toggleStatus: (id) => ipcRenderer.invoke('tasks:toggle', id),
  updateTask: (id, data) => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  pickImages: () => ipcRenderer.invoke('image:pick'),
  pasteImage: () => ipcRenderer.invoke('image:paste'),
  readImage: (rel) => ipcRenderer.invoke('image:read', rel),
  imageUrl: (rel) => 'taskimage://local/' + rel,
});
