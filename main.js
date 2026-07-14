const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('./config');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // 🔧 디버깅 편의를 위해 개발자도구를 자동으로 엽니다.
  // (문제 다 해결되면 이 줄은 지우거나 주석 처리하세요 - 배포용 앱엔 필요 없음)
  win.webContents.openDevTools();
}

function getRaw(url) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// 가이드 문서상 서비스 URL은 http://apis.data.go.kr/... 인데,
// 최근엔 https도 대부분 지원함. https로 먼저 시도하고, 응답이 비어있으면 http로 재시도.
async function getRawWithFallback(httpsUrl, httpUrl) {
  const viaHttps = await getRaw(httpsUrl).catch(() => '');
  if (viaHttps && viaHttps.trim().length > 0) return viaHttps;
  return getRaw(httpUrl);
}

// --- 부산광역시_부산축제정보 서비스 (getFestivalKr / getFestivalJa) ---
// ⚠️ 이 API는 TourAPI와 다름: 성공 코드가 "00"이고, JSON을 받으려면 resultType=json이 필요함
//    (type=json이 아님!). 문서: OpenAPI활용가이드_부산시공공데이터_부산축제정보서비스
function parseBusanPage(rawText) {
  if (!rawText || !rawText.trim().startsWith('{')) {
    throw new Error(`JSON이 아닌 응답: ${String(rawText).slice(0, 300)}`);
  }
  const data = JSON.parse(rawText);

  // 실제 구조: { "getFestivalJa": { header: { code, message }, item: [...], totalCount } }
  // (TourAPI의 response.header/body 구조와 다름 - 최상위 키가 오퍼레이션명 그 자체)
  const opKey = Object.keys(data)[0];
  const obj = opKey ? data[opKey] : null;

  if (!obj || !obj.header) {
    throw new Error(
      `예상치 못한 응답 구조. 최상위 키: [${Object.keys(data).join(', ')}]\n` +
      `원본 일부: ${rawText.slice(0, 500)}`
    );
  }

  const code = obj.header.code;
  const message = obj.header.message;
  if (code !== '00') {
    throw new Error(`오류코드 ${code}: ${message}`);
  }

  let items = obj.item;
  if (items && !Array.isArray(items)) items = [items];

  return {
    items: items || [],
    totalCount: Number(obj.totalCount || (items ? items.length : 0))
  };
}

async function fetchBusanAllPages(operation) {
  const MAX_PAGES = 5;
  const key = encodeURIComponent(config.DATA_GO_KR_API_KEY);
  let pageNo = 1;
  let allItems = [];
  let totalCount = 0;

  while (pageNo <= MAX_PAGES) {
    const query = `serviceKey=${key}&numOfRows=100&pageNo=${pageNo}&resultType=json`;
    const httpsUrl = `https://apis.data.go.kr/6260000/FestivalService/${operation}?${query}`;
    const httpUrl = `http://apis.data.go.kr/6260000/FestivalService/${operation}?${query}`;

    const rawText = await getRawWithFallback(httpsUrl, httpUrl);
    const { items, totalCount: tc } = parseBusanPage(rawText);
    totalCount = tc;
    allItems = allItems.concat(items);

    if (allItems.length >= totalCount || items.length === 0) break;
    pageNo += 1;
  }

  return { items: allItems, totalCount };
}

ipcMain.handle('fetch-all-festivals', async () => {
  const result = {
    ja: { items: [], totalCount: 0, error: null }, // 부산시 공식 일본어 축제 정보
    kr: { items: [], totalCount: 0, error: null }  // 부산시 국문 축제 정보 (누락 필드 보완용)
  };

  try {
    const { items, totalCount } = await fetchBusanAllPages('getFestivalJa');
    result.ja.items = items;
    result.ja.totalCount = totalCount;
  } catch (e) {
    result.ja.error = `부산시 일문 서비스: ${e.message}`;
  }

  try {
    const { items, totalCount } = await fetchBusanAllPages('getFestivalKr');
    result.kr.items = items;
    result.kr.totalCount = totalCount;
  } catch (e) {
    result.kr.error = `부산시 국문 서비스: ${e.message}`;
  }

  return result;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});