// 🔒 데이터 소스:
// ① hubItems: 한국관광콘텐츠랩 내부 API (실시간, 이미지/설명)
// ② detailIntro2(공식 TourAPI)로 보완된 날짜
// ③ curated: 8대 대표축제 수동 입력 (curatedFestivals.js) - 날짜 보완용
// ④ extra: 사용자가 직접 추가하는 파일 (extraFestivals.js)

// --- 탭 전환 로직 ---
const tabs = document.querySelectorAll('.menu li');
const views = document.querySelectorAll('.view-section');

function showView(id) {
    views.forEach(v => v.style.display = 'none');
    document.getElementById(id).style.display = 'block';
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-target');
        showView(target);
        if (target === 'view-bookmarks') renderBookmarkPage();
    });
});

document.getElementById('detail-back-btn').addEventListener('click', () => {
    showView('view-home');
});

document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
});

function ymdToIso(ymd) {
    if (!ymd || ymd.length !== 8) return '';
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function parseIso(s) {
    if (!s) return null;
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// hub의 hmpg 필드는 "공식 홈페이지 https://..." 처럼 설명 텍스트가 섞여서 오는 경우가 있어서
// 순수 URL 부분만 뽑아냄
function extractUrl(text) {
    if (!text) return '';
    const m = text.match(/https?:\/\/[^\s"'<>]+/);
    return m ? m[0] : '';
}

function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHubItem(item) {
    return {
        title: item.title || '',
        summary: item.outl || '',
        address: item.eventPlace || item.addr1 || '',
        category: item.cat2Nm || item.cat1Nm || '',
        image: item.firstImage || item.firstImage2 || '',
        homepage: extractUrl(item.hmpg),
        startDate: ymdToIso(item.eventStartDate),
        endDate: ymdToIso(item.eventEndDate),
        playTime: stripHtml(item.playTime),
        program: stripHtml(item.program),
        subEvent: stripHtml(item.subEvent),
        sponsor1: stripHtml(item.sponsor1),
        sponsor1Tel: item.sponsor1Tel || '',
        sponsor2: stripHtml(item.sponsor2),
        ageLimit: stripHtml(item.ageLimit),
        bookingPlace: stripHtml(item.bookingPlace),
        discountInfo: stripHtml(item.discountInfo),
        placeInfo: stripHtml(item.placeInfo),
        progressType: stripHtml(item.progressType),
        spendTime: stripHtml(item.spendTime),
        useFee: stripHtml(item.useFee)
    };
}

function normalizeSimpleItem(item) {
    return {
        title: item.title || '',
        summary: '',
        address: item.place || item.address || '',
        category: '',
        image: item.image || '',
        homepage: extractUrl(item.homepage),
        startDate: item.startDate || '',
        endDate: item.endDate || ''
    };
}

// --- 아이콘 (이모지 대신 심플한 SVG 사용) ---
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:4px;"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:4px;"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>';
const ICON_DOT = '<svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor" style="margin-top:6px; flex-shrink:0;"><circle cx="4" cy="4" r="4"/></svg>';
const ICON_BOOKMARK = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

function looseKey(s) {
    return (s || '').replace(/\s|\(|\)|[0-9]/g, '').toLowerCase();
}

// 진행상태 계산: ongoing(진행중) / upcoming(예정) / ended(종료) / unknown(날짜없음)
function getStatus(fest) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseIso(fest.startDate);
    const end = parseIso(fest.endDate) || start;

    if (!start) return { key: 'unknown', label: '' };
    if (start <= today && (!end || end >= today)) return { key: 'ongoing', label: '開催中' };
    if (start > today) {
        const diffDays = Math.round((start - today) / 86400000);
        return { key: 'upcoming', label: diffDays === 0 ? '本日開催' : `あと${diffDays}日` };
    }
    return { key: 'ended', label: '終了' };
}

// --- ⭐ 북마크 ---
let bookmarkedKeys = new Set();

async function loadBookmarks() {
    try {
        const list = await window.api.getBookmarks();
        bookmarkedKeys = new Set(list);
    } catch (e) {
        bookmarkedKeys = new Set();
    }
}

async function toggleBookmark(key) {
    try {
        const list = await window.api.toggleBookmark(key);
        bookmarkedKeys = new Set(list);
    } catch (e) {
        if (bookmarkedKeys.has(key)) bookmarkedKeys.delete(key);
        else bookmarkedKeys.add(key);
    }
    refreshAfterBookmarkChange();
}

function refreshAfterBookmarkChange() {
    if (document.getElementById('view-home').style.display !== 'none') renderPage();
    if (document.getElementById('view-bookmarks').style.display !== 'none') renderBookmarkPage();

    const btn = document.getElementById('detail-bookmark-btn');
    if (btn) {
        const key = btn.getAttribute('data-key');
        const isBm = bookmarkedKeys.has(key);
        btn.classList.toggle('active', isBm);
        const label = btn.querySelector('.bm-label');
        if (label) label.textContent = isBm ? 'ブックマーク済み' : 'ブックマークする';
    }
    renderCalendar();
}

// --- 🏷️ 태그 필터 ---
function renderTagFilterChips(containerId, sourceList, activeFilter, onSelect) {
    const container = document.getElementById(containerId);
    const categories = [...new Set(sourceList.map(f => f.category).filter(Boolean))];
    if (categories.length === 0) {
        container.innerHTML = '';
        return;
    }
    const chips = [{ label: 'すべて', val: '' }, ...categories.map(c => ({ label: c, val: c }))];
    container.innerHTML = chips.map(c => {
        const active = c.val === '' ? !activeFilter : activeFilter === c.val;
        return `<span class="tag-chip ${active ? 'active' : ''}" data-cat="${c.val}">${c.label}</span>`;
    }).join('');
    container.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => onSelect(chip.getAttribute('data-cat') || null));
    });
}

