"use strict";

// ---- 상수 ----
const API_BASE = "https://open.api.nexon.com";
const CHAR_LIST_PATH = "/maplestory/v1/character/list";
const CHAR_STATE_PATH = "/maplestory/v1/scheduler/character-state";
const SEQUENTIAL_DELAY_MS = 150;

const DIFFICULTY_LABEL = {
  easy: "이지",
  normal: "노말",
  hard: "하드",
  chaos: "카오스",
  extreme: "익스트림",
};

const DAY_LABELS_FULL = ["일", "월", "화", "수", "목", "금", "토"]; // index = day 값 (0=일...6=토)
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 화면 표시 순서: 월화수목금토일

const WORLD_PALETTE = ["#a97bff", "#58b8f0", "#58e0a8", "#ffb454", "#ff8a8a", "#7cd4ff"];
const ACCOUNT_WEEKLY_LIMIT = 90; // 계정 전체 주간 결정석 한도. 캐릭터별 API 한도 합산이 아니라 항상 고정값

// ---- 드랍템 카탈로그 (07 §5) ----
const COMMON_DROP = "시드링";
const BOSS_DROPS = {
  스우: ["루즈 컨트롤 머신 마크", "컴플리트 언더컨트롤(익스)"],
  데미안: ["마력이 깃든 안대"],
  루시드: ["몽환의 벨트", "트와일라이트 마크"],
  윌: ["저주받은 마도서", "트와일라이트 마크"],
  더스크: ["거대한 공포", "에스텔라 이어링"],
  "진 힐라": ["고통의 근원", "데이브레이크 펜던트"],
  듄켈: ["커맨더 포스 이어링", "에스텔라 이어링"],
  "선택받은 세렌": ["미트라의 분노", "데이브레이크 펜던트", "익셉셔널 해머"], // API 실제 content_name은 "세렌"이 아니라 "선택받은 세렌"
  "검은 마법사": ["창세의 뱃지", "익셉셔널 해머"],
  "가디언 엔젤 슬라임": ["여명의 가디언 엔젤 링"],
};
const CHILHEUK_9 = [
  "루즈 컨트롤 머신 마크",
  "컴플리트 언더컨트롤",
  "마력이 깃든 안대",
  "몽환의 벨트",
  "저주받은 마도서",
  "거대한 공포",
  "커맨더 포스 이어링",
  "고통의 근원",
  "미트라의 분노",
];
const KALOS_TIER_COMMON = CHILHEUK_9.concat(["연마석", "에테르넬 교환 아이템"]);
const KALOS_TIER_EXTRA = {
  "감시자 칼로스": ["익셉셔널 해머"],
  카링: ["익셉셔널 해머"],
  "최초의 대적자": ["불멸의 유산"],
  림보: ["근원의 속삭임"],
  발드릭스: ["죽음의 맹세"],
  "찬란한 흉성": ["황홀한 악몽"],
  유피테르: [],
};

function dropItemsFor(contentName) {
  if (Object.prototype.hasOwnProperty.call(KALOS_TIER_EXTRA, contentName)) {
    return [COMMON_DROP].concat(KALOS_TIER_COMMON, KALOS_TIER_EXTRA[contentName]);
  }
  if (Object.prototype.hasOwnProperty.call(BOSS_DROPS, contentName)) {
    return [COMMON_DROP].concat(BOSS_DROPS[contentName]);
  }
  return [COMMON_DROP];
}

// ---- localStorage 저장소 ----
const STORE = {
  apiKey: "mbn.apiKey",
  characters: "mbn.characters",
  tracked: "mbn.tracked",
  settings: "mbn.settings",
  cache: "mbn.cache",
  schedule: "mbn.schedule",
  loot: "mbn.loot",
  postponed: "mbn.postponed",
  lastReset: "mbn.lastReset",
};

function loadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getApiKey() {
  return localStorage.getItem(STORE.apiKey) || "";
}
function setApiKey(key) {
  localStorage.setItem(STORE.apiKey, key);
}
function getCharacters() {
  return loadJSON(STORE.characters, []);
}
function setCharacters(list) {
  saveJSON(STORE.characters, list);
  pruneCache();
}
function getTracked() {
  return loadJSON(STORE.tracked, {});
}
function setTracked(map) {
  saveJSON(STORE.tracked, map);
}
function getSettings() {
  return loadJSON(STORE.settings, { defaultFeeRate: 0.03, splitByWorld: false });
}
function setSettings(s) {
  saveJSON(STORE.settings, s);
}
function getCache() {
  return loadJSON(STORE.cache, {});
}
function setCache(c) {
  saveJSON(STORE.cache, c);
}
function getSchedule() {
  return loadJSON(STORE.schedule, {});
}
function setSchedule(s) {
  saveJSON(STORE.schedule, s);
}
function getLoot() {
  return loadJSON(STORE.loot, []);
}
function setLoot(l) {
  saveJSON(STORE.loot, l);
}
function getPostponed() {
  return loadJSON(STORE.postponed, {});
}
function setPostponed(p) {
  saveJSON(STORE.postponed, p);
}
function getLastReset() {
  return loadJSON(STORE.lastReset, null);
}
function setLastReset(ms) {
  saveJSON(STORE.lastReset, ms);
}
function pruneCache() {
  const valid = new Set(getCharacters().map((c) => c.ocid));
  const cache = getCache();
  let changed = false;
  for (const ocid of Object.keys(cache)) {
    if (!valid.has(ocid)) {
      delete cache[ocid];
      changed = true;
    }
  }
  if (changed) setCache(cache);
}

function bossKey(name, difficulty) {
  return name + "|" + difficulty;
}
function scheduleKey(ocid, name, difficulty) {
  return ocid + "|" + name + "|" + difficulty;
}
function cryptoId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Date.now() + "-" + Math.random().toString(36).slice(2);
}

