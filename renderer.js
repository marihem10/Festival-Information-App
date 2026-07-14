// 🔒 데이터 출처: 한국관광콘텐츠랩(api.visitkorea.or.kr)의 내부 통합검색 API.
// 공식 문서화된 API가 아니라 그 사이트 자체 화면용 내부 API라서 구조가 바뀔 수 있음.

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
        contentId: item.contentId || '',
        title: item.title || '',
        summary: item.outl || '',
        address: item.addr1 || '',
        addressExtra: item.addr2 || '',
        category: item.cat2Nm || item.cat1Nm || '',
        image: item.firstImage || item.firstImage2 || '',
        homepage: item.hmpg || ''
    };
}

let allFestivalsCache = [];
let currentPage = 1;
const PAGE_SIZE = 6;

async function fetchFestivals() {
    const grid = document.getElementById('festival-grid');
    grid.innerHTML = '<p style="padding: 20px;">データを読み込んでいます... (데이터를 불러오는 중입니다...)</p>';

    try {
        const { items, error } = await window.api.fetchAllFestivals();

        console.log(`[진단] hub 검색 결과 ${items.length}건`, error || '');
        console.table(items.slice(0, 20).map(i => ({ title: i.title, cat2Nm: i.cat2Nm, addr1: i.addr1 })));

        const combined = items.map(normalizeItem)
            .filter((f, idx, arr) => arr.findIndex(x => x.contentId === f.contentId) === idx); // 중복 제거

        if (combined.length > 0) {
            allFestivalsCache = combined;
            currentPage = 1;
            renderPage();
        } else {
            throw new Error(error || '조건에 맞는 축제/행사 데이터가 0개입니다.');
        }
    } catch (err) {
        console.error('API 에러 상세:', err);
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; background: rgba(255, 100, 100, 0.2); backdrop-filter: blur(10px); padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(255, 0, 0, 0.3);">
                <h3 style="color: #d32f2f; margin-top: 0;">⚠️ 데이터 로드 실패</h3>
                <pre style="white-space: pre-wrap; font-size: 13px; color: #111;">${err.message}</pre>
            </div>
        `;
    }
}

function renderPage() {
    const totalPages = Math.max(1, Math.ceil(allFestivalsCache.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allFestivalsCache.slice(start, start + PAGE_SIZE);

    renderFestivals(pageItems, true);
    renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
    const grid = document.getElementById('festival-grid');
    const controlsHTML = `
        <div style="grid-column: 1 / -1; display:flex; justify-content:center; align-items:center; gap:15px; margin-top: 20px;">
            <button id="page-prev" ${currentPage <= 1 ? 'disabled' : ''} style="padding:8px 16px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${currentPage <= 1 ? 'default' : 'pointer'}; opacity:${currentPage <= 1 ? '0.4' : '1'};">&lt; 前へ</button>
            <span style="font-size:14px; color:#515154;">${currentPage} / ${totalPages}</span>
            <button id="page-next" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:8px 16px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${currentPage >= totalPages ? 'default' : 'pointer'}; opacity:${currentPage >= totalPages ? '0.4' : '1'};">次へ &gt;</button>
        </div>
    `;
    grid.insertAdjacentHTML('beforeend', controlsHTML);

    document.getElementById('page-prev')?.addEventListener('click', () => {
        currentPage -= 1;
        renderPage();
        document.getElementById('festival-grid').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('page-next')?.addEventListener('click', () => {
        currentPage += 1;
        renderPage();
        document.getElementById('festival-grid').scrollIntoView({ behavior: 'smooth' });
    });
}

function renderFestivals(festivals, clearGrid = true) {
    const grid = document.getElementById('festival-grid');
    if (clearGrid) grid.innerHTML = '';

    grid.insertAdjacentHTML('beforeend',
        `<p style="grid-column: 1 / -1; font-size: 13px; color: #515154; margin: 0 0 10px 0;">総 ${allFestivalsCache.length}件</p>`
    );

    festivals.forEach(fest => {
        const title = fest.title || 'タイトルなし';
        const location = fest.address || '場所未定';
        const summary = fest.summary ? fest.summary.replace(/<[^>]+>/g, '').slice(0, 60) : '';

        const imageTag = fest.image
            ? `<img src="${fest.image}" onerror="this.replaceWith(Object.assign(document.createElement('div'), {style:'width:calc(100% + 40px); height:180px; background:rgba(0,0,0,0.05); border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold;', innerText:'No Image'}))" style="width:calc(100% + 40px); height:180px; object-fit:cover; border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:block;">`
            : `<div style="width:calc(100% + 40px); height:180px; background:rgba(0,0,0,0.05); border-radius:20px 20px 0 0; margin: -20px -20px 15px -20px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold;">No Image</div>`;

        const cardHTML = `
            <div class="card">
                ${imageTag}
                <h3>${title}</h3>
                ${summary ? `<p style="font-size: 12px; color: #8a8a8e; margin: -5px 0 10px 0;">${summary}...</p>` : ''}
                <p style="font-size: 13px; color: #515154; margin-bottom: 15px;">📍 ${location}</p>
                <span class="tag">${fest.category || 'フェスティバル・イベント'}</span>
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