const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 쪽에는 이 함수 하나만 노출. API 키나 node 기능은 절대 노출하지 않음.
contextBridge.exposeInMainWorld('api', {
  fetchAllFestivals: () => ipcRenderer.invoke('fetch-all-festivals')
});