// ---- KST 시간 ----
// Date.getTime()은 항상 UTC epoch이므로, 여기에 9시간을 더해 UTC 메서드로 읽으면
// 폰의 로컬 시간대와 무관하게 KST 벽시계 값을 얻을 수 있다.
function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function kstPartsToUtcMs(y, m, d, h) {
  return Date.UTC(y, m, d, h, 0, 0) - 9 * 3600 * 1000;
}
function kstDow() {
  return kstNow().getUTCDay(); // 0=일 ... 6=토
}
function kstDateStr(k) {
  k = k || kstNow();
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, "0");
  const d = String(k.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function kstTodayLabel() {
  const k = kstNow();
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${DAY_LABELS_FULL[k.getUTCDay()]}요일`;
}
function shortDateLabel(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}월 ${d}일`;
}
function daysSince(dateStr) {
  const today = kstDateStr();
  const a = Date.UTC(...today.split("-").map(Number));
  const b = Date.UTC(...dateStr.split("-").map(Number));
  return Math.round((a - b) / 86400000);
}
function nextWeeklyResetEpochMs() {
  const k = kstNow();
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();
  const d = k.getUTCDate();
  const todayResetMs = kstPartsToUtcMs(y, m, d, 0);
  const dow = k.getUTCDay(); // 0=일 ... 4=목
  let daysUntilThu = (4 - dow + 7) % 7;
  if (daysUntilThu === 0 && Date.now() >= todayResetMs) {
    daysUntilThu = 7; // 오늘이 목요일이고 이미 리셋 시각을 지났으면 다음 주
  }
  return kstPartsToUtcMs(y, m, d + daysUntilThu, 0);
}
function formatCountdown(targetEpochMs) {
  const diff = targetEpochMs - Date.now();
  if (diff <= 0) return "0시간";
  const totalHours = Math.floor(diff / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}일 ${hours}시간`;
  return `${hours}시간`;
}
// ---- 주간 리셋 처리 (§4) ----
// 값이 없다 = 아직 한 번도 처리 안 했다 = 처리할 게 없다. 0으로 초기화하면 첫 실행에
// 방금 넣은 스케줄이 전부 비워지므로 반드시 이 형태로 써야 한다.
function checkWeeklyReset() {
  const prevReset = nextWeeklyResetEpochMs() - 7 * 86400000;
  const last = getLastReset();
  if (last === null) {
    setLastReset(prevReset);
    return;
  }
  if (last < prevReset) {
    applyWeeklyReset();
    setLastReset(prevReset);
  }
}
function applyWeeklyReset() {
  const schedule = getSchedule();
  let changed = false;
  for (const key of Object.keys(schedule)) {
    const s = schedule[key];
    if (!s.fixed && (s.day !== null || s.time)) {
      s.day = null;
      s.time = "";
      changed = true;
    }
  }
  if (changed) setSchedule(schedule);
  setPostponed({});
}
// "HH:MM" 문자열을 오늘 KST 날짜 기준 epoch ms로 변환한다 (§3-1 자동 판정용)
function kstTimeTodayEpochMs(timeStr) {
  const [hh, mm] = timeStr.split(":").map(Number);
  const k = kstNow();
  return kstPartsToUtcMs(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), hh) + (mm || 0) * 60000;
}
function formatAgo(days) {
  if (days <= 0) return "오늘 밀림";
  if (days === 1) return "어제";
  return `${days}일 밀림`;
}

// ---- API 호출 ----
function apiUrl(path, params) {
  const url = new URL(API_BASE + path);
  const sp = new URLSearchParams();
  for (const k in params) {
    if (params[k] !== undefined && params[k] !== null) sp.set(k, params[k]);
  }
  url.search = sp.toString();
  return url.toString();
}

async function callApi(path, params) {
  const apiKey = getApiKey();
  const url = apiUrl(path, params);
  let res;
  try {
    res = await fetch(url, { headers: { "x-nxopen-api-key": apiKey } });
  } catch (e) {
    return { ok: false, network: true };
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, network: true };
  }
  if (!res.ok || body.error) {
    return { ok: false, network: false, code: body.error && body.error.name, message: body.error && body.error.message };
  }
  return { ok: true, data: body };
}

function fetchCharacterList() {
  return callApi(CHAR_LIST_PATH, {});
}
function fetchCharacterState(ocid) {
  return callApi(CHAR_STATE_PATH, { ocid });
}

// ---- 분배 계산 (안 A: 수수료 전원 공평 부담) ----
// R = 실수령, A = 총대가 1명에게 보낼 금액, 파티원 실수령 = A*(1-f)
function calcDistribution(sale, feeRate, partySize) {
  const net = sale * (1 - feeRate);
  const sendPerPerson = net / (partySize - feeRate);
  const partnerReceive = sendPerPerson * (1 - feeRate);
  return { net, sendPerPerson, partnerReceive };
}
function floorHundred(x) {
  return Math.floor(x / 100) * 100;
}
function formatInt(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function parseMoney(str) {
  const n = parseInt(String(str).replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- 탭 전환 ----
function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
      document.getElementById("tab" + capitalize(btn.dataset.tab)).hidden = false;
      if (btn.dataset.tab === "character") showCharList();
    });
  });
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ==================================================================
// 탭 1 — 오늘
// ==================================================================
let remainExpanded = false; // "남은 것 전부" 펼침 상태. 60초 재렌더 중에도 유지(§2-3-b 3번)

function renderToday() {
  const characters = getCharacters();
  const emptyHint = document.getElementById("todayEmptyHint");
  const sections = [document.querySelector("#tabToday .top"), document.getElementById("weeklySection"), document.getElementById("lateSection"), document.getElementById("partySection"), document.getElementById("recommendedSection"), document.getElementById("remainSection")];

  if (characters.length === 0) {
    emptyHint.hidden = false;
    sections.forEach((s) => (s.style.display = "none"));
    return;
  }
  emptyHint.hidden = true;
  sections.forEach((s) => (s.style.display = ""));

  document.getElementById("todayDateLabel").textContent = kstTodayLabel();
  document.getElementById("weeklyResetLine").innerHTML = `주간 리셋까지 <b class="num">${formatCountdown(nextWeeklyResetEpochMs())}</b>`;

  const cache = getCache();
  const tracked = getTracked();
  const schedule = getSchedule();
  const postponed = getPostponed();
  const todayDow = kstDow();

  // §2-3-b 1: "오늘 일정 있는 캐릭터" = 그 캐릭터의 보스 중 day===오늘인 스케줄이 하나라도 있는 캐릭터.
  // party 여부·time은 안 본다.
  const todayScheduledOcids = new Set();
  for (const ch of characters) {
    const trackedList = tracked[ch.ocid] || [];
    for (const tb of trackedList) {
      if (tb.cycle === "bossDaily") continue;
      const sched = schedule[scheduleKey(ch.ocid, tb.name, tb.difficulty)];
      if (sched && sched.day === todayDow) {
        todayScheduledOcids.add(ch.ocid);
        break;
      }
    }
  }

  const late = [];
  const party = [];
  const remain = [];
  const recommendedCountByOcid = new Map();
  let sumCount = 0;
  const worldTotals = new Map(); // world -> {count, limit}
  let postponedChanged = false;

  for (const ch of characters) {
    const entry = cache[ch.ocid];
    if (entry) {
      const p = entry.payload;
      sumCount += p.weekly_boss_clear_count || 0;
      const wt = worldTotals.get(ch.world) || { count: 0, limit: 0 };
      wt.count += p.weekly_boss_clear_count || 0;
      wt.limit += p.weekly_boss_clear_limit_count || 0;
      worldTotals.set(ch.world, wt);
    }
    const byKey = entry ? new Map((entry.payload.boss_contents || []).map((b) => [bossKey(b.content_name, b.difficulty), b])) : new Map();
    const trackedList = tracked[ch.ocid] || [];
    for (const tb of trackedList) {
      if (tb.cycle === "bossDaily") continue;
      const live = byKey.get(bossKey(tb.name, tb.difficulty));
      const done = !!(live && live.complete_flag === "true");
      const key = scheduleKey(ch.ocid, tb.name, tb.difficulty);
      if (done) {
        if (postponed[key]) {
          delete postponed[key];
          postponedChanged = true;
        }
        continue;
      }
      const sched = schedule[key] || { party: false };
      let pp = postponed[key];
      const isPartyToday = sched.party && sched.time && sched.day === todayDow;

      // §3-1: 파티 약속(day===오늘, time 지정)이고 약속시간+1시간이 지났고 아직 postponed가
      // 없으면(=한 번도 판정 안 됐으면) 자동으로 밀린 것으로 올린다.
      if (!pp && isPartyToday && Date.now() > kstTimeTodayEpochMs(sched.time) + 3600000) {
        pp = { since: kstDateStr(), memo: "", auto: true };
        postponed[key] = pp;
        postponedChanged = true;
      }

      if (pp && !pp.off) {
        late.push({ ch, tb, sched, since: pp.since, memo: pp.memo });
      } else if (isPartyToday) {
        party.push({ ch, tb, sched });
      } else if (todayScheduledOcids.has(ch.ocid)) {
        recommendedCountByOcid.set(ch.ocid, (recommendedCountByOcid.get(ch.ocid) || 0) + 1);
      } else {
        remain.push({ ch, tb, sched });
      }
    }
  }
  if (postponedChanged) setPostponed(postponed);

  late.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  party.sort((a, b) => (a.sched.time < b.sched.time ? -1 : a.sched.time > b.sched.time ? 1 : 0));

  const recommendedTotal = Array.from(recommendedCountByOcid.values()).reduce((a, b) => a + b, 0);
  document.getElementById("remainCount").textContent = late.length + party.length + recommendedTotal;

  renderWeeklySection(sumCount, worldTotals, characters);

  toggleSec("lateSection", late.length > 0);
  document.getElementById("lateRows").innerHTML = late.map(rowHtmlLate).join("");
  toggleSec("partySection", party.length > 0);
  document.getElementById("partyRows").innerHTML = party.map(rowHtmlParty).join("");

  // §2-3-b 2: 뺐더니 0개가 된 캐릭터는 recommendedCountByOcid에 아예 안 들어오므로 자연히 빠진다.
  toggleSec("recommendedSection", recommendedCountByOcid.size > 0);
  document.getElementById("recommendedRows").innerHTML = characters
    .filter((ch) => recommendedCountByOcid.has(ch.ocid))
    .map((ch) => `<div class="crow" data-ocid="${ch.ocid}"><span class="cn2">${escapeHtml(ch.name)}</span><span class="cnt">${recommendedCountByOcid.get(ch.ocid)}개</span></div>`)
    .join("");

  const remainCountByOcid = new Map();
  remain.forEach((item) => remainCountByOcid.set(item.ch.ocid, (remainCountByOcid.get(item.ch.ocid) || 0) + 1));
  toggleSec("remainSection", remain.length > 0);
  document.getElementById("remainToggle").textContent = `${remainExpanded ? "▾" : "▸"} 남은 것 전부 보기 (${remain.length}개)`;
  const remainRowsEl = document.getElementById("remainRows");
  remainRowsEl.hidden = !remainExpanded;
  remainRowsEl.innerHTML = characters
    .filter((ch) => remainCountByOcid.has(ch.ocid))
    .map((ch) => `<div class="crow" data-ocid="${ch.ocid}"><span class="cn2">${escapeHtml(ch.name)}</span><span class="cnt">${remainCountByOcid.get(ch.ocid)}개</span></div>`)
    .join("");

  wireTodayRowClicks();
}

function goToCharacterDetail(ocid) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "character"));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
  document.getElementById("tabCharacter").hidden = false;
  showCharDetail(ocid);
}

function toggleSec(id, show) {
  document.getElementById(id).classList.toggle("empty", !show);
}

function renderWeeklySection(sumCount, worldTotals, characters) {
  const el = document.getElementById("weeklySection");
  el.style.display = "";
  const overflow = sumCount > ACCOUNT_WEEKLY_LIMIT;
  const totHtml = `<span class="num">${sumCount}</span> <i class="num">/ ${ACCOUNT_WEEKLY_LIMIT}</i>` + (overflow ? `<em class="num">+${sumCount - ACCOUNT_WEEKLY_LIMIT}</em>` : "");

  const settings = getSettings();
  if (settings.splitByWorld && worldTotals.size > 1) {
    const worldOrder = [];
    characters.forEach((c) => {
      if (worldTotals.has(c.world) && !worldOrder.includes(c.world)) worldOrder.push(c.world);
    });
    const bars = worldOrder
      .map((w, i) => {
        const wt = worldTotals.get(w);
        const width = Math.min(100, (wt.count / ACCOUNT_WEEKLY_LIMIT) * 100);
        return `<i style="width:${width}%;background:${WORLD_PALETTE[i % WORLD_PALETTE.length]}"></i>`;
      })
      .join("");
    const legend = worldOrder
      .map((w, i) => {
        const wt = worldTotals.get(w);
        return `<div><span class="swatch" style="background:${WORLD_PALETTE[i % WORLD_PALETTE.length]}"></span><span class="nm">${escapeHtml(w)}</span><span class="vl num">${wt.count}</span></div>`;
      })
      .join("");
    el.innerHTML = `<div class="wk-head"><h3>이번 주 결정석</h3><div class="tot">${totHtml}</div></div><div class="wk-bar">${bars}</div><div class="wk-legend">${legend}</div>`;
  } else {
    const barStyle = overflow ? "width:100%;background:linear-gradient(90deg,#a97bff,#ffb454)" : `width:${Math.min(100, (sumCount / ACCOUNT_WEEKLY_LIMIT) * 100)}%;background:#a97bff`;
    el.innerHTML = `<div class="wk-head"><h3>이번 주 결정석</h3><div class="tot">${totHtml}</div></div><div class="wk-bar"><i style="${barStyle}"></i></div>`;
  }
}