let allFestivalsCache = [];
let currentPage = 1;
let searchQuery = '';
let homeTagFilter = null;
const PAGE_SIZE = 6;

function getFilteredList() {
    let list = allFestivalsCache;
    if (homeTagFilter) list = list.filter(f => f.category === homeTagFilter);
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        list = list.filter(f =>
            (f.title || '').toLowerCase().includes(q) ||
            (f.address || '').toLowerCase().includes(q)
        );
    }
    return list;
}

document.getElementById('festival-search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderPage();
});

async function fetchFestivals() {
    const grid = document.getElementById('festival-grid');
    grid.innerHTML = '<p style="padding: 20px;">データを読み込んでいます... (데이터를 불러오는 중입니다...)</p>';

    try {
        const { hubItems, curated, extra, errors, debug } = await window.api.fetchAllFestivals();

        console.log(`[진단] hub=${hubItems.length}건, 큐레이션=${curated.length}건, 직접추가=${extra.length}건`, errors);
        console.log(`[진단-main] ${debug}`);

        const hub = hubItems.map(normalizeHubItem);
        const extraItems = extra.map(normalizeSimpleItem);
        const curatedItems = curated.map(normalizeSimpleItem);

        // hub 항목의 빈 날짜를 큐레이션 목록에서 제목 매칭으로 보완 (fallback)
        const hubWithDates = hub.map(f => {
            if (f.startDate) return f;
            const fKey = looseKey(f.title);
            const match = curatedItems.find(c => {
                const cKey = looseKey(c.title);
                return fKey.includes(cKey) || cKey.includes(fKey);
            });
            if (!match) return f;
            return { ...f, startDate: match.startDate, endDate: match.endDate };
        });

        // 전부 합치고, 제목 기준으로 중복 제거
        const merged = [...hubWithDates, ...extraItems]
            .filter((f, idx, arr) => arr.findIndex(x => looseKey(x.title) === looseKey(f.title)) === idx);

        // 이제 과거 축제도 포함해서 다 보여줌. 대신 정렬 순서를 지능적으로:
        // 1) 진행중 먼저(종료임박순), 2) 예정(임박순), 3) 종료(최근에 끝난 것 먼저), 4) 날짜없음
        const rankOf = { ongoing: 0, upcoming: 1, ended: 2, unknown: 3 };
        const withStatus = merged.map(f => ({ ...f, key: looseKey(f.title), status: getStatus(f) }));

        const counts = withStatus.reduce((acc, f) => {
            acc[f.status.key] = (acc[f.status.key] || 0) + 1;
            return acc;
        }, {});
        console.log(`[진단] 합쳐서 중복제거=${merged.length}건 → 진행중=${counts.ongoing||0}, 예정=${counts.upcoming||0}, 종료=${counts.ended||0}, 날짜없음=${counts.unknown||0}`);

        withStatus.sort((a, b) => {
            const rankDiff = rankOf[a.status.key] - rankOf[b.status.key];
            if (rankDiff !== 0) return rankDiff;

            const aStart = parseIso(a.startDate);
            const bStart = parseIso(b.startDate);
            if (!aStart && !bStart) return 0;
            if (!aStart) return 1;
            if (!bStart) return -1;

            // 종료된 건 최근에 끝난 것부터(내림차순), 나머지는 임박한 순(오름차순)
            return a.status.key === 'ended' ? bStart - aStart : aStart - bStart;
        });

        if (withStatus.length > 0) {
            allFestivalsCache = withStatus;
            currentPage = 1;
            renderPage();
            renderCalendar();
        } else {
            throw new Error(errors.join('\n') || '조건에 맞는 축제/행사 데이터가 0개입니다.');
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
    const filtered = getFilteredList();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    renderFestivals(pageItems, true, filtered.length, 'festival-grid', '該当するイベントが見つかりませんでした。');
    renderTagFilterChips('tag-filter-wrap', allFestivalsCache, homeTagFilter, (cat) => {
        homeTagFilter = cat;
        currentPage = 1;
        renderPage();
    });
    renderPaginationControls(totalPages, 'pagination-controls', currentPage, (p) => { currentPage = p; renderPage(); });
}

// --- ⭐ ブックマーク画面 ---
let bookmarkPage = 1;
let bookmarkTagFilter = null;

function getBookmarkedList() {
    return allFestivalsCache.filter(f => bookmarkedKeys.has(f.key));
}

function getFilteredBookmarkList() {
    let list = getBookmarkedList();
    if (bookmarkTagFilter) list = list.filter(f => f.category === bookmarkTagFilter);
    return list;
}

function renderBookmarkPage() {
    const filtered = getFilteredBookmarkList();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    bookmarkPage = Math.min(Math.max(1, bookmarkPage), totalPages);

    const start = (bookmarkPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    renderFestivals(pageItems, true, filtered.length, 'bookmark-grid', 'まだブックマークしたイベントがありません。');
    renderTagFilterChips('bookmark-tag-filter-wrap', getBookmarkedList(), bookmarkTagFilter, (cat) => {
        bookmarkTagFilter = cat;
        bookmarkPage = 1;
        renderBookmarkPage();
    });
    renderPaginationControls(totalPages, 'bookmark-pagination-controls', bookmarkPage, (p) => { bookmarkPage = p; renderBookmarkPage(); });
}

function renderPaginationControls(totalPages, containerId, page, onChange) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; margin-top: 12px;">
            <button class="page-prev" ${page <= 1 ? 'disabled' : ''} style="padding:6px 14px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${page <= 1 ? 'default' : 'pointer'}; opacity:${page <= 1 ? '0.4' : '1'}; font-size:13px;">&lt; 前へ</button>
            <span style="font-size:13px; color:#515154;">${page} / ${totalPages}</span>
            <button class="page-next" ${page >= totalPages ? 'disabled' : ''} style="padding:6px 14px; border-radius:10px; border:none; background:rgba(255,255,255,0.6); cursor:${page >= totalPages ? 'default' : 'pointer'}; opacity:${page >= totalPages ? '0.4' : '1'}; font-size:13px;">次へ &gt;</button>
        </div>
    `;
    container.querySelector('.page-prev')?.addEventListener('click', () => onChange(page - 1));
    container.querySelector('.page-next')?.addEventListener('click', () => onChange(page + 1));
}

let currentPageItems = [];

function renderFestivals(festivals, clearGrid = true, totalCount = 0, gridId = 'festival-grid', emptyMessage = '該当するイベントが見つかりませんでした。') {
    const grid = document.getElementById(gridId);
    if (clearGrid) grid.innerHTML = '';

    currentPageItems = festivals;

    // grid.insertAdjacentHTML('beforeend',
    //     `<p style="grid-column: 1 / -1; font-size: 13px; color: #515154; margin: 0 0 10px 0;">総 ${totalCount}件</p>`
    // );

    if (totalCount === 0) {
        grid.insertAdjacentHTML('beforeend',
            `<p style="grid-column: 1 / -1; padding: 30px; text-align:center; color:#8a8a8e;">${emptyMessage}</p>`
        );
        return;
    }

    festivals.forEach((fest, idx) => {
        const title = fest.title || 'タイトルなし';
        const location = fest.address || '場所未定';
        const dateStr = fest.startDate
            ? `${fest.startDate.replace(/-/g, '.')} ~ ${(fest.endDate || fest.startDate).replace(/-/g, '.')}`
            : '';

        const imageTag = fest.image
            ? `<img src="${fest.image}" onerror="this.replaceWith(Object.assign(document.createElement('div'), {style:'width:calc(100% + 32px); height:150px; background:rgba(0,0,0,0.05); border-radius:18px 18px 0 0; margin: -16px -16px 12px -16px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold; font-size:12px;', innerText:'No Image'}))" style="width:calc(100% + 32px); height:150px; object-fit:contain; background:rgba(0,0,0,0.04); border-radius:18px 18px 0 0; margin: -16px -16px 12px -16px; display:block;">`
            : `<div style="width:calc(100% + 32px); height:150px; background:rgba(0,0,0,0.05); border-radius:18px 18px 0 0; margin: -16px -16px 12px -16px; display:flex; align-items:center; justify-content:center; color:#515154; font-weight:bold; font-size:12px;">No Image</div>`;

        const badgeClass = fest.status?.key === 'ongoing' ? 'ongoing' : fest.status?.key === 'ended' ? 'ended' : 'upcoming';
        const badgeHtml = fest.status?.label
            ? `<span class="status-badge ${badgeClass}">${fest.status.label}</span>`
            : '';

        const isBookmarked = bookmarkedKeys.has(fest.key);
        const bookmarkBtnHtml = `<button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); toggleBookmark('${fest.key}')">${ICON_BOOKMARK}</button>`;

        const cardHTML = `
            <div class="card" onclick="showFestivalDetail(${idx})">
                ${badgeHtml}
                ${bookmarkBtnHtml}
                ${imageTag}
                <h3>${title}</h3>
                ${dateStr ? `<p style="font-size: 12px; color: #515154; margin:4px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ICON_CALENDAR}${dateStr}</p>` : ''}
                <p style="font-size: 12px; color: #515154; margin: 4px 0 10px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ICON_PIN}${location}</p>
                <span class="tag">${fest.category || 'フェスティバル・イベント'}</span>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHTML);
    });
}

