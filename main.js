const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const config = require('./config');
const curatedFestivals = require('./curatedFestivals');
const extraFestivals = require('./extraFestivals');

// 매번 74건씩 다시 조회하면 느리니까, 결과를 파일로 저장해뒀다가
// 일정 시간 안에 다시 열면 그걸 바로 씀 (3시간 지나면 다시 살아있는 데이터로 갱신)
// CACHE_SCHEMA_VERSION: 코드가 바뀌어서 캐시 구조/내용이 달라질 때마다 이 숫자를 올리면
// 예전 캐시는 자동으로 무시되고 새로 받아옴
const CACHE_SCHEMA_VERSION = 6; // orig_*(원문) 필드 누락된 예전 캐시 무효화
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
    show: false, // 첫 페인트 전 빈 화면 깜빡임 방지 - ready-to-show에서 보여줌
    icon: path.join(__dirname, 'logo.png'), // 작업표시줄/창 아이콘
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // target="_blank" 링크(공식 사이트 버튼 등)는 Electron 안의 미니 창이 아니라
  // 사용자의 진짜 기본 브라우저(크롬 등)로 열리게 함 - 미니 창은 쿠키/세션이 달라서
  // 일부 사이트에서 버튼이 안 눌리는 문제가 있었음.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 스플래시는 별도 창이 아니라 index.html 안의 오버레이로 처리함 (renderer.js 참고).
  // 창은 하나뿐이라 여러 창 타이밍을 맞출 필요 없이, 그냥 준비되면 최대화해서 보여주면 됨.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // 🔧 디버깅 편의를 위해 개발자도구를 자동으로 엽니다.
  //win.webContents.openDevTools();
}

// --- ① 한국관광콘텐츠랩(api.visitkorea.or.kr) 내부 통합검색 API ---
// ⚠️ 일본어(JPN)로 요청하면 번역 안 된 콘텐츠가 통째로 빠져서 건수가 확 줄어듦.
// 그래서 국문(KOR)으로 데이터는 다 받고, 화면에 보여줄 텍스트만 별도로 자동번역함.
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

// 한국관광공사가 공식 문서화해둔 detailIntro2(국문)로 날짜/장소/프로그램 등 상세정보를 받아옴.
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

async function enrichWithDates(items, concurrency = 15, onProgress) {
  const total = items.length;
  let done = 0;
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
      done += 1;
      if (onProgress) onProgress(done, total);
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

// --- 🌐 자동번역 (한국어 → 일본어) ---
// DeepL을 우선 사용 (품질 좋음, deepl.com에서 무료 API 키 발급).
// 키가 없으면 자동으로 구글 번역(비공식, 품질은 낮지만 키 필요 없음)으로 대체 동작함.
const TRANSLATABLE_FIELDS = [
  'title', 'outl', 'addr1', 'cat1Nm', 'cat2Nm', 'eventPlace',
  'playTime', 'program', 'subEvent', 'sponsor1', 'sponsor2',
  'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'progressType', 'useFee'
];

// DeepL은 text를 배열로 그대로 보내면, 번역 결과도 정확히 같은 순서/개수로 돌려줌
// (구글 때처럼 구분자로 합쳤다가 다시 쪼개는 불안정한 트릭이 필요 없음).
function deeplRequest(hostname, texts) {
  const body = JSON.stringify({ text: texts, source_lang: 'KO', target_lang: 'JA' });
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: '/v2/translate', method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${config.DEEPL_API_KEY.trim()}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 무료 키는 보통 api-free.deepl.com + ":fx" 접미사를 쓰지만, 계정에 따라
// api.deepl.com 이 맞는 경우도 있어서 첫 실패 시 자동으로 다른 쪽도 시도해봄.
let deeplHostOverride = null;
async function deeplTranslateBatch(texts) {
  const hostsToTry = deeplHostOverride
    ? [deeplHostOverride]
    : ['api-free.deepl.com', 'api.deepl.com'];

  let lastResult = null;
  for (const host of hostsToTry) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deeplRequest(host, texts);
    if (result.status === 200) {
      deeplHostOverride = host; // 다음번엔 바로 이 호스트로 (매번 두 번 시도 안 하게)
      return result.body;
    }
    lastResult = result;
  }
  throw new Error(`DeepL 인증/요청 실패 (status=${lastResult?.status}): ${lastResult?.body?.slice(0, 200)}`);
}

async function googleTranslateOne(text) {
  if (!text || !text.trim()) return text || '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const raw = await httpsGetJson(url);
    const data = JSON.parse(raw);
    return data[0].map((seg) => seg[0]).join('');
  } catch (e) {
    return text;
  }
}