function bossLabel(tb) {
  const monthly = tb.cycle === "bossMonthly" ? ` <span class="mon-badge">월간</span>` : "";
  return `${DIFFICULTY_LABEL[tb.difficulty] || tb.difficulty} ${escapeHtml(tb.name)}${monthly}`;
}

function rowHtmlLate(item) {
  const gc = item.sched.party ? "var(--c-party)" : "var(--c-solo)";
  const who = item.memo ? `${escapeHtml(item.ch.name)} · ${escapeHtml(item.memo)}` : escapeHtml(item.ch.name);
  return `<div class="row clickable" data-ocid="${item.ch.ocid}" data-name="${escapeHtml(item.tb.name)}" data-difficulty="${item.tb.difficulty}">
    <span class="gem" style="--gc:${gc}"></span>
    <span class="info"><span class="boss">${bossLabel(item.tb)}</span> <span class="who">${who}</span></span>
    <span class="ago">${formatAgo(daysSince(item.since))}</span>
  </div>`;
}
function rowHtmlParty(item) {
  return `<div class="row clickable" data-ocid="${item.ch.ocid}" data-name="${escapeHtml(item.tb.name)}" data-difficulty="${item.tb.difficulty}">
    <span class="gem" style="--gc:var(--c-party)"></span>
    <span class="info"><span class="boss">${bossLabel(item.tb)}</span> <span class="who">${escapeHtml(item.ch.name)}</span></span>
    <span class="when"><span class="time num">${item.sched.time}</span></span>
  </div>`;
}
function wireTodayRowClicks() {
  document.querySelectorAll("#tabToday .row.clickable").forEach((row) => {
    row.addEventListener("click", () => {
      const ocid = row.dataset.ocid;
      const tracked = getTracked()[ocid] || [];
      const tb = tracked.find((t) => t.name === row.dataset.name && t.difficulty === row.dataset.difficulty);
      if (tb) openBossSheet(ocid, tb);
    });
  });
  document.querySelectorAll("#tabToday .crow").forEach((row) => {
    row.addEventListener("click", () => goToCharacterDetail(row.dataset.ocid));
  });
  const remainToggle = document.getElementById("remainToggle");
  if (remainToggle) {
    remainToggle.onclick = () => {
      remainExpanded = !remainExpanded;
      renderToday();
    };
  }
}

