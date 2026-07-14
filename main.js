const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

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
  win.webContents.openDevTools();
}

// 한국관광콘텐츠랩(api.visitkorea.or.kr)의 "관광 콘텐츠 통합검색" 내부 API.
// ⚠️ 공식 문서화된 API가 아니라 그 사이트 자체가 화면을 그리는 데 쓰는 내부 API라서,
//    예고 없이 구조가 바뀌거나 막힐 수 있음 (festivalbusan.com 스크래핑과 같은 리스크 등급).
function postJson(url, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Origin': 'https://api.visitkorea.or.kr',
          'Referer': 'https://api.visitkorea.or.kr/'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// areaCd:"26" = 이 hub 내부에서 쓰는 부산 지역코드 (TourAPI의 areaCode=6과는 다른 체계 - 화면에서 직접 확인함)
// cat1:"EV" = 축제/공연/행사 대분류, cat2: EV01/EV02/EV03 = 그 소분류 전체
async function fetchHubEvents() {
  const url = 'https://api.visitkorea.or.kr/hub/getTourDbInfo.do';
  const PAGE_SIZE = 100;
  let pageNo = 1;
  let allItems = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const payload = {
      type: 'cat',
      lang: 'KOR',
      cat1: ['EV'],
      cat2: ['EV01', 'EV02', 'EV03'],
      cat3: [],
      areaCd: ['26'],
      arrange: 'NEW',
      awardYear: [],
      fromDetail: false,
      langDiv: 'KOR',
      mainYn: 'N',
      nuri: [],
      pageCnt: 1,
      pageNo,
      photo1: [],
      photo2: [],
      searchCnt: PAGE_SIZE,
      searchStart: (pageNo - 1) * PAGE_SIZE,
      sigunguCd: [],
      title: ''
    };

    // eslint-disable-next-line no-await-in-loop
    const raw = await postJson(url, payload);
    let items;
    try {
      items = JSON.parse(raw);
    } catch (e) {
      throw new Error(`JSON 파싱 실패: ${raw.slice(0, 300)}`);
    }
    if (!Array.isArray(items)) {
      throw new Error(`배열이 아닌 응답: ${raw.slice(0, 300)}`);
    }

    allItems = allItems.concat(items);
    if (items.length < PAGE_SIZE) break; // 마지막 페이지
    pageNo += 1;
    if (pageNo > 10) break; // 안전장치 (최대 1000건)
  }

  return allItems;
}

ipcMain.handle('fetch-all-festivals', async () => {
  const result = { items: [], error: null };
  try {
    result.items = await fetchHubEvents();
  } catch (e) {
    result.error = `hub 검색 실패: ${e.message}`;
  }
  return result;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});