// 모든 항목의 모든 번역 대상 필드를 하나의 평평한 목록으로 모아서, DeepL에 청크 단위로 보냄
async function translateItemsToJapanese(items, onProgress) {
  const useDeepL = Boolean(config.DEEPL_API_KEY && config.DEEPL_API_KEY.trim());
  if (useDeepL) {
    const k = config.DEEPL_API_KEY.trim();
    console.log(`[main] DeepL 키 확인: 길이=${k.length}, 앞4자=${k.slice(0, 4)}, 뒤4자=${k.slice(-4)}, ':fx'로 끝남=${k.endsWith(':fx')}`);
  }

  const flatTexts = [];
  const indexMap = []; // [{itemIdx, field}]
  items.forEach((item, itemIdx) => {
    TRANSLATABLE_FIELDS.forEach((field) => {
      const val = item[field];
      if (val && val.trim()) {
        flatTexts.push(val);
        indexMap.push({ itemIdx, field });
      }
    });
  });

  const results = items.map((item) => ({ ...item }));

  // 번역하기 전에 원문(한국어)을 orig_* 필드로 따로 보관해둠 - 상세페이지 "원문 보기" 토글용
  TRANSLATABLE_FIELDS.forEach((field) => {
    results.forEach((r) => {
      r[`orig_${field}`] = r[field] || '';
    });
  });

  if (flatTexts.length === 0) return { items: results, allFailed: false };

  let failCount = 0;
  const totalTexts = flatTexts.length;
  let doneTexts = 0;

  if (useDeepL) {
    const CHUNK = 50;
    for (let i = 0; i < flatTexts.length; i += CHUNK) {
      const chunk = flatTexts.slice(i, i + CHUNK);
      const chunkMap = indexMap.slice(i, i + CHUNK);
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await deeplTranslateBatch(chunk);
        const data = JSON.parse(raw);
        if (!data.translations) throw new Error(raw.slice(0, 200));
        data.translations.forEach((t, j) => {
          const { itemIdx, field } = chunkMap[j];
          results[itemIdx][field] = t.text;
        });
      } catch (e) {
        console.log('[main] DeepL 번역 실패, 이 묶음은 원문 유지:', e.message);
        failCount += chunk.length;
      }
      doneTexts += chunk.length;
      if (onProgress) onProgress(doneTexts, totalTexts);
    }
  } else {
    console.log('[main] DEEPL_API_KEY 없음 - 구글 번역(비공식)으로 대체');
    const concurrency = 8;
    const queue = [...Array(flatTexts.length).keys()];
    async function worker() {
      while (queue.length > 0) {
        const i = queue.shift();
        const { itemIdx, field } = indexMap[i];
        // eslint-disable-next-line no-await-in-loop
        const translated = await googleTranslateOne(flatTexts[i]);
        if (translated === flatTexts[i]) failCount += 1;
        results[itemIdx][field] = translated;
        doneTexts += 1;
        if (onProgress) onProgress(doneTexts, totalTexts);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  console.log(`[main] 자동번역 완료: 텍스트 ${flatTexts.length}개 중 실패(원문유지) ${failCount}개 (엔진: ${useDeepL ? 'DeepL' : 'Google(비공식)'})`);
  const allFailed = failCount > 0 && failCount === flatTexts.length;
  return { items: results, allFailed };
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

// --- hub API(국문, 목록+이미지) + detailIntro2(국문, 날짜) + 자동번역(일본어) ---
ipcMain.handle('fetch-all-festivals', async (event) => {
  const sendProgress = (stage, current, total) => {
    event.sender.send('fetch-progress', { stage, current, total });
  };

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
    sendProgress('list', 0, 0);
    const rawHubItems = await fetchHubEvents();
    const { items, debug, sampleRaw } = await enrichWithDates(rawHubItems, 15, (done, total) => {
      sendProgress('detail', done, total);
    });
    const { items: translatedItems, allFailed } = await translateItemsToJapanese(items, (done, total) => {
      sendProgress('translate', done, total);
    });
    result.hubItems = translatedItems;
    result.debug = debug + (sampleRaw ? ` | 샘플: ${sampleRaw}` : '') + (allFailed ? ' | ⚠️ 번역 전부 실패(원문 표시중)' : '');
    if (!allFailed) {
      writeCache(translatedItems);
    } else {
      console.log('[main] 번역이 전부 실패해서 이번 결과는 캐시에 저장하지 않음 (다음 실행 때 재시도)');
    }
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