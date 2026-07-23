const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const config = require('./config');
const extraFestivals = require('./extraFestivals'); // Firestore 연결 실패 시 대체용(fallback)으로 계속 씀

// --- 🔥 Firestore (직접추가 축제를 코드 대신 데이터베이스에서 관리) ---
// ⚠️ 여기서는 "읽기 전용" 클라이언트 SDK만 사용함 (관리자 키는 절대 앱에 포함하지 않음).
// firebaseConfig 값은 공개돼도 되는 값 - 실제 보안은 Firestore 콘솔의 보안규칙이 담당함
// (festivals 컬렉션은 누구나 읽기만 가능, 쓰기는 전부 차단하도록 설정해둔 상태여야 함).
let firestoreDb = null;
try {
  const { initializeApp } = require('firebase/app');
  const { getFirestore } = require('firebase/firestore');
  const fbApp = initializeApp(config.firebaseConfig);
  firestoreDb = getFirestore(fbApp);
  console.log('[main] Firestore(읽기 전용) 연결 성공');
} catch (e) {
  console.log('[main] Firestore 연결 안 됨 - extraFestivals.js로 대체:', e.message);
}

async function fetchFirestoreFestivals() {
  if (!firestoreDb) return null;
  const { collection, getDocs } = require('firebase/firestore');

  const snapshot = await getDocs(collection(firestoreDb, 'festivals'));
  return snapshot.docs.map((doc) => doc.data());
}

// hub API 자체가 안 될 때를 위한 최후의 대비책 - 가끔 snapshot-to-firestore.js를 돌려서
// 저장해둔 hub 데이터의 스냅샷(사본)을 읽어옴. 로컬 캐시(readCache)도 없을 때만 씀.
async function fetchFirestoreHubSnapshot() {
  if (!firestoreDb) return null;
  const { collection, getDocs } = require('firebase/firestore');

  const snapshot = await getDocs(collection(firestoreDb, 'hub_snapshot'));
  return snapshot.docs.map((doc) => doc.data());
}

// --- 📖 kuromoji (한자 제목의 읽는 법을 자동으로 추론 - "한자↔요미가나" 검색용) ---
// ⚠️ 사전에 없는 고유명사(축제명 등)는 정확도가 떨어질 수 있음. 실패해도 검색 자체는
// (가타카나↔히라가나 통일 기능으로) 계속 작동하니 여기서 실패해도 앱은 안 죽음.
let kuromojiTokenizer = null;
let kuromojiInitPromise = null;

function initKuromoji() {
  if (kuromojiInitPromise) return kuromojiInitPromise;
  kuromojiInitPromise = new Promise((resolve) => {
    try {
      const kuromoji = require('kuromoji');
      const dicPath = path.join(__dirname, 'node_modules', 'kuromoji', 'dict');
      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) {
          console.log('[main] kuromoji 사전 로드 실패 - 한자→요미가나 자동변환 없이 진행:', err.message);
          resolve(null);
          return;
        }
        kuromojiTokenizer = tokenizer;
        console.log('[main] kuromoji 사전 로드 성공');
        resolve(tokenizer);
      });
    } catch (e) {
      console.log('[main] kuromoji 모듈 로드 실패 - 한자→요미가나 자동변환 없이 진행:', e.message);
      resolve(null);
    }
  });
  return kuromojiInitPromise;
}

// 일본어(한자 섞인) 텍스트를 넣으면 읽는 법(가타카나)을 이어붙여서 돌려줌.
// 사전에 없는 단어는 형태소 분석이 부정확할 수 있어서, 참고용 검색 보조 데이터로만 사용함.
function getReading(text) {
  if (!kuromojiTokenizer || !text) return '';
  try {
    const tokens = kuromojiTokenizer.tokenize(text);
    return tokens.map((t) => t.reading || t.surface_form).join('');
  } catch (e) {
    return '';
  }
}