// ==================================================================
// 탭 2 — 캐릭터
// ==================================================================
let currentCharDetailOcid = null;

function showCharList() {
  currentCharDetailOcid = null;
  document.getElementById("charListView").hidden = false;
  document.getElementById("charDetailView").hidden = true;
  document.getElementById("bossPickerView").hidden = true;
  renderCharList();
}
function showCharDetail(ocid) {
  currentCharDetailOcid = ocid;
  document.getElementById("charListView").hidden = true;
  document.getElementById("charDetailView").hidden = false;
  document.getElementById("bossPickerView").hidden = true;
  renderCharDetail(ocid);
}
function showBossPicker() {
  document.getElementById("charListView").hidden = true;
  document.getElementById("charDetailView").hidden = true;
  document.getElementById("bossPickerView").hidden = false;
  renderBossPicker(currentCharDetailOcid);
}

// 관리 목록(mbn.tracked) 기준 이번 주 진행. API의 결정석 한도(12)와는 세는 대상이 다르다.
// 분모 = 앱에서 관리 중인 보스 개수, 분자 = 그중 complete_flag가 켜진 개수.
function trackedProgress(ocid, cacheEntry) {
  const tracked = getTracked()[ocid] || [];
  if (!cacheEntry || tracked.length === 0) return null;
  const byKey = new Map((cacheEntry.payload.boss_contents || []).map((b) => [bossKey(b.content_name, b.difficulty), b]));
  let done = 0;
  tracked.forEach((tb) => {
    const live = byKey.get(bossKey(tb.name, tb.difficulty));
    if (live && live.complete_flag === "true") done++;
  });
  return { done, total: tracked.length };
}

// 레벨 높은 순. 관리 보스를 다 끝낸 캐릭터는 맨 아래로 내린다.
function sortCharacters(characters, cache) {
  const isDone = (ch) => {
    const p = trackedProgress(ch.ocid, cache[ch.ocid]);
    return p && p.done >= p.total ? 1 : 0;
  };
  return characters.slice().sort((a, b) => isDone(a) - isDone(b) || b.level - a.level);
}

function renderCharList() {
  const characters = getCharacters();
  const listEl = document.getElementById("charList");
  const emptyHint = document.getElementById("charEmptyHint");
  document.getElementById("charCountSub").textContent = characters.length > 0 ? `${characters.length}명` : "";
  if (characters.length === 0) {
    listEl.innerHTML = "";
    emptyHint.hidden = false;
    return;
  }
  emptyHint.hidden = true;
  const cache = getCache();
  const loot = getLoot();
  listEl.innerHTML = sortCharacters(characters, cache)
    .map((ch) => renderCcard(ch, cache[ch.ocid], loot.filter((l) => l.ocid === ch.ocid).length))
    .join("");
  listEl.querySelectorAll(".ccard").forEach((card) => {
    card.addEventListener("click", () => showCharDetail(card.dataset.ocid));
  });
}

function renderCcard(ch, cacheEntry, lootCount) {
  let progHtml = "";
  const prog = trackedProgress(ch.ocid, cacheEntry);
  if (prog) {
    const p = cacheEntry.payload;
    const width = Math.min(100, (prog.done / prog.total) * 100);
    const crystal = p.weekly_boss_clear_limit_count > 0 ? `<div class="crystal num">결정석 ${p.weekly_boss_clear_count} / ${p.weekly_boss_clear_limit_count}</div>` : "";
    progHtml = `<div class="prog"><span class="bar"><i style="width:${width}%"></i></span><span class="vl num">${prog.done} / ${prog.total}</span></div>${crystal}`;
  } else if (cacheEntry && (cacheEntry.payload.boss_contents || []).length === 0) {
    progHtml = `<div class="empty-boss-note">인게임 보스 스케줄러를 먼저 설정해 주세요</div>`;
  }
  const flagHtml = lootCount > 0 ? `<div class="flag">분배 안 한 템 ${lootCount}개</div>` : "";
  return `<div class="ccard" data-ocid="${ch.ocid}">
    <div class="cn"><b>${escapeHtml(ch.name)}</b><span>${ch.level} · ${escapeHtml(ch.job)} · ${escapeHtml(ch.world)}</span><span class="arw">›</span></div>
    ${progHtml}${flagHtml}
  </div>`;
}

