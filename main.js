const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('./config');

// --- 🌐 서버 연결 ---
// hub API 호출 + 번역 + Firestore 연결은 여기서 안 하고, 전부 서버(server.js, Render 배포됨)가 함.
// 이 앱은 서버에 "완성된 데이터 주세요"라고 물어보기만 함.
const SERVER_URL = config.SERVER_URL || 'http://localhost:3000';

function fetchJson(url) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    client.get(url, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`서버 응답을 해석할 수 없음: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
}

// --- ⭐ 북마크 (기기별로 파일 저장, 서버로 옮긴 것 아님) ---
function getBookmarksPath() {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}
function readBookmarks() {
  try {
    const raw = fs.readFileSync(getBookmarksPath(), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}
function writeBookmarks(list) {
  try {
    fs.writeFileSync(getBookmarksPath(), JSON.stringify(list));
  } catch (e) {
    // 저장 실패해도 앱 동작엔 지장 없음
  }
}

ipcMain.handle('get-bookmarks', () => readBookmarks());

ipcMain.handle('toggle-bookmark', (event, key) => {
  const list = readBookmarks();
  const idx = list.indexOf(key);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(key);
  }
  writeBookmarks(list);
  return list;
});

// --- 축제 데이터: 서버에 물어봐서 그대로 화면에 전달 ---
ipcMain.handle('fetch-all-festivals', async () => {
  console.log(`[main] 서버(${SERVER_URL})에 데이터 요청 중...`);
  try {
    const result = await fetchJson(`${SERVER_URL}/api/festivals`);
    console.log(`[main] ✅ 서버 응답 받음 - hub ${result.hubItems?.length || 0}건, 직접추가 ${result.extra?.length || 0}건`);
    return result;
  } catch (e) {
    console.log('[main] ❌ 서버 연결 실패:', e.message);
    return {
      hubItems: [],
      extra: [],
      errors: [`서버(${SERVER_URL})에 연결하지 못했습니다: ${e.message}`],
      debug: ''
    };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});