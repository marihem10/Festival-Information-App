const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const config = require('./config');
const curatedFestivals = require('./curatedFestivals');
const extraFestivals = require('./extraFestivals');

// 매번 74건씩 다시 조회하면 느리니까, 결과를 파일로 저장해뒀다가
// 일정 시간 안에 다시 열면 그걸 바로 씀 (3시간 지나면 다시 살아있는 데이터로 갱신)
// CACHE_SCHEMA_VERSION: 코드가 바뀌어서 캐시 구조/내용이 달라질 때마다 이 숫자를 올리면
// 예전 캐시는 자동으로 무시되고 새로 받아옴 (인코딩 버그 수정 등 반영 시 필요)
const CACHE_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
function getCachePath() {
  return path.join(app.getPath('userData'), 'hub-cache.json');
}
function readCache() {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    const cache = JSON.parse(raw);
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null; // 예전 버전 캐시는 버림
    if (Date.now() - cache.savedAt < CACHE_TTL_MS) return cache.hubItems;
  } catch (e) {
    // 캐시 없거나 깨졌으면 그냥 새로 받아옴
  }
  return null;
}
function writeCache(hubItems) {
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      hubItems
    }));
  } catch (e) {
    // 저장 실패해도 앱 동작엔 지장 없음
  }
}

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
  //win.webContents.openDevTools();
}

// --- ① 한국관광콘텐츠랩(api.visitkorea.or.kr) 내부 통합검색 API ---
// ⚠️ 공식 문서화된 API는 아니지만, 목록 조회(getTourDbInfo.do)는 세션 없이도 잘 동작해서
// 그냥 순수 https 요청으로 충분함 (숨은 브라우저 창은 필요 없었음 - 그건 상세정보 때문이었는데
// 상세정보는 이제 공식 API인 detailIntro2로 대체함).
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
        res.setEncoding('utf8'); // 한글/일본어 같은 멀티바이트 문자가 청크 경계에서 깨지는 것 방지
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
    if (items.length < PAGE_SIZE) break;
    pageNo += 1;
    if (pageNo > 10) break;
  }

  return allItems;
}

// getUseInfo.do: contentId 하나당 이용안내(날짜/장소/프로그램 등) 상세정보를 줌.
// ⚠️ 시도해봤지만 세션/보안 절차 때문에 계속 빈 값만 옴 (진짜 브라우저로도 안 됨).
// 대신 한국관광공사가 "공식 문서화"해둔 동일 계열 API인 detailIntro2를 사용함.
// 이건 apis.data.go.kr을 쓰는 정식 API라 세션/쿠키 문제 자체가 없음.
// (hub 사이트도 결국 이 공식 데이터를 내부적으로 가져다 쓰는 걸로 보임)
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      res.setEncoding('utf8'); // 멀티바이트 문자 깨짐 방지
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchDetailIntro(contentId) {
  const key = encodeURIComponent(config.DATA_GO_KR_API_KEY);
  const url =
    `https://apis.data.go.kr/B551011/KorService2/detailIntro2` +
    `?serviceKey=${key}&MobileOS=ETC&MobileApp=BusanNavi&_type=json` +
    `&contentId=${contentId}&contentTypeId=15`;

  const raw = await httpsGetJson(url);
  try {
    const data = JSON.parse(raw);
    const item = data.response?.body?.items?.item;
    const record = Array.isArray(item) ? item[0] : item;
    return { data: record || null, raw };
  } catch (e) {
    return { data: null, raw };
  }
}

async function enrichWithDates(items, concurrency = 15) {
  const queue = [...items];
  const results = [];
  let sampleRaw = null;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        const { data, raw } = await fetchDetailIntro(item.contentId);
        if (!data?.eventstartdate && !sampleRaw) sampleRaw = raw;
        results.push({
          ...item,
          eventStartDate: data?.eventstartdate || '',
          eventEndDate: data?.eventenddate || '',
          eventPlace: data?.eventplace || '',
          playTime: data?.playtime || '',
          program: data?.program || '',
          subEvent: data?.subevent || '',
          sponsor1: data?.sponsor1 || '',
          sponsor1Tel: data?.sponsor1tel || '',
          sponsor2: data?.sponsor2 || '',
          ageLimit: data?.agelimit || '',
          bookingPlace: data?.bookingplace || '',
          discountInfo: data?.discountinfofestival || '',
          placeInfo: data?.placeinfo || '',
          progressType: data?.progresstype || '',
          spendTime: data?.spendtime || '',
          useFee: data?.usetimefestival || ''
        });
      } catch (e) {
        results.push(item);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const successCount = results.filter((r) => r.eventStartDate).length;
  const debugMsg = `detailIntro2 날짜 확보: ${successCount}/${results.length}건`;
  console.log(`[main] ${debugMsg}`);
  if (sampleRaw) console.log('[main] 날짜 없는 샘플 원본 응답:', sampleRaw.slice(0, 300));

  return { items: results, debug: debugMsg, sampleRaw: sampleRaw ? sampleRaw.slice(0, 300) : '' };
}


// --- ⭐ 북마크 저장 (앱 재시작해도 유지되도록 파일로 저장) ---
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

// --- hub API(목록+이미지) + detailIntro2(공식, 날짜) 조합만 사용 ---
ipcMain.handle('fetch-all-festivals', async () => {
  const result = {
    hubItems: [],
    curated: curatedFestivals,
    extra: extraFestivals,
    errors: [],
    debug: ''
  };

  const cached = readCache();
  if (cached) {
    result.hubItems = cached;
    result.debug = `캐시 사용 (${cached.length}건) - 새로고침하려면 3시간 기다리거나 캐시 파일 삭제`;
    return result;
  }

  try {
    const rawHubItems = await fetchHubEvents();
    const { items, debug, sampleRaw } = await enrichWithDates(rawHubItems);
    result.hubItems = items;
    result.debug = debug + (sampleRaw ? ` | 샘플: ${sampleRaw}` : '');
    writeCache(items);
  } catch (e) {
    result.errors.push(`hub 검색 실패: ${e.message}`);
  }

  return result;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});