function renderCharDetail(ocid) {
  const ch = getCharacters().find((c) => c.ocid === ocid);
  if (!ch) {
    showCharList();
    return;
  }
  document.getElementById("charDetailName").textContent = ch.name;
  document.getElementById("charDetailSub").textContent = `${ch.level} · ${ch.world}`;

  const cacheEntry = getCache()[ocid];
  const weeklyEl = document.getElementById("charDetailWeekly");
  const prog = trackedProgress(ocid, cacheEntry);
  if (prog) {
    const p = cacheEntry.payload;
    const width = Math.min(100, (prog.done / prog.total) * 100);
    const crystal = p.weekly_boss_clear_limit_count > 0 ? `<div class="crystal num">결정석 ${p.weekly_boss_clear_count} / ${p.weekly_boss_clear_limit_count}</div>` : "";
    weeklyEl.innerHTML = `<div class="wk"><small>이번 주</small><b><span class="num">${prog.done}</span> <i class="num">/ ${prog.total}</i></b></div><div class="bar"><i style="width:${width}%"></i></div>${crystal}`;
    weeklyEl.style.display = "";
  } else {
    weeklyEl.style.display = "none";
  }

  const loot = getLoot().filter((l) => l.ocid === ocid);
  const lootSec = document.getElementById("charDetailLoot");
  lootSec.classList.toggle("empty", loot.length === 0);
  const lootSorted = loot.slice().sort((a, b) => (a.gotAt < b.gotAt ? 1 : a.gotAt > b.gotAt ? -1 : 0));
  document.getElementById("charDetailLootRows").innerHTML = lootSorted
    .map((l) => {
      const [bName, bDiff] = l.bossKey.split("|");
      const d = daysSince(l.gotAt);
      const old = d > 14;
      const label = `${DIFFICULTY_LABEL[bDiff] || bDiff} ${escapeHtml(bName)} · ${shortDateLabel(l.gotAt)}${old ? ` · ${d}일 지남` : ""}`;
      return `<div class="loot-row${old ? " old" : ""}"><span class="li"><span class="ln">${escapeHtml(l.item)}</span><span class="lm">${label}</span></span><button class="ld" data-id="${l.id}">분배함</button></div>`;
    })
    .join("");
  document.getElementById("charDetailLootRows").querySelectorAll(".ld").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("분배를 완료해서 목록에서 지울까요?")) return;
      setLoot(getLoot().filter((l) => l.id !== btn.dataset.id));
      renderCharDetail(ocid);
      renderCharList();
    });
  });

  const tracked = (getTracked()[ocid] || []).slice().sort((a, b) => a.order - b.order);
  const schedule = getSchedule();
  const byKey = cacheEntry ? new Map((cacheEntry.payload.boss_contents || []).map((b) => [bossKey(b.content_name, b.difficulty), b])) : new Map();
  document.getElementById("charDetailBossRows").innerHTML = tracked
    .map((tb) => {
      const live = byKey.get(bossKey(tb.name, tb.difficulty));
      const done = !!(live && live.complete_flag === "true");
      const key = scheduleKey(ocid, tb.name, tb.difficulty);
      const sched = schedule[key] || { party: false };
      const gc = sched.party ? "var(--c-party)" : "var(--c-solo)";
      let sub = "솔플";
      if (sched.party) {
        sub = "파티";
        if (sched.day !== null && sched.day !== undefined && sched.time) {
          sub += ` · ${DAY_LABELS_FULL[sched.day]} ${sched.time}`;
        }
        if (sched.fixed) sub += ` <span class="rep">· 매주</span>`;
      }
      return `<div class="brow${done ? " done" : ""}" data-name="${escapeHtml(tb.name)}" data-difficulty="${tb.difficulty}">
        <span class="gem" style="--gc:${gc}"></span>
        <span class="bi"><span class="bn">${bossLabel(tb)}</span><span class="bs">${sub}</span></span>
        <span class="chk${done ? "" : " no"}">✓</span>
      </div>`;
    })
    .join("");
  document.getElementById("charDetailBossRows").querySelectorAll(".brow").forEach((row) => {
    row.addEventListener("click", () => {
      const tb = tracked.find((t) => t.name === row.dataset.name && t.difficulty === row.dataset.difficulty);
      if (tb) openBossSheet(ocid, tb);
    });
  });
}

async function renderBossPicker(ocid) {
  const ch = getCharacters().find((c) => c.ocid === ocid);
  const statusEl = document.getElementById("bossPickerStatus");
  const listEl = document.getElementById("bossPickerList");
  if (!ch) return;
  statusEl.textContent = "불러오는 중...";
  listEl.innerHTML = "";

  const result = await fetchCharacterState(ocid);
  if (!ch || currentCharDetailOcid !== ocid) return; // 그새 화면 전환됨

  let stateData;
  let failNotice = "";
  if (result.ok) {
    stateData = result.data;
  } else {
    const cached = getCache()[ocid];
    if (!cached) {
      statusEl.textContent = `불러오기 실패${result.code ? " (" + result.code + ")" : ""}`;
      return;
    }
    stateData = cached.payload;
    failNotice = `불러오기 실패${result.code ? " (" + result.code + ")" : ""} · 예전 목록을 보여줍니다`;
  }
  const bossContents = (stateData.boss_contents || []).filter((b) => b.cycle !== "bossDaily");
  if (bossContents.length === 0) {
    statusEl.textContent = "등록 가능한 보스가 없습니다 (인게임 보스 스케줄러 미설정)";
    return;
  }
  statusEl.textContent = failNotice;

  const tracked = getTracked();
  let trackedList = tracked[ocid];
  if (trackedList === undefined) {
    trackedList = bossContents.filter((b) => b.registration_flag === "true").map((b) => ({ name: b.content_name, difficulty: b.difficulty, cycle: b.cycle, order: b.list_order_no }));
    tracked[ocid] = trackedList;
    setTracked(tracked);
  }
  const trackedKeys = new Set(trackedList.map((b) => bossKey(b.name, b.difficulty)));

  const registeredKeys = new Set(bossContents.filter((b) => b.registration_flag === "true").map((b) => bossKey(b.content_name, b.difficulty)));
  const mismatched = registeredKeys.size !== trackedKeys.size || [...registeredKeys].some((k) => !trackedKeys.has(k));
  document.getElementById("bossPickerMismatchNotice").hidden = !mismatched;

  const sorted = bossContents.slice().sort((a, b) => a.list_order_no - b.list_order_no);
  listEl.innerHTML = sorted
    .map((b) => {
      const key = bossKey(b.content_name, b.difficulty);
      const checked = trackedKeys.has(key);
      const regBadge = b.registration_flag === "true" ? '<span class="reg-badge">인게임 등록됨</span>' : "";
      return `<li>
        <input type="checkbox" data-name="${escapeHtml(b.content_name)}" data-difficulty="${b.difficulty}" data-cycle="${b.cycle}" data-order="${b.list_order_no}" ${checked ? "checked" : ""} />
        <span>${DIFFICULTY_LABEL[b.difficulty] || b.difficulty} ${escapeHtml(b.content_name)}</span>${regBadge}
      </li>`;
    })
    .join("");

  listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const t = getTracked();
      let list = t[ocid] || [];
      const key = bossKey(cb.dataset.name, cb.dataset.difficulty);
      if (cb.checked) {
        if (!list.some((b) => bossKey(b.name, b.difficulty) === key)) {
          list = list.concat([{ name: cb.dataset.name, difficulty: cb.dataset.difficulty, cycle: cb.dataset.cycle, order: parseInt(cb.dataset.order, 10) }]);
        }
      } else {
        list = list.filter((b) => bossKey(b.name, b.difficulty) !== key);
      }
      t[ocid] = list;
      setTracked(t);
      renderCharList();
    });
  });
}

// §6-3. 인게임 등록대로 다시 불러오기 — 관리 목록(mbn.tracked)을 통째로 재구성한다.
// 관리 목록에서 빠지는 보스의 mbn.schedule은 같이 지운다. mbn.loot는 남긴다.
async function resyncTrackedFromRegistration(ocid) {
  const statusEl = document.getElementById("bossPickerStatus");
  statusEl.textContent = "불러오는 중...";
  const result = await fetchCharacterState(ocid);
  if (currentCharDetailOcid !== ocid) return;
  if (!result.ok) {
    statusEl.textContent = `불러오기 실패${result.code ? " (" + result.code + ")" : ""}`;
    return;
  }
  const bossContents = (result.data.boss_contents || []).filter((b) => b.cycle !== "bossDaily");
  const newTrackedList = bossContents.filter((b) => b.registration_flag === "true").map((b) => ({ name: b.content_name, difficulty: b.difficulty, cycle: b.cycle, order: b.list_order_no }));
  const newKeys = new Set(newTrackedList.map((b) => bossKey(b.name, b.difficulty)));

  const tracked = getTracked();
  const oldTrackedList = tracked[ocid] || [];
  const removedKeys = oldTrackedList.map((b) => bossKey(b.name, b.difficulty)).filter((k) => !newKeys.has(k));

  tracked[ocid] = newTrackedList;
  setTracked(tracked);

  if (removedKeys.length > 0) {
    const schedule = getSchedule();
    let changed = false;
    removedKeys.forEach((k) => {
      const sep = k.lastIndexOf("|");
      const sKey = scheduleKey(ocid, k.slice(0, sep), k.slice(sep + 1));
      if (schedule[sKey]) {
        delete schedule[sKey];
        changed = true;
      }
    });
    if (changed) setSchedule(schedule);
  }

  renderCharList();
  if (currentCharDetailOcid) renderCharDetail(currentCharDetailOcid);
  renderToday();
  renderBossPicker(ocid);
}

