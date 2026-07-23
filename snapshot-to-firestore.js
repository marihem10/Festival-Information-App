// 🔧 개발자 전용 스크립트: 지금 hub API에서 받아온 데이터를 통째로 Firestore에 "스냅샷"으로 저장해둠.
// hub API가 나중에 갑자기 안 되거나 사라지는 상황에 대비한 최후의 백업용.
//
// 실행 방법: 프로젝트 폴더에서  node snapshot-to-firestore.js
// (serviceAccountKey.json이 있어야 함 - migrate-to-firestore.js랑 같은 파일 재사용)
//
// ⚠️ 이 스크립트는 앱(main.js)엔 포함되지 않는 개발자 전용 도구예요.
//    가끔(예: 한 달에 한 번, 또는 축제 시즌마다) 회원님 컴퓨터에서 직접 실행해서
//    스냅샷을 최신 상태로 갱신해주면 돼요. 안 돌려도 앱은 정상 작동하고,
//    이건 hub가 진짜 문제 생겼을 때만 쓰이는 "보험" 같은 거예요.
//
// 중복 방지: hub의 contentId를 Firestore 문서 ID로 그대로 써서(add 대신 set),
//           다시 실행해도 같은 축제는 같은 자리에 덮어써질 뿐 중복 생성되지 않음.

const https = require('https');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const config = require('./config');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// --- main.js에서 그대로 가져온 데이터 수집 로직 ---

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
        res.setEncoding('utf8');
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

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const HUB_EXCLUDE_KEYWORDS = ['광안리 M', '광안리M'];
function filterExcludedHubItems(items) {
  return items.filter((item) => {
    const title = item.title || '';
    return !HUB_EXCLUDE_KEYWORDS.some((kw) => title.includes(kw));
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
      type: 'cat', lang: 'KOR', cat1: ['EV'], cat2: ['EV01', 'EV02', 'EV03'], cat3: [],
      areaCd: ['26'], arrange: 'NEW', awardYear: [], fromDetail: false, langDiv: 'KOR',
      mainYn: 'N', nuri: [], pageCnt: 1, pageNo, photo1: [], photo2: [],
      searchCnt: PAGE_SIZE, searchStart: (pageNo - 1) * PAGE_SIZE, sigunguCd: [], title: ''
    };
    // eslint-disable-next-line no-await-in-loop
    const raw = await postJson(url, payload);
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error(`배열이 아닌 응답: ${raw.slice(0, 300)}`);
    allItems = allItems.concat(items);
    if (items.length < PAGE_SIZE) break;
    pageNo += 1;
    if (pageNo > 10) break;
  }
  return filterExcludedHubItems(allItems);
}

async function fetchDetailIntro(contentId) {
  const key = encodeURIComponent(config.DATA_GO_KR_API_KEY);
  const url = `https://apis.data.go.kr/B551011/KorService2/detailIntro2?serviceKey=${key}&MobileOS=ETC&MobileApp=BusanNavi&_type=json&contentId=${contentId}&contentTypeId=15`;
  const raw = await httpsGetJson(url);
  try {
    const data = JSON.parse(raw);
    const item = data.response?.body?.items?.item;
    const record = Array.isArray(item) ? item[0] : item;
    return record || null;
  } catch (e) {
    return null;
  }
}

async function enrichWithDates(items, concurrency = 10) {
  const queue = [...items];
  const results = [];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchDetailIntro(item.contentId);
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
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

const HUB_TRANSLATABLE_FIELDS = [
  'title', 'outl', 'addr1', 'cat1Nm', 'cat2Nm', 'eventPlace',
  'playTime', 'program', 'subEvent', 'sponsor1', 'sponsor2',
  'ageLimit', 'bookingPlace', 'discountInfo', 'placeInfo', 'progressType', 'useFee'
];

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

let deeplHostOverride = null;
async function deeplTranslateBatch(texts) {
  const hostsToTry = deeplHostOverride ? [deeplHostOverride] : ['api-free.deepl.com', 'api.deepl.com'];
  let lastResult = null;
  for (const host of hostsToTry) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deeplRequest(host, texts);
    if (result.status === 200) {
      deeplHostOverride = host;
      return result.body;
    }
    lastResult = result;
  }
  throw new Error(`DeepL 인증/요청 실패 (status=${lastResult?.status})`);
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

async function translateItemsToJapanese(items) {
  const useDeepL = Boolean(config.DEEPL_API_KEY && config.DEEPL_API_KEY.trim());
  console.log(`[snapshot] config.js 위치: ${require.resolve('./config')}`);
  if (config.DEEPL_API_KEY) {
    const k = config.DEEPL_API_KEY.trim();
    console.log(`[snapshot] DeepL 키 확인: 길이=${k.length}, 앞4자=${k.slice(0, 4)}, 뒤4자=${k.slice(-4)}`);
  } else {
    console.log('[snapshot] config.DEEPL_API_KEY 값 자체가 비어있음(undefined 또는 빈 문자열)');
  }
  const flatTexts = [];
  const indexMap = [];
  items.forEach((item, itemIdx) => {
    HUB_TRANSLATABLE_FIELDS.forEach((field) => {
      const val = item[field];
      if (val && val.trim()) {
        flatTexts.push(val);
        indexMap.push({ itemIdx, field });
      }
    });
  });
  const results = items.map((item) => ({ ...item }));
  if (flatTexts.length === 0) return results;

  if (useDeepL) {
    const CHUNK = 50;
    for (let i = 0; i < flatTexts.length; i += CHUNK) {
      const chunk = flatTexts.slice(i, i + CHUNK);
      const chunkMap = indexMap.slice(i, i + CHUNK);
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await deeplTranslateBatch(chunk);
        const data = JSON.parse(raw);
        if (data.translations) {
          data.translations.forEach((t, j) => {
            const { itemIdx, field } = chunkMap[j];
            results[itemIdx][field] = t.text;
          });
        }
      } catch (e) {
        console.log('[snapshot] DeepL 번역 실패, 원문 유지:', e.message);
      }
    }
  } else {
    console.log('[snapshot] DEEPL_API_KEY 없음 - 구글 번역(비공식)으로 대체');
    for (let i = 0; i < flatTexts.length; i++) {
      const { itemIdx, field } = indexMap[i];
      // eslint-disable-next-line no-await-in-loop
      results[itemIdx][field] = await googleTranslateOne(flatTexts[i]);
    }
  }
  return results;
}

// --- 메인 실행 ---
async function main() {
  console.log('1. hub에서 축제 목록 받아오는 중...');
  const rawHubItems = await fetchHubEvents();
  console.log(`   ${rawHubItems.length}건 받아옴`);

  console.log('2. 날짜/상세정보 채우는 중...');
  const enriched = await enrichWithDates(rawHubItems);

  console.log('3. 일본어로 번역하는 중...');
  const translated = await translateItemsToJapanese(enriched);

  console.log('4. Firestore에 스냅샷 저장 중 (contentId를 문서 ID로 써서 중복 방지)...');
  let successCount = 0;
  for (const item of translated) {
    if (!item.contentId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.collection('hub_snapshot').doc(String(item.contentId)).set(item);
      successCount += 1;
    } catch (e) {
      console.log(`   ❌ 실패(${item.title}): ${e.message}`);
    }
  }

  console.log(`\n완료: ${successCount}/${translated.length}건 저장됨`);
  process.exit(0);
}

main().catch((e) => {
  console.error('스냅샷 저장 중 오류:', e.message);
  process.exit(1);
});