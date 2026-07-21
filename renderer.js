// 🔒 데이터 소스:
// ① hubItems: 한국관광콘텐츠랩 내부 API (실시간, 이미지/설명)
// ② detailIntro2(공식 TourAPI)로 보완된 날짜
// ③ extra: 사용자가 직접 추가하는 파일 (extraFestivals.js)

// --- 탭 전환 로직 ---
const tabs = document.querySelectorAll('.menu li');
const views = document.querySelectorAll('.view-section');

function showView(id) {
    views.forEach(v => v.style.display = 'none');
    // 'block'으로 강제하면 view-home/view-bookmarks에 필요한 display:flex(CSS)를 덮어써버려서
    // 화면 전환 후 레이아웃이 깨짐 - 인라인 스타일을 아예 지워서 CSS가 알아서 결정하게 함
    document.getElementById(id).style.removeProperty('display');
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-target');
        showView(target);
        if (target === 'view-home') renderPage();
        if (target === 'view-bookmarks') renderBookmarkPage();
        if (target === 'view-calendar') renderCalendar();
    });
});

let lastViewBeforeDetail = 'view-home';

document.getElementById('detail-back-btn').addEventListener('click', () => {
    showView(lastViewBeforeDetail);
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-target') === lastViewBeforeDetail));
    if (lastViewBeforeDetail === 'view-home') renderPage();
    if (lastViewBeforeDetail === 'view-bookmarks') renderBookmarkPage();
    if (lastViewBeforeDetail === 'view-calendar') renderCalendar();
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

// 시작일=종료일(하루짜리 축제)이면 날짜를 한 번만 보여주고, 아니면 "시작 ~ 종료"로 보여줌
function formatDateRange(fest) {
    if (!fest.startDate) return '';
    const start = fest.startDate.replace(/-/g, '.');
    const end = (fest.endDate || fest.startDate).replace(/-/g, '.');
    return start === end ? start : `${start} ~ ${end}`;
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
        useFee: stripHtml(item.useFee),
        // 🇰🇷 번역 전 원문(한국어) - 상세페이지 "원문 보기" 토글용. hub 항목에만 있음(직접추가/큐레이션은 이미 일본어라 없음).
        orig: {
            title: item.orig_title || '',
            summary: item.orig_outl || '',
            address: item.orig_eventPlace || item.orig_addr1 || '',
            category: item.orig_cat2Nm || item.orig_cat1Nm || '',
            playTime: stripHtml(item.orig_playTime),
            program: stripHtml(item.orig_program),
            subEvent: stripHtml(item.orig_subEvent),
            sponsor1: stripHtml(item.orig_sponsor1),
            sponsor2: stripHtml(item.orig_sponsor2),
            ageLimit: stripHtml(item.orig_ageLimit),
            bookingPlace: stripHtml(item.orig_bookingPlace),
            discountInfo: stripHtml(item.orig_discountInfo),
            placeInfo: stripHtml(item.orig_placeInfo),
            progressType: stripHtml(item.orig_progressType),
            useFee: stripHtml(item.orig_useFee)
        }
    };
}

function normalizeSimpleItem(item) {
    return {
        title: item.title || '',
        summary: item.summary || '',
        address: item.place || item.address || '',
        category: item.category || '',
        image: item.image || '',
        homepage: extractUrl(item.homepage),
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        playTime: item.playTime || '',
        program: item.program || '',
        subEvent: item.subEvent || '',
        sponsor1: item.sponsor1 || '',
        sponsor1Tel: item.sponsor1Tel || '',
        sponsor2: item.sponsor2 || '',
        ageLimit: item.ageLimit || '',
        bookingPlace: item.bookingPlace || '',
        discountInfo: item.discountInfo || '',
        placeInfo: item.placeInfo || '',
        useFee: item.useFee || '',
        // 🇰🇷 번역 전 원문(한국어) - main.js가 채워준 orig_* 필드에서 가져옴
        orig: {
            title: item.orig_title || '',
            summary: item.orig_summary || '',
            address: item.orig_place || '',
            category: item.orig_category || '',
            playTime: item.orig_playTime || '',
            program: item.orig_program || '',
            subEvent: item.orig_subEvent || '',
            sponsor1: item.orig_sponsor1 || '',
            sponsor2: item.orig_sponsor2 || '',
            ageLimit: item.orig_ageLimit || '',
            bookingPlace: item.orig_bookingPlace || '',
            discountInfo: item.orig_discountInfo || '',
            placeInfo: item.orig_placeInfo || '',
            useFee: item.orig_useFee || ''
        }
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

function renderLoadingUI() {
    const grid = document.getElementById('festival-grid');
    // 카드가 없을 때(로딩 중)는 그리드 대신 flex로 바꿔서 화면 중앙에 오게 함
    grid.style.display = 'flex';
    grid.style.alignItems = 'center';
    grid.style.justifyContent = 'center';
    grid.innerHTML = `
        <div class="loading-box">
            <div class="spinner"></div>
            <p id="loading-text" class="loading-text">イベント情報を読み込んでいます...</p>
            <div class="loading-progress-track">
                <div id="loading-progress-bar" class="loading-progress-bar" style="width: 0%;"></div>
            </div>
            <p id="loading-subtext" class="loading-subtext"></p>
        </div>
    `;
}

function updateLoadingUI({ stage, current, total }) {
    const text = document.getElementById('loading-text');
    const sub = document.getElementById('loading-subtext');
    const bar = document.getElementById('loading-progress-bar');
    if (!text || !bar) return;

    if (stage === 'list') {
        text.textContent = 'イベント一覧を取得しています...';
        sub.textContent = '';
        bar.style.width = '5%';
    } else if (stage === 'detail') {
        text.textContent = '日程・詳細情報を取得しています...';
        sub.textContent = `${current} / ${total}`;
        bar.style.width = `${5 + (current / total) * 45}%`; // 전체의 5~50% 구간
    } else if (stage === 'translate') {
        text.textContent = '日本語に翻訳しています...';
        sub.textContent = `${current} / ${total}`;
        bar.style.width = `${50 + (current / total) * 50}%`; // 전체의 50~100% 구간
    }
}

window.api.onFetchProgress(updateLoadingUI);

async function fetchFestivals() {
    renderLoadingUI();

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
        // hub가 더 최신으로 계속 갱신되는 소스라서, 겹치면 hub 쪽을 우선함.
        // hub 데이터에 문제가 있는 특정 항목은 main.js의 HUB_EXCLUDE_KEYWORDS로 콕 집어서 걸러냄.
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
        document.getElementById('festival-grid').innerHTML = `
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
    // 로딩 중엔 flex(중앙정렬)로 바꿔놨을 수 있어서, 실제 카드 그릴 땐 그리드로 되돌림
    grid.style.display = 'grid';
    grid.style.alignItems = '';
    grid.style.justifyContent = '';
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
        const dateStr = formatDateRange(fest);

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
                ${dateStr ? `<p style="font-size: 12px; color: #515154; margin:4px 0; display:flex; align-items:center; min-width:0;">${ICON_CALENDAR}<span style="flex:1 1 auto; width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${dateStr}</span></p>` : ''}
                <p style="font-size: 12px; color: #515154; margin: 4px 0 10px 0; display:flex; align-items:center; min-width:0;" title="${location}">${ICON_PIN}<span style="flex:1 1 auto; width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">${location}</span></p>
                <span class="tag">${fest.category || 'フェスティバル・イベント'}</span>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', cardHTML);
    });
}

// --- 상세정보 화면 (별도 화면으로 전환) ---
let currentDetailFest = null;
let showingOriginalLang = false;

function openDetailForFest(fest) {
    if (!fest) return;

    // 뒤로가기 눌렀을 때 돌아갈 화면을 지금 보이는 화면으로 기억해둠
    const current = [...views].find(v => v.style.display !== 'none' && v.id !== 'view-detail');
    if (current) lastViewBeforeDetail = current.id;

    currentDetailFest = fest;
    showingOriginalLang = false;
    renderDetailContent();

    tabs.forEach(t => t.classList.remove('active'));
    showView('view-detail');
}

function showFestivalDetail(idx) {
    openDetailForFest(currentPageItems[idx]);
}

function toggleOriginalLanguage() {
    showingOriginalLang = !showingOriginalLang;
    renderDetailContent();
}

function copyLinkToClipboard(url, btnEl) {
    navigator.clipboard.writeText(url).then(() => {
        const original = btnEl.innerHTML;
        btnEl.innerHTML = '✓';
        btnEl.classList.add('copied');
        setTimeout(() => {
            btnEl.innerHTML = original;
            btnEl.classList.remove('copied');
        }, 1200);
    }).catch(() => {
        // 복사 실패해도 조용히 무시 (앱이 안 죽게)
    });
}

function renderDetailContent() {
    const fest = currentDetailFest;
    if (!fest) return;

    // orig(원문 한국어)가 있고 지금 원문 모드면, 번역 가능했던 필드만 원문 값으로 덮어씀
    // (날짜/이미지/URL처럼 번역 대상이 아닌 값은 항상 fest 그대로)
    const d = (showingOriginalLang && fest.orig) ? { ...fest, ...fest.orig } : fest;

    // 원문(한국어) 모드일 땐 라벨도 한국어로, 아니면 일본어로
    const L = showingOriginalLang
        ? { playTime: '시간', sponsor1: '주최', sponsor2: '주관', ageLimit: '관람가능연령', bookingPlace: '예약', useFee: '요금', discountInfo: '할인정보', spendTime: '관람소요시간', placeInfo: '위치안내', program: '프로그램', subEvent: '부대행사', noPlace: '장소미정', noDate: '일정미정', officialSite: '공식사이트를 보기 →' }
        : { playTime: '時間', sponsor1: '主催', sponsor2: '主管', ageLimit: '観覧可能年齢', bookingPlace: '予約', useFee: '料金', discountInfo: '割引情報', spendTime: '観覧所要時間', placeInfo: '位置案内', program: 'プログラム', subEvent: '付帯行事', noPlace: '場所未定', noDate: '日程未定', officialSite: '公式サイトを見る →' };

    const dateStr = formatDateRange(fest) || L.noDate;
    const summary = d.summary ? d.summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

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

    // 진짜 원문이 있을 때만(내용이 있고, 지금 보이는 텍스트랑 실제로 다를 때만) 버튼을 보여줌.
    // 예전 캐시처럼 orig 필드가 비어있는 경우엔 버튼 자체를 숨김 (눌러도 아무 변화 없는 상황 방지)
    const hasRealOrig = Boolean(fest.orig && fest.orig.title && fest.orig.title.trim() && fest.orig.title !== fest.title);
    const origToggleHtml = hasRealOrig
        ? `<button class="detail-orig-toggle-btn" onclick="toggleOriginalLanguage()">${showingOriginalLang ? '🇯🇵 日本語で見る' : '🇰🇷 原文（韓国語）を見る'}</button>`
        : '';

    // 값이 있는 항목만 표로 보여줌 (빈 줄 안 생기게)
    const infoRows = [
        [ICON_CALENDAR, dateStr],
        [ICON_PIN, d.address || L.noPlace],
        [ICON_DOT, d.category],
        [ICON_DOT, d.playTime && `${L.playTime}: ${d.playTime}`],
        [ICON_DOT, d.sponsor1 && `${L.sponsor1}: ${d.sponsor1}${fest.sponsor1Tel ? ' (' + fest.sponsor1Tel + ')' : ''}`],
        [ICON_DOT, d.sponsor2 && `${L.sponsor2}: ${d.sponsor2}`],
        [ICON_DOT, d.ageLimit && `${L.ageLimit}: ${d.ageLimit}`],
        [ICON_DOT, d.bookingPlace && `${L.bookingPlace}: ${d.bookingPlace}`],
        [ICON_DOT, d.useFee && `${L.useFee}: ${d.useFee}`],
        [ICON_DOT, d.discountInfo && `${L.discountInfo}: ${d.discountInfo}`],
        [ICON_DOT, fest.spendTime && `${L.spendTime}: ${fest.spendTime}`],
        [ICON_DOT, d.placeInfo && `${L.placeInfo}: ${d.placeInfo}`]
    ].filter(([, text]) => Boolean(text));

    const rowsHtml = infoRows.map(([icon, text]) =>
        `<div class="detail-row"><span class="label">${icon}</span><span>${text}</span></div>`
    ).join('');

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-layout">
            <div class="detail-layout-image">${imageHtml}</div>
            <div class="detail-card">
                ${badgeHtml}
                <h2>${d.title || ''}</h2>
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
                    ${bookmarkBtnHtml}
                    ${origToggleHtml}
                </div>
                ${rowsHtml}
                ${summary ? `<p class="detail-summary">${summary}</p>` : ''}
                ${d.program ? `<p class="detail-summary"><strong>${L.program}</strong><br>${d.program}</p>` : ''}
                ${d.subEvent ? `<p class="detail-summary"><strong>${L.subEvent}</strong><br>${d.subEvent}</p>` : ''}
                ${fest.homepage ? `
                <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                    <a class="detail-link" href="${fest.homepage}" target="_blank" rel="noopener">${L.officialSite}</a>
                    <button class="copy-link-btn" onclick="copyLinkToClipboard('${fest.homepage}', this)" title="${showingOriginalLang ? 'URL 복사' : 'URLをコピー'}">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                </div>` : ''}
            </div>
        </div>
    `;
}

function showFestivalDetailByKey(key) {
    const fest = allFestivalsCache.find(f => f.key === key);
    openDetailForFest(fest);
}

// --- 📅 달력 로직 (축제 날짜 표시 + 클릭 시 목록) ---
let currentDate = new Date(2026, 6, 1);

// 특정 날짜에 "진행 중인" 축제 전부 반환 (하루짜리든 여러날짜든 다 포함)
// ⚠️ API 쪽 데이터 품질 문제로 가끔 "연중 상시"(1년 내내) 같은 이상한 기간이 들어올 때가 있어서,
// 30일 넘게 계속되는 항목은 "특정 날짜 정보"로서 의미가 없다고 보고 캘린더에서는 제외함
// (홈 화면 카드 목록에는 정상적으로 계속 보임, 캘린더 표시에서만 뺌)
const CALENDAR_MAX_DURATION_DAYS = 30;

function getEventsForDate(dateObj) {
    return allFestivalsCache.filter(f => {
        const start = parseIso(f.startDate);
        if (!start) return false;
        const end = parseIso(f.endDate) || start;
        const durationDays = (end - start) / 86400000;
        if (durationDays > CALENDAR_MAX_DURATION_DAYS) return false;
        return dateObj >= start && dateObj <= end;
    });
}

function dateKeyOf(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const CAL_MAX_LANES = 3;
const CAL_BAR_HEIGHT = 18;
const CAL_BAR_GAP = 3;
const CAL_TOP_OFFSET = 38; // 셀 안쪽 여백(10px) + 날짜 숫자 높이/여백까지 포함해서 안 겹치게

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    const calendarBody = document.getElementById('calendar-body');
    calendarBody.innerHTML = '';
    document.getElementById('calendar-day-detail').innerHTML = '';

    for (let i = 0; i < firstDayIndex; i++) {
        calendarBody.innerHTML += `<div class="calendar-cell empty"></div>`;
    }

    const today = new Date();
    for (let i = 1; i <= lastDay; i++) {
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) ? 'today' : '';
        const dateKey = dateKeyOf(year, month, i);
        calendarBody.innerHTML += `
            <div class="calendar-cell ${isToday}" data-day="${i}" onclick="showDayDetail('${dateKey}')">
                <span class="calendar-date">${i}</span>
            </div>
        `;
    }

    // 이벤트 막대는 각 칸 "안"이 아니라, 달력 전체 위에 실제 픽셀 좌표를 계산해서 겹쳐 그림
    // (같은 축제는 항상 같은 세로 위치를 유지해서 끊기지 않고 이어지게 하기 위함)
    renderEventOverlayBars(year, month, lastDay);
}

function renderEventOverlayBars(year, month, lastDay) {
    const calendarBody = document.getElementById('calendar-body');
    calendarBody.style.position = 'relative';

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, lastDay);

    // 이번 달에 걸쳐있는 축제만 추출하고, 이번 달 범위로 날짜를 잘라냄
    const items = allFestivalsCache.map(f => {
        const start = parseIso(f.startDate);
        if (!start) return null;
        const end = parseIso(f.endDate) || start;
        const durationDays = (end - start) / 86400000;
        if (durationDays > CALENDAR_MAX_DURATION_DAYS) return null;
        if (end < monthStart || start > monthEnd) return null;
        return {
            fest: f,
            clipStart: start < monthStart ? monthStart : start,
            clipEnd: end > monthEnd ? monthEnd : end
        };
    }).filter(Boolean);

    // 겹치는 축제끼리 서로 다른 "레인(세로 줄)"에 배정 (구글 캘린더식 interval scheduling)
    items.sort((a, b) => a.clipStart - b.clipStart || (b.clipEnd - b.clipStart) - (a.clipEnd - a.clipStart));
    const laneEndDates = [];
    items.forEach(it => {
        let lane = 0;
        while (laneEndDates[lane] !== undefined && laneEndDates[lane] >= it.clipStart) lane++;
        it.lane = lane;
        laneEndDates[lane] = it.clipEnd;
    });

    // 레인이 너무 많아지는 날은 막대 대신 "+N"으로만 표시
    const overflowCountByDay = {};
    const segments = [];

    items.forEach(it => {
        if (it.lane >= CAL_MAX_LANES) {
            const d = new Date(it.clipStart);
            while (d <= it.clipEnd) {
                overflowCountByDay[d.getDate()] = (overflowCountByDay[d.getDate()] || 0) + 1;
                d.setDate(d.getDate() + 1);
            }
            return;
        }

        // 주(일~토) 경계에서 끊어서 막대 세그먼트로 나눔
        let segStart = new Date(it.clipStart);
        while (segStart <= it.clipEnd) {
            const daysLeftInRow = 6 - segStart.getDay();
            let segEnd = new Date(segStart);
            segEnd.setDate(segEnd.getDate() + daysLeftInRow);
            if (segEnd > it.clipEnd) segEnd = new Date(it.clipEnd);

            segments.push({
                fest: it.fest,
                lane: it.lane,
                startDay: segStart.getDate(),
                endDay: segEnd.getDate(),
                isTrueStart: segStart.getTime() === it.clipStart.getTime(),
                isTrueEnd: segEnd.getTime() === it.clipEnd.getTime()
            });

            segStart = new Date(segEnd);
            segStart.setDate(segStart.getDate() + 1);
        }
    });

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; pointer-events:none;';
    calendarBody.appendChild(overlay);

    const bodyRect = calendarBody.getBoundingClientRect();

    segments.forEach(seg => {
        const startCell = calendarBody.querySelector(`.calendar-cell[data-day="${seg.startDay}"]`);
        const endCell = calendarBody.querySelector(`.calendar-cell[data-day="${seg.endDay}"]`);
        if (!startCell || !endCell) return;

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const isBookmarked = bookmarkedKeys.has(seg.fest.key);

        const bar = document.createElement('div');
        bar.className = `calendar-event-bar ${seg.isTrueStart ? 'bar-start' : ''} ${seg.isTrueEnd ? 'bar-end' : ''} ${isBookmarked ? 'bookmarked' : ''}`;
        bar.style.position = 'absolute';
        bar.style.left = `${startRect.left - bodyRect.left}px`;
        bar.style.width = `${endRect.right - startRect.left}px`;
        bar.style.top = `${startRect.top - bodyRect.top + CAL_TOP_OFFSET + seg.lane * (CAL_BAR_HEIGHT + CAL_BAR_GAP)}px`;
        bar.style.height = `${CAL_BAR_HEIGHT}px`;
        bar.style.pointerEvents = 'auto';
        bar.style.cursor = 'pointer';
        bar.textContent = seg.isTrueStart ? (isBookmarked ? `★ ${seg.fest.title}` : seg.fest.title) : '';
        bar.onclick = (e) => {
            e.stopPropagation();
            showFestivalDetailByKey(seg.fest.key);
        };
        overlay.appendChild(bar);
    });

    Object.keys(overflowCountByDay).forEach(dayStr => {
        const day = parseInt(dayStr, 10);
        const cell = calendarBody.querySelector(`.calendar-cell[data-day="${day}"]`);
        if (!cell) return;
        const rect = cell.getBoundingClientRect();

        const moreEl = document.createElement('div');
        moreEl.className = 'calendar-event-more';
        moreEl.style.position = 'absolute';
        moreEl.style.left = `${rect.left - bodyRect.left + 4}px`;
        moreEl.style.top = `${rect.top - bodyRect.top + CAL_TOP_OFFSET + CAL_MAX_LANES * (CAL_BAR_HEIGHT + CAL_BAR_GAP)}px`;
        moreEl.textContent = `+${overflowCountByDay[day]}件`;
        overlay.appendChild(moreEl);
    });
}

function showDayDetail(dateKey) {
    const m = dateKey.match(/(\d{4})-(\d{2})-(\d{2})/);
    const events = getEventsForDate(new Date(+m[1], +m[2] - 1, +m[3]));
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

window.addEventListener('resize', () => {
    if (document.getElementById('view-calendar').style.display !== 'none') {
        renderCalendar();
    }
});

window.onload = async () => {
    // 스플래시는 데이터 로딩과 무관하게, 최소 2.2초 보여준 뒤 서서히 사라짐
    setTimeout(() => {
        const splash = document.getElementById('splash-overlay');
        splash.classList.add('hide');
        setTimeout(() => splash.remove(), 500);
    }, 2200);

    await loadBookmarks();
    await fetchFestivals();
    renderCalendar();
};