function initCharacterTab() {
  document.getElementById("charDetailBack").addEventListener("click", showCharList);
  document.getElementById("bossPickerBack").addEventListener("click", () => showCharDetail(currentCharDetailOcid));
  document.getElementById("openBossPickerBtn").addEventListener("click", showBossPicker);
  document.getElementById("resyncTrackedBtn").addEventListener("click", () => {
    if (currentCharDetailOcid) resyncTrackedFromRegistration(currentCharDetailOcid);
  });
}

// ==================================================================
// 보스 시트
// ==================================================================
let sheetOcid = null;
let sheetTb = null;
let sheetState = null;

function openBossSheet(ocid, tb) {
  sheetOcid = ocid;
  sheetTb = tb;
  const key = scheduleKey(ocid, tb.name, tb.difficulty);
  const sched = getSchedule()[key] || {};
  const pp = getPostponed()[key];
  sheetState = {
    party: !!sched.party,
    day: sched.day !== undefined ? sched.day : null,
    time: sched.time || "",
    fixed: !!sched.fixed,
    postponed: !!(pp && !pp.off),
    memo: pp ? pp.memo || "" : "",
    checkedDrops: new Set(),
  };
  document.getElementById("bossSheetBg").hidden = false;
  renderBossSheet();
}
function closeBossSheet() {
  document.getElementById("bossSheetBg").hidden = true;
  sheetOcid = null;
  sheetTb = null;
  sheetState = null;
}

function renderBossSheet() {
  const ch = getCharacters().find((c) => c.ocid === sheetOcid);
  const cacheEntry = getCache()[sheetOcid];
  const live = cacheEntry && (cacheEntry.payload.boss_contents || []).find((b) => bossKey(b.content_name, b.difficulty) === bossKey(sheetTb.name, sheetTb.difficulty));
  const done = !!(live && live.complete_flag === "true");
  const gc = sheetState.party ? "var(--c-party)" : "var(--c-solo)";

  const daysHtml = DAY_ORDER.map((d) => `<button type="button" data-day="${d}" class="${sheetState.day === d ? "on" : ""}">${DAY_LABELS_FULL[d]}</button>`).join("");

  const dropItems = dropItemsFor(sheetTb.name);
  const dropsHtml = dropItems
    .map((item) => {
      const on = sheetState.checkedDrops.has(item);
      return `<div class="drop${on ? " on" : ""}" data-item="${escapeHtml(item)}"><span class="box">${on ? "✓" : ""}</span><span class="dn">${escapeHtml(item)}</span></div>`;
    })
    .join("");

  // §7-4: 이미 기록된 것을 보여준다. 체크박스를 미리 켜지는 않는다 — 어디까지나 안내 줄이다.
  const bk = bossKey(sheetTb.name, sheetTb.difficulty);
  const alreadyCounts = new Map();
  getLoot()
    .filter((l) => l.ocid === sheetOcid && l.bossKey === bk)
    .forEach((l) => alreadyCounts.set(l.item, (alreadyCounts.get(l.item) || 0) + l.count));
  const alreadyHtml =
    alreadyCounts.size > 0
      ? `<p class="already-recorded">이미 기록됨 · ${Array.from(alreadyCounts.entries())
          .map(([item, count]) => `${escapeHtml(item)} ×${count}`)
          .join(", ")}</p>`
      : "";

  document.getElementById("bossSheet").innerHTML = `
    <div class="grab"></div>
    <div class="sh"><span class="gem" style="--gc:${gc}"></span><b>${bossLabel(sheetTb)}</b></div>
    <div class="shm">${escapeHtml(ch ? ch.name : "")} · 이번 주 ${done ? "완료" : "미완료"}</div>

    <div class="fld">
      <div class="swrow">
        <span><span class="st">파티로 진행</span><span class="sd">켜면 오늘 화면 파티 약속에 뜬다</span></span>
        <button type="button" class="sw${sheetState.party ? " on" : ""}" id="swParty"></button>
      </div>
    </div>

    <div class="fld" id="fldDay">
      <div class="fl">요일</div>
      <div class="days">${daysHtml}</div>
    </div>

    <div class="fld${sheetState.party ? "" : " off"}" id="fldTime">
      <div class="fl">시간</div>
      <div class="timebox">
        <input type="time" id="sheetTimeInput" value="${sheetState.time || ""}" />
      </div>
    </div>

    <div class="fld">
      <div class="swrow">
        <span><span class="st">매주 고정</span><span class="sd">목요일 리셋마다 자동으로 되살아난다</span></span>
        <button type="button" class="sw${sheetState.fixed ? " on" : ""}" id="swFixed"></button>
      </div>
    </div>

    <div class="fld${sheetState.party ? "" : " off"}" id="fldDrops">
      <div class="fl">드랍템 기록</div>
      <div class="drops">${dropsHtml}</div>
      ${alreadyHtml}
      ${sheetState.party ? "" : '<p class="offmsg">혼자 잡은 건 내가 갖는다. 분배할 게 없으니 기록도 안 한다.</p>'}
    </div>

    <div class="fld">
      <div class="swrow">
        <span><span class="st">밀린 것으로 표시</span><span class="sd">체크해두면 오늘 화면 맨 위 밀린 것에 뜬다</span></span>
        <button type="button" class="sw${sheetState.postponed ? " on" : ""}" id="swPostponed"></button>
      </div>
      ${sheetState.postponed ? `<input type="text" id="postponedMemo" placeholder="메모 (선택)" value="${escapeHtml(sheetState.memo)}" style="margin-top:10px;width:100%;background:var(--f-bg);border:1px solid var(--f-line);color:var(--f-ink);border-radius:8px;padding:9px 11px;font-size:13.5px;font-family:inherit;box-sizing:border-box;" />` : ""}
    </div>

    <button type="button" class="savebtn" id="sheetSaveBtn">저장</button>
  `;

  document.getElementById("bossSheetDim").onclick = closeBossSheet;
  document.getElementById("swParty").addEventListener("click", () => {
    sheetState.party = !sheetState.party;
    renderBossSheet();
  });
  document.getElementById("swFixed").addEventListener("click", () => {
    sheetState.fixed = !sheetState.fixed;
    renderBossSheet();
  });
  document.getElementById("swPostponed").addEventListener("click", () => {
    sheetState.postponed = !sheetState.postponed;
    renderBossSheet();
  });
  const memoInput = document.getElementById("postponedMemo");
  if (memoInput) memoInput.addEventListener("input", () => (sheetState.memo = memoInput.value));

  document.querySelectorAll("#fldDay .days button").forEach((btn) => {
    btn.addEventListener("click", () => {
      sheetState.day = parseInt(btn.dataset.day, 10);
      renderBossSheet();
    });
  });
  const timeInput = document.getElementById("sheetTimeInput");
  timeInput.addEventListener("change", () => {
    sheetState.time = timeInput.value;
    renderBossSheet();
  });
  document.querySelectorAll("#fldDrops .drop").forEach((el) => {
    el.addEventListener("click", () => {
      const item = el.dataset.item;
      if (sheetState.checkedDrops.has(item)) sheetState.checkedDrops.delete(item);
      else sheetState.checkedDrops.add(item);
      renderBossSheet();
    });
  });
  document.getElementById("sheetSaveBtn").addEventListener("click", saveBossSheet);
}

