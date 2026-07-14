// 🔒 API 키는 여기 없습니다. config.js(메인 프로세스)에서만 사용되고,
// 렌더러는 window.api를 통해 "결과"만 받습니다.
//
// 데이터 출처: 부산광역시_부산축제정보 서비스 (공공데이터포털)
//  - getFestivalJa: 부산시가 직접 제공하는 "공식 일본어 번역" 축제 정보 (메인 소스)
//  - getFestivalKr: 국문 정보. 일문 쪽에 빠진 항목(특히 주소)을 보완하는 용도로만 사용

// ⚠️ 이미지 경로(MAIN_IMG_NORMAL/THUMB)는 "/uploadImgs/..." 같은 상대경로로 내려옵니다.
// 실제 호스트(도메인)가 가이드 문서에 명시되어 있지 않아서, 우선 비워둡니다.
// 개발자도구 Network 탭에서 실제 이미지가 어느 도메인에 있는지 확인되면 여기에 채워주세요.
const BUSAN_IMG_BASE_URL = '';

// 이 API는 시작일/종료일이 구조화돼있지 않고 USAGE_DAY_WEEK_AND_TIME 같은 자유 텍스트뿐이라,
// 정규식으로 연/월/일을 최대한 뽑아냅니다. 한국어/일본어 표기, 2자리 연도('25.11.7),
// 전각 숫자(２０２５)까지 최대한 대응합니다.
// ⚠️ 텍스트에 적힌 날짜를 "있는 그대로" 해석합니다 (내년으로 추정하는 보정 없음).
function extractApproxDate(rawText) {
    if (!rawText) return null;

    // 전각 숫자 → 반각 숫자로 정규화
    const text = rawText.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

    // 4자리 연도: 2025.11.7 / 2025-11-7 / 2025年8月中 / 2025年11月7日
    let m = text.match(/(\d{4})[.\-年]\s*(\d{1,2})[.\-月]?\s*(\d{1,2})?/);
    if (m) {
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const day = m[3] ? parseInt(m[3], 10) : 1;
        if (month >= 0 && month <= 11) return new Date(year, month, day);
        return null;
    }

    // 2자리 연도(약식 표기): '25.11.7 / 25.11.7
    m = text.match(/'?(\d{2})[.\-](\d{1,2})[.\-](\d{1,2})/);
    if (m) {
        const year = 2000 + parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const day = parseInt(m[3], 10);
        if (month >= 0 && month <= 11) return new Date(year, month, day);
    }

    return null;
}

// --- 탭 전환 로직 ---
const tabs = document.querySelectorAll('.menu li');
const views = document.querySelectorAll('.view-section');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        views.forEach(v => v.style.display = 'none');
        document.getElementById(tab.getAttribute('data-target')).style.display = 'block';
    });
});

function normalizeItem(item) {
    return {
        contentId: item.UC_SEQ || '',
        title: item.TITLE || item.MAIN_TITLE || '',
        subtitle: item.SUBTITLE || '',
        place: item.PLACE || item.MAIN_PLACE || '',
        address: item.ADDR1 || '',
        addressExtra: item.ADDR2 || '',
        gugun: item.GUGUN_NM || '',
        // USAGE_DAY가 비어있는 경우가 많아서, USAGE_DAY_WEEK_AND_TIME(실제로 날짜 텍스트가 들어있음)을 우선 사용
        usageDay: item.USAGE_DAY || item.USAGE_DAY_WEEK_AND_TIME || '',
        transitInfo: item.TRFC_INFO || '',
        homepage: item.HOMEPAGE_URL || '',
        image: item.MAIN_IMG_NORMAL ? (BUSAN_IMG_BASE_URL + item.MAIN_IMG_NORMAL) : ''
    };
}