// 매번 74건씩 다시 조회하면 느리니까, 결과를 파일로 저장해뒀다가
// 일정 시간 안에 다시 열면 그걸 바로 씀 (3시간 지나면 다시 살아있는 데이터로 갱신)
// CACHE_SCHEMA_VERSION: 코드가 바뀌어서 캐시 구조/내용이 달라질 때마다 이 숫자를 올리면
// 예전 캐시는 자동으로 무시되고 새로 받아옴
const CACHE_SCHEMA_VERSION = 8; // 캐시가 kuromoji 반영 전 상태로 남아있을 수 있어서 한 번 더 무효화
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // DeepL 사용량(평생 한도) 아끼려고 3시간→24시간으로 늘림
function getCachePath() {
  return path.join(app.getPath('userData'), 'hub-cache.json');
}
function readCache(ignoreTTL = false) {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    const cache = JSON.parse(raw);
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null; // 예전 버전 캐시는 버림
    if (ignoreTTL || Date.now() - cache.savedAt < CACHE_TTL_MS) return cache.hubItems;
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

// 직접추가(Firestore/extraFestivals.js) 항목은 hub보다 훨씬 뜸하게 바뀌니까,
// 훨씬 긴 캐시(24시간)를 따로 둬서 앱 켤 때마다 매번 재번역하지 않게 함
// (이게 없으면 실행할 때마다 DeepL 글자 수를 계속 소모하게 됨)
const EXTRA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function getExtraCachePath() {
  return path.join(app.getPath('userData'), 'extra-cache.json');
}
function readExtraCache() {
  try {
    const raw = fs.readFileSync(getExtraCachePath(), 'utf-8');
    const cache = JSON.parse(raw);
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (Date.now() - cache.savedAt < EXTRA_CACHE_TTL_MS) return cache.extraItems;
  } catch (e) {
    // 캐시 없거나 깨졌으면 그냥 새로 처리함
  }
  return null;
}
function writeExtraCache(extraItems) {
  try {
    fs.writeFileSync(getExtraCachePath(), JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      extraItems
    }));
  } catch (e) {
    // 저장 실패해도 앱 동작엔 지장 없음
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 1000,  // 이보다 작아지면 레이아웃 계산이 깨져서 최소 크기로 막아둠
    minHeight: 700,
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

  return filterExcludedHubItems(allItems);
}

// hub API 자체 데이터에 문제가 있는(예: 날짜가 1년 내내로 잘못된) 항목을 제목 키워드로 걸러서 제외함.
// 대신 extraFestivals.js에 정확한 정보로 직접 추가해서 그게 보이게 함.
const HUB_EXCLUDE_KEYWORDS = [
  '광안리 M', '광안리M' // 드론라이트쇼 - hub 쪽 날짜가 2026.01.01~12.31로 잘못되어 있어서 제외
];