function saveBossSheet() {
  const key = scheduleKey(sheetOcid, sheetTb.name, sheetTb.difficulty);

  const schedule = getSchedule();
  schedule[key] = { party: sheetState.party, day: sheetState.day, time: sheetState.time, fixed: sheetState.fixed };
  setSchedule(schedule);

  // §3-2 마지막 문단: 기존 객체를 펼쳐서 덮어써야 auto·off가 안 날아간다.
  const postponed = getPostponed();
  const existingPp = postponed[key];
  if (sheetState.postponed) {
    postponed[key] = { ...existingPp, since: existingPp ? existingPp.since : kstDateStr(), memo: sheetState.memo, off: false };
  } else if (existingPp && existingPp.auto) {
    // §3-4: 자동으로 올라온 것은 지우지 않고 off로 표시만 바꾼다. 수동으로 켠 것만 그냥 지운다.
    postponed[key] = { ...existingPp, off: true };
  } else {
    delete postponed[key];
  }
  setPostponed(postponed);

  if (sheetState.party && sheetState.checkedDrops.size > 0) {
    const loot = getLoot();
    const gotAt = kstDateStr();
    const bk = bossKey(sheetTb.name, sheetTb.difficulty);
    sheetState.checkedDrops.forEach((item) => {
      loot.push({ id: cryptoId(), ocid: sheetOcid, bossKey: bk, item, count: 1, gotAt });
    });
    setLoot(loot);
  }

  closeBossSheet();
  renderToday();
  renderCharList();
  if (currentCharDetailOcid) renderCharDetail(currentCharDetailOcid);
}

// ==================================================================
// 새로고침 (백그라운드 순차 조회)
// ==================================================================
let refreshInFlight = false;

function setRefreshButtonsSpinning(spinning) {
  document.querySelectorAll(".refresh-btn").forEach((btn) => btn.classList.toggle("spinning", spinning));
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  setRefreshButtonsSpinning(true);
  const characters = getCharacters();
  const cache = getCache();
  let apiKeyError = false;
  let networkError = false;
  let latestFetchedAt = 0;

  for (const c of Object.values(cache)) {
    if (c.fetchedAt) latestFetchedAt = Math.max(latestFetchedAt, c.fetchedAt);
  }

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const result = await fetchCharacterState(ch.ocid);
    if (result.ok) {
      cache[ch.ocid] = { fetchedAt: Date.now(), payload: result.data };
      latestFetchedAt = Date.now();
      setCache(cache);

      // §7-1-b: 이 캐릭터의 관리 목록이 아직 없으면(=한 번도 안 채워졌으면) 인게임 등록 보스로 채운다.
      // 빈 배열([])은 "사용자가 전부 해제했다"는 뜻이므로 건드리지 않는다.
      const tracked = getTracked();
      if (tracked[ch.ocid] === undefined) {
        const bossContents = (result.data.boss_contents || []).filter((b) => b.cycle !== "bossDaily");
        tracked[ch.ocid] = bossContents.filter((b) => b.registration_flag === "true").map((b) => ({ name: b.content_name, difficulty: b.difficulty, cycle: b.cycle, order: b.list_order_no }));
        setTracked(tracked);
      }

      renderToday();
      renderCharList();
      if (currentCharDetailOcid === ch.ocid) renderCharDetail(ch.ocid);
    } else if (result.code === "OPENAPI00005") {
      apiKeyError = true;
      break;
    } else if (result.code === "OPENAPI00003") {
      // 이 캐릭터만 오류, 나머지는 계속 진행
    } else {
      networkError = true;
    }
    if (i < characters.length - 1) {
      await new Promise((r) => setTimeout(r, SEQUENTIAL_DELAY_MS));
    }
  }

  updateStatusLines(apiKeyError, networkError, latestFetchedAt);
  setRefreshButtonsSpinning(false);
  refreshInFlight = false;
}

function updateStatusLines(apiKeyError, networkError, latestFetchedAt) {
  const ids = ["todayStatusLine", "charStatusLine"];
  const prevResetMs = nextWeeklyResetEpochMs() - 7 * 86400000;
  const stale = latestFetchedAt > 0 && latestFetchedAt < prevResetMs;
  ids.forEach((id) => {
    const badge = document.getElementById(id);
    if (apiKeyError) {
      badge.hidden = false;
      badge.textContent = "API 키 오류 · 탭해서 설정으로 이동";
      badge.classList.add("clickable");
      badge.onclick = () => document.querySelector('.tab-btn[data-tab="settings"]').click();
    } else if (networkError) {
      badge.hidden = false;
      const t = latestFetchedAt ? formatShortDateTime(new Date(latestFetchedAt)) : "-";
      badge.textContent = stale ? `지난주 데이터 · 마지막 조회 ${t}` : `오프라인 · 마지막 조회 ${t}`;
      badge.classList.remove("clickable");
      badge.onclick = null;
    } else {
      badge.hidden = true;
      badge.onclick = null;
    }
  });
}