// --- API 로직 (메인 프로세스에 위임, 파싱도 메인에서 이미 완료됨) ---
async function fetchFestivals() {
    const grid = document.getElementById('festival-grid');
    grid.innerHTML = '<p style="padding: 20px;">データを読み込んでいます... (데이터를 불러오는 중입니다...)</p>';

    try {
        const { ja, kr } = await window.api.fetchAllFestivals();

        console.log(`[진단] 일문(공식) totalCount=${ja.totalCount}, 받아온 건수=${ja.items.length}`, ja.error || '');
        console.log(`[진단] 국문 totalCount=${kr.totalCount}, 받아온 건수=${kr.items.length}`, kr.error || '');

        const jaItems = ja.items.map(normalizeItem);
        const krItems = kr.items.map(normalizeItem);
        const krById = new Map(krItems.map(i => [i.contentId, i]));
        const jaIds = new Set(jaItems.map(i => i.contentId));

        // 일문 데이터가 메인. 주소처럼 일문 쪽에 비어있는 필드는 국문 데이터로 보완.
        // (주소는 오히려 한국어 그대로 보여주는 게 택시기사/지도 앱에 보여주기 더 유용함)
        const translated = jaItems.map(f => {
            const krMatch = krById.get(f.contentId);
            return {
                ...f,
                address: f.address || krMatch?.address || '',
                addressExtra: f.addressExtra || krMatch?.addressExtra || '',
                usageDay: f.usageDay || krMatch?.usageDay || '',
                transitInfo: f.transitInfo || krMatch?.transitInfo || '',
                image: f.image || krMatch?.image || '',
                isUntranslated: false
            };
        });

        // 국문에만 있고 일문 번역이 아예 없는 항목 - 이전엔 통째로 빠졌던 부분.
        // 번역이 없으니 한국어 원문 그대로라도 보여주고, 구분되게 태그를 달아줌.
        const untranslatedExtra = krItems
            .filter(f => f.contentId && !jaIds.has(f.contentId))
            .map(f => ({ ...f, isUntranslated: true }));

        const combined = [...translated, ...untranslatedExtra].map(f => ({
            ...f,
            estimatedDate: extractApproxDate(f.usageDay)
        }));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const withKnownDate = combined.filter(f => f.estimatedDate && f.estimatedDate >= today);
        const pastDropped = combined.filter(f => f.estimatedDate && f.estimatedDate < today);
        const unknownDate = combined.filter(f => !f.estimatedDate);

        withKnownDate.sort((a, b) => a.estimatedDate - b.estimatedDate);

        // 날짜를 모르는 항목은 "지난 축제인지 확신할 수 없어서" 일단 목록 맨 뒤에 별도로 붙임.
        // 완전히 빼고 싶으면 아래 줄의 unknownDate를 제거하면 됩니다.
        const finalList = [...withKnownDate, ...unknownDate];

        console.log(
            `[진단] 일문=${jaItems.length}, 국문전용추가=${untranslatedExtra.length}, 병합 후 전체=${combined.length}, ` +
            `앞으로있음=${withKnownDate.length}, 과거라서제외=${pastDropped.length}, 날짜불명=${unknownDate.length}`
        );
        // 각 항목이 왜 과거/미래/불명으로 분류됐는지 원본 텍스트와 함께 그대로 확인 가능
        console.table(combined.map(f => ({
            title: f.title,
            usageDay: f.usageDay,
            parsed: f.estimatedDate ? f.estimatedDate.toISOString().slice(0, 10) : '(파싱실패)',
            classification: !f.estimatedDate ? '날짜불명' : (f.estimatedDate < today ? '과거(제외됨)' : '앞으로있음')
        })));

        if (finalList.length > 0) {
            renderFestivals(finalList, true);
        } else {
            const diag = [
                ja.error || `일문서비스: 원본 totalCount=${ja.totalCount}건`,
                kr.error || `국문서비스: 원본 totalCount=${kr.totalCount}건`
            ].join('\n');
            throw new Error(`조건에 맞는 축제 데이터가 0개입니다.\n${diag}`);
        }
    } catch (error) {
        console.error('API 에러 상세:', error);
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; background: rgba(255, 100, 100, 0.2); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(255, 0, 0, 0.3);">
                <h3 style="color: #d32f2f; margin-top: 0;">⚠️ API 연결 실패 원인 분석</h3>
                <pre style="white-space: pre-wrap; font-size: 13px; color: #111;">${error.message}</pre>
            </div>
        `;
    }
}

function renderFestivals(festivals, clearGrid = true) {
    const grid = document.getElementById('festival-grid');
    if (clearGrid) grid.innerHTML = '';

    // 스크롤해서 세지 않아도 실제 개수를 바로 확인할 수 있게 표시
    grid.insertAdjacentHTML('beforeend',
        `<p style="grid-column: 1 / -1; font-size: 13px; color: #515154; margin: 0 0 10px 0;">総 ${festivals.length}件</p>`
    );

    festivals.forEach(fest => {
        const title = fest.title || 'タイトルなし';
        const dateStr = fest.usageDay || '日程未定';
        const location = fest.place || fest.address || '場所未定';

        const imageTag = fest.image
            ? `<img src="${fest.image}" onerror="this.replaceWith(Object.assign(document.createElement('div'), {style:'width:calc(100% + 40px); height:180px; background:rgba(0,0,0,0.05); border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold;', innerText:'No Image'}))" style="width:calc(100% + 40px); height:180px; object-fit:cover; border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:block;">`
            : `<div style="width:calc(100% + 40px); height:180px; background:rgba(0,0,0,0.05); border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold;">No Image</div>`;

        const addressLine = fest.address
            ? `<p style="font-size: 12px; color: #8a8a8e; margin: -5px 0 10px 0;">🏠 ${fest.address}${fest.addressExtra ? ' ' + fest.addressExtra : ''}</p>`
            : (fest.transitInfo
                ? `<p style="font-size: 12px; color: #8a8a8e; margin: -5px 0 10px 0;">🚇 ${fest.transitInfo.replace(/\n/g, ' / ')}</p>`
                : '');

        const tagLabel = fest.isUntranslated ? '🇰🇷 未翻訳' : (fest.gugun || 'フェスティバル');
        const tagStyle = fest.isUntranslated
            ? 'background: rgba(255, 149, 0, 0.12); color: #b56a00;'
            : '';

        const cardHTML = `
            <div class="card">
                ${imageTag}
                <h3>${title}</h3>
                <p style="font-size: 13px; color: #515154; margin:5px 0;">📅 ${dateStr}</p>
                <p style="font-size: 13px; color: #515154; margin-bottom: 5px;">📍 ${location}</p>
                ${addressLine}
                <span class="tag" style="${tagStyle}">${tagLabel}</span>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHTML);
    });
}

// --- 📅 달력 로직 (변경 없음) ---
let currentDate = new Date(2026, 6, 1);

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const calendarBody = document.getElementById('calendar-body');
    calendarBody.innerHTML = '';

    for (let i = 0; i < firstDayIndex; i++) {
        calendarBody.innerHTML += `<div class="calendar-cell empty"></div>`;
    }

    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) ? 'today' : '';

        calendarBody.innerHTML += `
            <div class="calendar-cell ${isToday}">
                <span class="calendar-date">${i}</span>
            </div>
        `;
    }
}

document.getElementById('btn-prev-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
});

document.getElementById('btn-next-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
});

window.onload = () => {
    fetchFestivals();
    renderCalendar();
};