// --- 상세정보 화면 (별도 화면으로 전환) ---
function showFestivalDetail(idx) {
    const fest = currentPageItems[idx];
    if (!fest) return;

    const dateStr = fest.startDate
        ? `${fest.startDate.replace(/-/g, '.')} ~ ${(fest.endDate || fest.startDate).replace(/-/g, '.')}`
        : '日程未定';
    const summary = fest.summary ? fest.summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const imageHtml = fest.image
        ? `<img src="${fest.image}" class="detail-image" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'detail-image-placeholder', innerText:'No Image'}))">`
        : `<div class="detail-image-placeholder">No Image</div>`;

    const badgeHtml = fest.status?.label
        ? `<span class="status-badge ${fest.status.key === 'ongoing' ? 'ongoing' : fest.status.key === 'ended' ? 'ended' : 'upcoming'}" style="position:static; display:inline-block; margin-bottom:10px;">${fest.status.label}</span>`
        : '';

    const isBookmarked = fest.key ? bookmarkedKeys.has(fest.key) : false;
    const bookmarkBtnHtml = fest.key
        ? `<button id="detail-bookmark-btn" class="detail-bookmark-btn ${isBookmarked ? 'active' : ''}" data-key="${fest.key}" onclick="toggleBookmark('${fest.key}')">${ICON_BOOKMARK}<span class="bm-label">${isBookmarked ? 'ブックマーク済み' : 'ブックマークする'}</span></button>`
        : '';

    // 값이 있는 항목만 표로 보여줌 (빈 줄 안 생기게)
    const infoRows = [
        [ICON_CALENDAR, dateStr],
        [ICON_PIN, fest.address || '場所未定'],
        [ICON_DOT, fest.category],
        [ICON_DOT, fest.playTime && `公演時間: ${fest.playTime}`],
        [ICON_DOT, fest.sponsor1 && `主催: ${fest.sponsor1}${fest.sponsor1Tel ? ' (' + fest.sponsor1Tel + ')' : ''}`],
        [ICON_DOT, fest.sponsor2 && `主管: ${fest.sponsor2}`],
        [ICON_DOT, fest.ageLimit && `観覧可能年齢: ${fest.ageLimit}`],
        [ICON_DOT, fest.bookingPlace && `予約: ${fest.bookingPlace}`],
        [ICON_DOT, fest.useFee && `料金: ${fest.useFee}`],
        [ICON_DOT, fest.discountInfo && `割引情報: ${fest.discountInfo}`],
        [ICON_DOT, fest.spendTime && `観覧所要時間: ${fest.spendTime}`],
        [ICON_DOT, fest.placeInfo && `位置案内: ${fest.placeInfo}`]
    ].filter(([, text]) => Boolean(text));

    const rowsHtml = infoRows.map(([icon, text]) =>
        `<div class="detail-row"><span class="label">${icon}</span><span>${text}</span></div>`
    ).join('');

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-layout">
            <div class="detail-layout-image">${imageHtml}</div>
            <div class="detail-card">
                ${badgeHtml}
                <h2>${fest.title || ''}</h2>
                ${bookmarkBtnHtml}
                ${rowsHtml}
                ${summary ? `<p class="detail-summary">${summary}</p>` : ''}
                ${fest.program ? `<p class="detail-summary"><strong>プログラム</strong><br>${fest.program}</p>` : ''}
                ${fest.subEvent ? `<p class="detail-summary"><strong>付帯行事</strong><br>${fest.subEvent}</p>` : ''}
                ${fest.homepage ? `<a class="detail-link" href="${fest.homepage}" target="_blank" rel="noopener">公式サイトを見る →</a>` : ''}
            </div>
        </div>
    `;

    tabs.forEach(t => t.classList.remove('active'));
    showView('view-detail');
}

function showFestivalDetailByKey(key) {
    const fest = allFestivalsCache.find(f => f.key === key);
    if (!fest) return;
    currentPageItems = [fest];
    showFestivalDetail(0);
}

// --- 📅 달력 로직 (축제 날짜 표시 + 클릭 시 목록) ---
let currentDate = new Date(2026, 6, 1);

function buildEventMap() {
    const map = new Map();
    allFestivalsCache.forEach(f => {
        if (!f.startDate) return;
        if (!map.has(f.startDate)) map.set(f.startDate, []);
        map.get(f.startDate).push(f);
    });
    return map;
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const calendarBody = document.getElementById('calendar-body');
    calendarBody.innerHTML = '';
    document.getElementById('calendar-day-detail').innerHTML = '';

    const eventMap = buildEventMap();

    for (let i = 0; i < firstDayIndex; i++) {
        calendarBody.innerHTML += `<div class="calendar-cell empty"></div>`;
    }

    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) ? 'today' : '';
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayEvents = eventMap.get(dateKey) || [];
        const hasEvent = dayEvents.length > 0;

        const dotsHtml = hasEvent
            ? `<div class="event-dots">${dayEvents.slice(0, 4).map(f => `<span class="event-dot ${bookmarkedKeys.has(f.key) ? 'bookmarked' : ''}"></span>`).join('')}</div>`
            : '';

        calendarBody.innerHTML += `
            <div class="calendar-cell ${isToday} ${hasEvent ? 'has-event' : ''}" ${hasEvent ? `onclick="showDayDetail('${dateKey}')"` : ''}>
                <span class="calendar-date">${i}</span>
                ${dotsHtml}
            </div>
        `;
    }
}

function showDayDetail(dateKey) {
    const eventMap = buildEventMap();
    const events = eventMap.get(dateKey) || [];
    const container = document.getElementById('calendar-day-detail');
    if (events.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <div style="font-weight:700; margin-bottom:8px;">${dateKey} のイベント</div>
        ${events.map(f => `<div class="day-detail-item" onclick="showFestivalDetailByKey('${f.key}')">${bookmarkedKeys.has(f.key) ? '⭐ ' : ''}${f.title}</div>`).join('')}
    `;
}

document.getElementById('btn-prev-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
});

document.getElementById('btn-next-month').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
});

window.onload = async () => {
    await loadBookmarks();
    await fetchFestivals();
    renderCalendar();
};