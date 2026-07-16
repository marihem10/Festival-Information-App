const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 쪽에는 필요한 함수만 노출. API 키나 node 기능은 절대 노출하지 않음.
contextBridge.exposeInMainWorld('api', {
  fetchAllFestivals: () => ipcRenderer.invoke('fetch-all-festivals'),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  toggleBookmark: (key) => ipcRenderer.invoke('toggle-bookmark', key),
  onFetchProgress: (callback) => {
    ipcRenderer.on('fetch-progress', (event, data) => callback(data));
  }
});