function formatShortDateTime(d) {
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

// ==================================================================
// 탭 3 — 분배금 계산기
// ==================================================================
function initDistributeTab() {
  const saleInput = document.getElementById("calcSale");
  const netInput = document.getElementById("calcNet");
  const feeGroup = document.getElementById("feeGroup");
  const partyGroup = document.getElementById("partyGroup");

  let feeRate = getSettings().defaultFeeRate;
  let partySize = 4;
  let lastEdited = "sale";

  setActiveToggle(feeGroup, "fee", feeRate);
  setActiveToggle(partyGroup, "n", partySize);

  function recompute() {
    const sale = lastEdited === "sale" ? parseMoney(saleInput.value) : parseMoney(netInput.value) / (1 - feeRate);
    const net = sale * (1 - feeRate);

    if (lastEdited === "sale") {
      netInput.value = sale ? formatInt(floorHundred(net)) : "";
    } else {
      saleInput.value = sale ? formatInt(floorHundred(sale)) : "";
    }

    if (!sale) {
      document.getElementById("resPartner").textContent = "-";
      document.getElementById("resSend").textContent = "-";
      document.getElementById("resMyNet").textContent = "-";
      return;
    }

    const { sendPerPerson, partnerReceive } = calcDistribution(sale, feeRate, partySize);
    document.getElementById("resPartner").textContent = formatInt(floorHundred(partnerReceive));
    document.getElementById("resSend").textContent = formatInt(floorHundred(sendPerPerson));
    document.getElementById("resMyNet").textContent = formatInt(floorHundred(partnerReceive));
  }

  saleInput.addEventListener("input", () => {
    lastEdited = "sale";
    recompute();
  });
  netInput.addEventListener("input", () => {
    lastEdited = "net";
    recompute();
  });
  saleInput.addEventListener("blur", () => {
    const n = parseMoney(saleInput.value);
    saleInput.value = n ? formatInt(n) : "";
  });
  netInput.addEventListener("blur", () => {
    const n = parseMoney(netInput.value);
    netInput.value = n ? formatInt(n) : "";
  });
  feeGroup.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      feeRate = parseFloat(btn.dataset.fee);
      setActiveToggle(feeGroup, "fee", feeRate);
      recompute();
    });
  });
  partyGroup.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      partySize = parseInt(btn.dataset.n, 10);
      setActiveToggle(partyGroup, "n", partySize);
      recompute();
    });
  });
}

function setActiveToggle(group, dataAttr, value) {
  group.querySelectorAll("button").forEach((btn) => {
    const btnVal = dataAttr === "fee" ? parseFloat(btn.dataset[dataAttr]) : parseInt(btn.dataset[dataAttr], 10);
    btn.classList.toggle("active", btnVal === value);
  });
}

// ==================================================================
// 탭 4 — 설정
// ==================================================================
function initSettingsTab() {
  const apiKeyInput = document.getElementById("apiKeyInput");
  const apiKeyStatus = document.getElementById("apiKeyStatus");
  const loadBtn = document.getElementById("loadCharactersBtn");
  const loadStatus = document.getElementById("loadCharactersStatus");
  const worldTabsEl = document.getElementById("worldTabs");
  const accountList = document.getElementById("accountCharacterList");
  const defaultFeeGroup = document.getElementById("defaultFeeGroup");
  const splitSw = document.getElementById("splitByWorldSw");

  apiKeyInput.value = getApiKey();
  setActiveToggle(defaultFeeGroup, "fee", getSettings().defaultFeeRate);
  splitSw.classList.toggle("on", !!getSettings().splitByWorld);

  splitSw.addEventListener("click", () => {
    const s = getSettings();
    s.splitByWorld = !s.splitByWorld;
    setSettings(s);
    splitSw.classList.toggle("on", s.splitByWorld);
    renderToday();
  });

  document.getElementById("apiKeyVerifyBtn").addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    setApiKey(key);
    apiKeyStatus.textContent = "확인 중...";
    apiKeyStatus.className = "status-line";
    const result = await fetchCharacterList();
    if (result.ok) {
      apiKeyStatus.textContent = "키 확인됨";
      apiKeyStatus.className = "status-line ok";
    } else if (result.code === "OPENAPI00005") {
      apiKeyStatus.textContent = "API 키가 올바르지 않습니다.";
      apiKeyStatus.className = "status-line err";
    } else if (result.network) {
      apiKeyStatus.textContent = "네트워크 오류. 인터넷 연결을 확인해 주세요.";
      apiKeyStatus.className = "status-line err";
    } else {
      apiKeyStatus.textContent = `오류: ${result.code || "알 수 없음"}`;
      apiKeyStatus.className = "status-line err";
    }
  });

  let allAccountChars = [];
  let selectedWorld = null;

  loadBtn.addEventListener("click", async () => {
    loadStatus.textContent = "불러오는 중...";
    loadStatus.className = "status-line";
    const result = await fetchCharacterList();
    if (!result.ok) {
      loadStatus.textContent = result.code === "OPENAPI00005" ? "API 키를 먼저 확인해 주세요." : "불러오기 실패";
      loadStatus.className = "status-line err";
      return;
    }
    loadStatus.textContent = "";
    allAccountChars = [];
    for (const acc of result.data.account_list || []) {
      for (const c of acc.character_list || []) allAccountChars.push(c);
    }
    const worlds = [];
    allAccountChars.forEach((c) => {
      if (!worlds.includes(c.world_name)) worlds.push(c.world_name);
    });
    selectedWorld = worlds[0] || null;
    worldTabsEl.innerHTML = worlds.map((w) => `<button data-world="${escapeHtml(w)}" class="${w === selectedWorld ? "active" : ""}">${escapeHtml(w)}</button>`).join("");
    worldTabsEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedWorld = btn.dataset.world;
        worldTabsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        renderAccountCharacterList();
      });
    });
    renderAccountCharacterList();
  });

  function renderAccountCharacterList() {
    const managed = new Set(getCharacters().map((c) => c.ocid));
    const filtered = allAccountChars.filter((c) => c.world_name === selectedWorld).sort((a, b) => b.character_level - a.character_level);
    accountList.innerHTML = filtered
      .map(
        (c) => `<li>
          <input type="checkbox" data-ocid="${c.ocid}" ${managed.has(c.ocid) ? "checked" : ""} />
          <span class="lbl">${escapeHtml(c.character_name)}<div class="sub">${c.character_level} · ${escapeHtml(c.world_name)} · ${escapeHtml(c.character_class)}</div></span>
        </li>`
      )
      .join("");

    accountList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const ocid = cb.dataset.ocid;
        let characters = getCharacters();
        if (cb.checked) {
          if (!characters.some((c) => c.ocid === ocid)) {
            const src = allAccountChars.find((c) => c.ocid === ocid);
            characters.push({ ocid: src.ocid, name: src.character_name, world: src.world_name, job: src.character_class, level: src.character_level });
          }
        } else {
          characters = characters.filter((c) => c.ocid !== ocid);
        }
        setCharacters(characters);
        renderCharList();
        renderToday();
        refresh();
      });
    });
  }

  defaultFeeGroup.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rate = parseFloat(btn.dataset.fee);
      const s = getSettings();
      s.defaultFeeRate = rate;
      setSettings(s);
      setActiveToggle(defaultFeeGroup, "fee", rate);
    });
  });
}

// ---- 서비스워커 등록 ----
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
}

// ---- 초기화 ----
function init() {
  initTabs();
  initCharacterTab();
  initDistributeTab();
  initSettingsTab();
  document.getElementById("todayRefreshBtn").addEventListener("click", refresh);
  document.getElementById("charRefreshBtn").addEventListener("click", refresh);

  checkWeeklyReset();
  renderToday();
  renderCharList();
  setInterval(() => {
    checkWeeklyReset();
    renderToday();
  }, 60000);

  refresh();
  registerServiceWorker();
}

document.addEventListener("DOMContentLoaded", init);