function filterExcludedHubItems(items) {
  return items.filter((item) => {
    const title = item.title || '';
    return !HUB_EXCLUDE_KEYWORDS.some((kw) => title.includes(kw));
  });
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
const HUB_TRANSLATABLE_FIELDS = [
  'title', 'outl', 'addr1', 'cat1Nm', 'cat2Nm', 'eventPlace',
  'playTime', 'program', 'subEvent', 'sponsor1', 'sponsor2',
  'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'progressType', 'useFee'
];

// extraFestivals.js는 필드명이 hub랑 달라서 별도 목록 사용
const SIMPLE_TRANSLATABLE_FIELDS = [
  'title', 'summary', 'place', 'category',
  'playTime', 'program', 'subEvent', 'sponsor1', 'sponsor2',
  'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'useFee'
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
let deeplQuotaExceeded = false; // 한 번 한도 초과가 확인되면, 이번 세션 동안은 계속 재시도하지 않고 바로 구글로 감
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
  const err = new Error(`DeepL 인증/요청 실패 (status=${lastResult?.status}): ${lastResult?.body?.slice(0, 200)}`);
  if (lastResult?.status === 456) err.isQuotaExceeded = true; // DeepL의 "사용량 한도 초과" 전용 상태코드
  throw err;
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
async function translateItemsToJapanese(items, onProgress, fields = HUB_TRANSLATABLE_FIELDS) {
  const useDeepL = Boolean(config.DEEPL_API_KEY && config.DEEPL_API_KEY.trim());
  if (useDeepL) {
    const k = config.DEEPL_API_KEY.trim();
    console.log(`[main] DeepL 키 확인: 길이=${k.length}, 앞4자=${k.slice(0, 4)}, 뒤4자=${k.slice(-4)}, ':fx'로 끝남=${k.endsWith(':fx')}`);
  }

  const flatTexts = [];
  const indexMap = []; // [{itemIdx, field}]
  items.forEach((item, itemIdx) => {
    fields.forEach((field) => {
      const val = item[field];
      if (val && val.trim()) {
        flatTexts.push(val);
        indexMap.push({ itemIdx, field });
      }
    });
  });

  const results = items.map((item) => ({ ...item }));

  // 번역하기 전에 원문(한국어)을 orig_* 필드로 따로 보관해둠 - 상세페이지 "원문 보기" 토글용
  fields.forEach((field) => {
    results.forEach((r) => {
      r[`orig_${field}`] = r[field] || '';
    });
  });

  if (flatTexts.length === 0) return { items: results, allFailed: false };

  let failCount = 0;
  const totalTexts = flatTexts.length;
  let doneTexts = 0;

  // 이번 세션에서 이미 한도 초과가 확인됐으면 아예 DeepL을 다시 시도하지 않고 바로 구글로 감
  const tryDeepL = useDeepL && !deeplQuotaExceeded;

  if (tryDeepL) {
    const CHUNK = 50;
    let remainingStartIdx = flatTexts.length; // 한도초과로 중간에 멈추면, 여기부터는 구글로 처리할 몫

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
        doneTexts += chunk.length;
        if (onProgress) onProgress(doneTexts, totalTexts);
      } catch (e) {
        if (e.isQuotaExceeded) {
          // DeepL 한도 초과 - 여기서 멈추고, 이 청크부터 끝까지는 구글 번역으로 넘김
          console.log('[main] DeepL 사용량 한도 초과 확인됨 - 나머지는 구글 번역(비공식)으로 자동 전환');
          deeplQuotaExceeded = true;
          remainingStartIdx = i;
          break;
        }
        console.log('[main] DeepL 번역 실패, 이 묶음은 원문 유지:', e.message);
        failCount += chunk.length;
        doneTexts += chunk.length;
        if (onProgress) onProgress(doneTexts, totalTexts);
      }
    }

    // 한도 초과로 못 끝낸 나머지 텍스트를 구글 번역으로 이어서 처리
    if (deeplQuotaExceeded && remainingStartIdx < flatTexts.length) {
      const remainingIndices = [];
      for (let i = remainingStartIdx; i < flatTexts.length; i++) remainingIndices.push(i);
      const concurrency = 8;
      const queue = [...remainingIndices];
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
  } else {
    if (deeplQuotaExceeded) console.log('[main] DeepL 한도 초과 상태(이번 세션) - 구글 번역(비공식)으로 진행');
    else console.log('[main] DEEPL_API_KEY 없음 - 구글 번역(비공식)으로 대체');
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

  console.log(`[main] 자동번역 완료: 텍스트 ${flatTexts.length}개 중 실패(원문유지) ${failCount}개 (엔진: ${tryDeepL && !deeplQuotaExceeded ? 'DeepL' : (tryDeepL ? 'DeepL+Google 혼합' : 'Google(비공식)')})`);
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

  // kuromoji 사전 로딩(1~3초 걸림)을 여기서 미리 백그라운드로 시작해둠 -
  // 뒤에서 hub 데이터 가져오는 동안(훨씬 오래 걸림) 같이 진행되니까, 실제 체감 지연은 거의 없어짐
  initKuromoji();

  const result = {
    hubItems: [],
    extra: extraFestivals,
    errors: [],
    debug: ''
  };

  // 직접추가 항목도 원문(한국어)을 같이 보관해서, 상세페이지 "원문 보기" 토글이 작동하게 함.
  // 직접추가 항목은 24시간 캐시를 먼저 확인 - 있으면 Firestore 조회/번역 자체를 건너뛰어서
  // DeepL 글자 수 소모를 크게 줄임 (예전엔 앱 켤 때마다 매번 재번역했었음)
  const cachedExtra = readExtraCache();
  if (cachedExtra) {
    result.extra = cachedExtra;
    console.log(`[main] 직접추가 항목 캐시 사용 (${cachedExtra.length}건) - 24시간 지나야 재번역함`);
  } else {
  try {
    // Firestore에서 받아오는 걸 우선하고, 실패하거나(연결 안 됨) 비어있으면 로컬 extraFestivals.js로 대체
    let extraSource = extraFestivals;
    try {
      const firestoreItems = await fetchFirestoreFestivals();
      if (firestoreItems && firestoreItems.length > 0) {
        extraSource = firestoreItems;
        console.log(`[main] Firestore에서 ${firestoreItems.length}건 받아옴`);
      }
    } catch (e) {
      console.log('[main] Firestore 조회 실패, extraFestivals.js로 대체:', e.message);
    }

    const { items: translatedExtra } = await translateItemsToJapanese(extraSource, null, SIMPLE_TRANSLATABLE_FIELDS);

    // 직접 입력한 reading이 있으면 그걸 우선 존중하고, 없는 항목만 자동 생성으로 보완
    await initKuromoji();
    translatedExtra.forEach((item) => {
      if (!item.reading) item.reading = getReading(item.title);
    });

    result.extra = translatedExtra;
    writeExtraCache(translatedExtra);
  } catch (e) {
    result.errors.push(`직접추가 번역 실패(원문 유지): ${e.message}`);
  }
  }

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

    // 번역된 일본어 제목 기준으로 요미가나(읽는 법) 자동 생성 - 한자↔히라가나 검색용
    await initKuromoji();
    translatedItems.forEach((item) => {
      item.reading = getReading(item.title);
    });
    const readingSuccessCount = translatedItems.filter((it) => it.reading).length;
    console.log(`[main] 요미가나 자동생성: ${readingSuccessCount}/${translatedItems.length}건 성공`);
    if (translatedItems[0]) {
      console.log(`[main] 샘플 - 제목: "${translatedItems[0].title}" → 읽기: "${translatedItems[0].reading}"`);
    }

    result.hubItems = translatedItems;
    result.debug = debug + (sampleRaw ? ` | 샘플: ${sampleRaw}` : '') + (allFailed ? ' | ⚠️ 번역 전부 실패(원문 표시중)' : '');
    if (!allFailed) {
      writeCache(translatedItems);
    } else {
      console.log('[main] 번역이 전부 실패해서 이번 결과는 캐시에 저장하지 않음 (다음 실행 때 재시도)');
    }
  } catch (e) {
    console.log('[main] hub 검색 실패, 대체 데이터를 찾습니다:', e.message);

    // 1순위: 이 컴퓨터에 저장된 로컬 캐시(만료됐어도 상관없이)
    const staleCache = readCache(true);
    if (staleCache) {
      result.hubItems = staleCache;
      result.debug = `⚠️ 최신 데이터를 받아오지 못해서, 이전에 저장된 데이터를 대신 보여드립니다. (${e.message})`;
      console.log(`[main] hub 실패 → 로컬 캐시(만료 무시)로 대체, ${staleCache.length}건`);
      return result;
    }

    // 2순위: Firestore에 미리 저장해둔 스냅샷(snapshot-to-firestore.js로 가끔 갱신)
    try {
      const snap = await fetchFirestoreHubSnapshot();
      if (snap && snap.length > 0) {
        result.hubItems = snap;
        result.debug = `⚠️ 최신 데이터를 받아오지 못해서, 백업 스냅샷 데이터를 대신 보여드립니다. (${e.message})`;
        console.log(`[main] hub 실패, 로컬 캐시도 없음 → Firestore 스냅샷으로 대체, ${snap.length}건`);
        return result;
      }
    } catch (e2) {
      console.log('[main] 스냅샷 조회도 실패:', e2.message);
    }

    // 3순위: 아무 대체 데이터도 없으면 그제서야 에러로 표시
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