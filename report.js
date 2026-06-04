const fs = require('fs');
const https = require('https');

// ── 설정 로드 ──────────────────────────────────────────
function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8').replace(/^﻿/, ''));
}
function tryReadJson(p) {
  try { return readJson(p); } catch(e) { return null; }
}

const _cf  = tryReadJson('G:/공유 드라이브/이태리정미소-자동화/tokens/italy.token.json')
          || tryReadJson('../cafe24_token.json') || {};
const _mt  = tryReadJson('../meta_token.json') || {};
const _tg  = tryReadJson('../telegram_config.json') || {};
const _cl  = tryReadJson('../claude_api.json') || {};
const _ga  = tryReadJson('../ga4_oauth.json') || {};
const _cla = (() => { try { return fs.readFileSync('../clarity_token.txt', 'utf8').trim(); } catch(e) { return ''; } })();

async function getMemos() {
  try {
    const res = await postToAppsScript({ action: 'get_memos' }, APPS_SCRIPT_URL);
    return res.memos || [];
  } catch(e) { console.error('[메모 조회 오류]', e.message); return []; }
}

// COMPASS 은우 개인메모 — /메모로 추가한 줄("• ")만 데일리에 자동 표시 (잊지 않게)
async function getCompassMemos() {
  try {
    const res = await postToAppsScript({ action: 'get_eunwoo_memo' }, APPS_SCRIPT_URL);
    const memo = res.memo || '';
    return memo.split('\n').filter(l => l.trim().startsWith('•')).map(l => l.replace(/^•\s*/, '').trim()).filter(Boolean);
  } catch(e) { console.error('[COMPASS 메모 조회 오류]', e.message); return []; }
}

// ── 리마인드 (GAS Sheets 기반) ────────────────────────
async function getRemindersFromSheet() {
  try {
    const res = await postToAppsScript({ action: 'get_reminders' }, APPS_SCRIPT_URL);
    return res.reminders || [];
  } catch(e) { console.error('[리마인드 조회 오류]', e.message); return []; }
}

const TAGS = ['/결정', '/액션', '/아이디어', '/공유', '/광고', '/소싱', '/CS', '/운영', '/디자인'];

// 태그를 토큰 단위로 정확 매칭 (대소문자 무시). "송장/CS/봇" 부분일치 오탐 방지.
function detectTags(text) {
  const tokens = text.toLowerCase().split(/\s+/);
  return TAGS.filter(tag => {
    const t = tag.toLowerCase();
    return tokens.some(tok => tok === t || tok.replace(/[^a-z0-9가-힣/]+$/, '') === t);
  });
}

// 어제 그룹 대화를 '일일대화' 시트에서 읽기 (요약 입력)
async function getDailyMessagesFromSheet(date) {
  try {
    const res = await postToAppsScript({ action: 'get_daily_messages', date }, APPS_SCRIPT_URL);
    return res.messages || [];
  } catch(e) { console.error('[일일대화 조회 오류]', e.message); return []; }
}

async function getRecentActivities(hours = 24) {
  try {
    const res = await postToAppsScript({ action: 'get_activities', hours }, APPS_SCRIPT_URL);
    return res.activities || [];
  } catch(e) { console.error('[활동로그 조회 오류]', e.message); return []; }
}

// ── 텔레그램 getUpdates → 일일대화·태그·리마인드 GAS 저장 ────────
async function processTelegramMessages() {
  try {
    let lastUpdateId = 0;
    try {
      const data = JSON.parse(require('fs').readFileSync('./last_update_id.json', 'utf8'));
      lastUpdateId = data.id || 0;
    } catch(e) {}

    const offset = lastUpdateId ? lastUpdateId + 1 : 0;
    const res = await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&limit=100&allowed_updates=%5B%22message%22%5D`);
    if (!res.ok || !res.result.length) return { messages: [] };

    const messages = [];
    const dailyMsgs = [];
    const remindersToAdd = [];
    const remindersDone = [];
    let newLastId = lastUpdateId;

    for (const update of res.result) {
      newLastId = Math.max(newLastId, update.update_id);
      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (String(msg.chat.id) !== String(GROUP_CHAT_ID)) continue;

      const text = msg.text.trim();
      const from = msg.from || {};
      const sender = from.first_name ? from.first_name + (from.last_name ? ' ' + from.last_name : '') : '알수없음';
      const isBot = !!from.is_bot;
      const kst = new Date(msg.date * 1000 + 9 * 3600 * 1000);
      const dateStr = kst.toISOString().split('T')[0];
      const timeStr = kst.toISOString().slice(11, 16);

      messages.push({ time: timeStr, sender, isBot, text, date: dateStr });

      const addMatch = text.match(/^\/추가\s+([\s\S]+)/);
      if (addMatch) { remindersToAdd.push({ text: addMatch[1].trim(), sender, date: dateStr }); continue; }
      const doneMatch = text.match(/^\/완료\s+(.+)/);
      if (doneMatch) { remindersDone.push(...doneMatch[1].trim().split(/\s+/)); continue; }

      dailyMsgs.push({ date: dateStr, time: timeStr, sender, isBot, text });

      const foundTags = detectTags(text);
      if (foundTags.length > 0) {
        await postToAppsScript({ action: 'save_tagged', date: dateStr, time: timeStr, sender, tags: foundTags.join(', '), text }, APPS_SCRIPT_URL)
          .catch(e => console.error('[태그저장 오류]', e.message));
      }
    }

    if (dailyMsgs.length > 0) {
      await postToAppsScript({ action: 'save_daily', messages: dailyMsgs }, APPS_SCRIPT_URL).catch(() => {});
    }
    for (const r of remindersToAdd) {
      await postToAppsScript({ action: 'add_reminder', ...r }, APPS_SCRIPT_URL).catch(() => {});
    }
    if (remindersDone.length > 0) {
      await postToAppsScript({ action: 'update_reminder_done', ids: remindersDone, texts: remindersDone }, APPS_SCRIPT_URL).catch(() => {});
    }

    require('fs').writeFileSync('./last_update_id.json', JSON.stringify({ id: newLastId }), 'utf8');
    return { messages };
  } catch(e) { console.error('[메시지 처리 오류]', e.message); return { messages: [] }; }
}

// ── 회의록 자동화 ──────────────────────────────────────
function postToAppsScript(data, url) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        // GAS는 doPost 실행 후 302로 응답을 전달 → GET으로 받아야 JSON 정상 수신
        res.resume();
        https.get(res.headers.location, (r) => {
          let d = ''; r.on('data', c => d += c);
          r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ ok: true }); } });
        }).on('error', reject);
        return;
      }
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ ok: true }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function saveMeetingNotes(messages, date) {
  if (!messages.length) return;
  const convo = messages.map(m => `[${m.time}] ${m.sender}${m.isBot ? '(봇)' : ''}: ${m.text}`).join('\n');
  const prompt = `다음은 ${date} 송마망 팀 텔레그램 그룹 대화야.
의미 있는 업무 논의가 있으면 회의록 형식으로 JSON 출력해줘.
잡담만 있거나 내용이 없으면 null 반환.

대화:
${convo}

출력 형식 (JSON만, 설명 없이):
{
  "title": "주요 논의 제목",
  "participants": "참석자 이름들 (쉼표 구분)",
  "agenda": "주요 안건 (줄바꿈 구분)",
  "decisions": "결정 사항 (줄바꿈 구분, 없으면 빈문자열)",
  "actions": "액션 아이템 (줄바꿈 구분, 없으면 빈문자열)",
  "assignee": "담당자",
  "notes": "기타 메모"
}`;

  try {
    const body = JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    const raw = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
      });
      req.on('error', reject); req.write(body); req.end();
    });
    const text = raw.content?.[0]?.text?.trim();
    if (!text || text === 'null') { console.log('[회의록] 업무 내용 없음, 스킵'); return; }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const notes = JSON.parse(jsonMatch[0]);
    await postToAppsScript({ date, status: '🟡 진행중', ...notes }, APPS_SCRIPT_URL);
    console.log('[회의록] 시트 저장 완료:', notes.title);
    const tgSummary = `📋 <b>어제 요약</b> · ${date}
<b>${notes.title}</b> · 👥 ${notes.participants}${notes.agenda ? `\n📌 ${notes.agenda}` : ''}${notes.decisions ? `\n✅ ${notes.decisions}` : ''}${notes.actions ? `\n🎯 ${notes.actions}` : ''}${notes.notes ? `\n💬 ${notes.notes}` : ''}`;
    await sendTelegramGroup(tgSummary);
    console.log('[회의록] 단톡방 발송 완료');
  } catch(e) { console.error('[회의록] 오류:', e.message); }
}

const CAFE24_BASE        = 'https://italyjungmiso.cafe24api.com/api/v2/admin/';
let   CAFE24_ACCESS_TOKEN = (_cf.access_token || '').trim();
const CAFE24_API_VERSION = '2025-12-01';
const CAFE24_CLIENT_ID   = 'Vv3AL9nXIZ9uDs0f8CXrHA';
const META_TOKEN         = (process.env.META_ACCESS_TOKEN || _mt.access_token    || '').trim();
const META_AD_ACCOUNT    = (process.env.META_AD_ACCOUNT   || _mt.ad_account_id   || '').toString().trim();
const TG_TOKEN           = (process.env.TG_BOT_TOKEN      || _tg.bot_token       || '').trim();
const TG_CHAT_ID         = (process.env.TG_CHAT_ID        || _tg.chat_id         || '').toString().trim();
const CLAUDE_API_KEY     = (process.env.CLAUDE_API_KEY    || _cl.api_key         || '').trim();
const CLAUDE_MODEL       = (process.env.CLAUDE_MODEL      || _cl.model           || 'claude-sonnet-4-6').trim();
const CLARITY_PROJECT_ID = 'vzm43te29q';
const clarityToken       = (process.env.CLARITY_TOKEN     || _cla).trim();
const GROUP_CHAT_ID      = (process.env.TG_GROUP_CHAT_ID  || _tg.group_chat_id   || '').toString().trim();
// REMINDERS_PATH 제거 — 리마인드는 GAS Google Sheets에서 관리
const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycby_4WNcHLvcgCUIb3qhRi-h9_qApHSLXwCQa3_Qmw4xDNbdaZvPVeshmlGPg661KMRG/exec';
const ga4Config = {
  client_id:     (process.env.GA4_CLIENT_ID     || _ga.client_id     || '').trim(),
  client_secret: (process.env.GA4_CLIENT_SECRET || _ga.client_secret || '').trim(),
  refresh_token: (process.env.GA4_REFRESH_TOKEN || _ga.refresh_token || '').trim(),
  property_id:   (process.env.GA4_PROPERTY_ID   || _ga.property_id   || '').toString().trim(),
};

// ── 카페24 토큰 자동 갱신 ──────────────────────────────
// 1순위: Google Drive의 italy.token.json 직접 읽기 (VPS가 매시간 회전 → 항상 최신).
//        GA4 OAuth refresh_token이 drive.readonly scope 포함하도록 재발급됨 (2026-05-20).
// 2순위(fallback): 기존 Secret 기반 refresh API 호출.
// → refresh_token 회전 시 Secret이 옛 거가 되어 깨지는 문제 영구 해결.
// Drive 파일 객체 통째로 가져옴 (access_token + refresh_token 둘 다)
async function loadCafe24FromDrive() {
  const fileId = process.env.CAFE24_TOKEN_DRIVE_FILE_ID;
  if (!fileId) return null;
  if (!ga4Config.client_id || !ga4Config.refresh_token) return null;
  try {
    const tokenBody = `client_id=${ga4Config.client_id}&client_secret=${ga4Config.client_secret}&refresh_token=${ga4Config.refresh_token}&grant_type=refresh_token`;
    const tokenRes = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
      req.on('error', reject); req.write(tokenBody); req.end();
    });
    const accessToken = tokenRes.access_token;
    if (!accessToken) return null;
    const fileBody = await new Promise((resolve, reject) => {
      https.get({ hostname: 'www.googleapis.com', path: `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, headers: { 'Authorization': 'Bearer ' + accessToken } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
    });
    return JSON.parse(fileBody);
  } catch (e) { console.error('[카페24] Drive 읽기 오류:', e.message); return null; }
}

// 카페24 access_token 실제 유효성 검사 (expires_at 메타 신뢰 X — 회전 정책으로 만료 임의)
async function testCafe24Token(accessToken) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'italyjungmiso.cafe24api.com',
      path: '/api/v2/admin/products?limit=1',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'X-Cafe24-Api-Version': CAFE24_API_VERSION }
    }, r => { resolve(r.statusCode === 200); }).on('error', () => resolve(false));
  });
}

// refresh_token으로 새 access_token 발급
async function cafe24OauthRefresh(refreshToken) {
  const secret = process.env.CAFE24_CLIENT_SECRET;
  if (!secret || !refreshToken) return null;
  const auth = Buffer.from(`${CAFE24_CLIENT_ID}:${secret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${refreshToken}`;
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'italyjungmiso.cafe24api.com',
      path: '/api/v2/oauth/token',
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, r => { let d=''; r.on('data', c=>d+=c); r.on('end', () => { try { resolve(JSON.parse(d).access_token || null); } catch(e) { resolve(null); } }); });
    req.on('error', () => resolve(null)); req.write(body); req.end();
  });
}

async function refreshCafe24Token() {
  // 1) Drive에서 token 파일 가져오기
  const drive = await loadCafe24FromDrive();
  if (drive && drive.access_token) {
    // 1a) Drive의 access_token 실호출 검증 (expires_at 메타 신뢰 X)
    if (await testCafe24Token(drive.access_token)) {
      CAFE24_ACCESS_TOKEN = drive.access_token;
      console.log('[카페24] 토큰 갱신 완료 (drive)');
      return true;
    }
    // 1b) invalid면 Drive의 refresh_token으로 새 access 발급
    if (drive.refresh_token) {
      const newAt = await cafe24OauthRefresh(drive.refresh_token);
      if (newAt) {
        CAFE24_ACCESS_TOKEN = newAt;
        console.log('[카페24] 토큰 갱신 완료 (drive refresh)');
        return true;
      }
    }
    // 1c) 검증 step false지만 Drive 토큰은 있는 경우 — 일단 set + 부분 성공 신호
    // (testCafe24Token이 일부 케이스에서 false 반환하지만 실제 fetch는 되는 케이스 있음)
    CAFE24_ACCESS_TOKEN = drive.access_token;
    console.warn('[카페24] 토큰 검증 step 실패 — Drive 토큰 그대로 사용. fetch 단계 결과 의존.');
    return true;
  }

  // fallback refresh 제거 — VPS가 단일 갱신 주체. 여기서 refresh API 직접 호출 시
  // 카페24 refresh_token 소비 → VPS 보유 토큰 폐기 → 22시간 dead zone 발생.
  console.error('[카페24] Drive 토큰 자체 읽기 실패 — VPS 상태 확인 필요.');
  return false;
}

// ── 날짜 헬퍼 ──────────────────────────────────────────
function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}
function formatDate(s) { return s.replace(/-/g, '.'); }
function formatMoney(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }
function pct(a, b) { return b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '-'; }
function diff(cur, prev) {
  if (!prev) return '';
  const d = ((cur - prev) / prev * 100).toFixed(0);
  return d > 0 ? ` ↑${d}%` : d < 0 ? ` ↓${Math.abs(d)}%` : ' -';
}
function diffCount(cur, prev) {
  if (prev === undefined || prev === null) return '';
  const d = cur - prev;
  return d > 0 ? ` (+${d}건)` : d < 0 ? ` (${d}건)` : ' (0건)';
}
function icon(val, warn, bad) {
  return val > bad ? '🔴' : val > warn ? '🟡' : '🟢';
}
function isMonday() { return new Date().getDay() === 1; }

// ── HTTP 헬퍼 ──────────────────────────────────────────
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d.slice(0,200))); } });
    });
    req.on('error', reject); req.end();
  });
}
function postJson(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d.slice(0,200))); } });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

// ── Google Sheets CSV 읽기 (리다이렉트 처리) ──────────
function fetchCsvWithRedirects(url, hops) {
  if (hops === undefined) hops = 5;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location && hops > 0) {
        res.resume();
        resolve(fetchCsvWithRedirects(res.headers.location, hops - 1));
        return;
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

async function getSheetsTasks() {
  try {
    const url = 'https://docs.google.com/spreadsheets/d/1EQaNYcJz1c_WmPKiDbtecCNKtJ5LX4P8zg6m1-xkTBs/export?format=csv&gid=468452180';
    const csv = await fetchCsvWithRedirects(url);
    const rows = parseCSV(csv);
    if (!rows.length) return null;

    const hi = rows.findIndex(r => r.some(c => c.includes('담당')));
    if (hi < 0) return null;
    const headers = rows[hi];
    const ci = {
      person: headers.findIndex(h => h.includes('담당')),
      main:   headers.findIndex(h => h.includes('ONE THING')),
      status: headers.findIndex(h => h.includes('상태')),
      sub:    headers.findIndex(h => h.includes('서브')),
      note:   headers.findIndex(h => h.includes('비고')),
    };

    const myRow = rows.slice(hi + 1).find(r => (r[ci.person] || '').includes('은우'));
    if (!myRow) return null;

    const oneThing = (myRow[ci.main]   || '').trim().replace(/\n/g, ' ');
    const isDone   = (myRow[ci.status] || '').includes('✅');
    const subs     = (myRow[ci.sub]    || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    const note     = ci.note >= 0 ? (myRow[ci.note] || '').trim() : '';

    return { oneThing, isDone, subs, note };
  } catch(e) { console.error('Sheets 오류:', e.message); return null; }
}

// ── 주문별 실매출 (네이버페이·카카오페이는 payment_amount=0이라 못 씀) ──
// actual_order_amount.order_price_amount(상품금액) + shipping_fee 가 모든 결제수단에 기록됨.
// 검증(2026-05-21): canceled=F 합계 = 카페24 대시보드 매출 2,043,300원과 정확히 일치.
function cafe24OrderRevenue(o) {
  const a = (o && o.actual_order_amount) || {};
  return parseFloat(a.order_price_amount || 0) + parseFloat(a.shipping_fee || 0);
}

// ── 카페24 매출 (단순 합계) ────────────────────────────
async function getCafe24Sales(startDate, endDate) {
  endDate = endDate || startDate;
  try {
    let allOrders = [], offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}orders?start_date=${startDate}&end_date=${endDate}&limit=100&offset=${offset}`;
      const data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
      if (!data.orders || data.orders.length === 0) break;
      allOrders = allOrders.concat(data.orders);
      if (data.orders.length < 100) break;
      offset += 100;
    }
    const valid = allOrders.filter(o => o.canceled === 'F');
    return { sales: valid.reduce((s, o) => s + cafe24OrderRevenue(o), 0), count: valid.length };
  } catch(e) { console.error('Cafe24 오류:', e.message); return { sales: 0, count: 0 }; }
}

// ── 카페24 매출 (상품별 집계) ──────────────────────────
async function getCafe24SalesByProduct(startDate, endDate) {
  endDate = endDate || startDate;
  try {
    let allOrders = [], offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}orders?start_date=${startDate}&end_date=${endDate}&limit=100&offset=${offset}&embed=items`;
      const data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
      if (!data.orders || data.orders.length === 0) break;
      allOrders = allOrders.concat(data.orders);
      if (data.orders.length < 100) break;
      offset += 100;
    }
    const valid = allOrders.filter(o => o.paid === 'T' && o.canceled === 'F');

    const byProduct = {};
    valid.forEach(o => {
      const items = Array.isArray(o.items) ? o.items : (o.items ? [o.items] : []);
      items.forEach(item => {
        const raw = item.product_name_default || item.product_name || '';
        const name = raw.replace(/^\[.*?\]\s*/, '').trim();
        if (!name) return;
        const productNo = item.product_no;
        const key = `${productNo}`;
        const price = parseFloat(item.product_price || 0) + parseFloat(item.option_price || 0);
        const qty = parseInt(item.quantity || 1);
        if (!byProduct[key]) byProduct[key] = { productNo, name, count: 0, amount: 0 };
        byProduct[key].count += qty;
        byProduct[key].amount += price * qty;
      });
    });

    const totalSales = Object.values(byProduct).reduce((s, v) => s + v.amount, 0);
    return { totalSales, count: valid.length, byProduct };
  } catch(e) { console.error('Cafe24 상품별 오류:', e.message); return { totalSales: 0, count: 0, byProduct: {} }; }
}

// ── 일별 주문 요약 (매출 + 유입경로 + 결제수단) ──────────
// order_place_name = 주문이 일어난 곳(모바일웹/네이버페이/톡체크아웃/PC). 광고소재별 X.
async function getCafe24DailyOrders(startDate, endDate) {
  endDate = endDate || startDate;
  try {
    let all = [], offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}orders?start_date=${startDate}&end_date=${endDate}&limit=100&offset=${offset}`;
      const data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
      if (!data.orders || data.orders.length === 0) break;
      all = all.concat(data.orders);
      if (data.orders.length < 100) break;
      offset += 100;
    }
    const valid = all.filter(o => o.canceled === 'F');
    const paidCount = all.filter(o => o.paid === 'T').length; // 대시보드 '결제' 기준(취소 포함)
    const revenue = valid.reduce((s, o) => s + cafe24OrderRevenue(o), 0);
    const LABEL = { '네이버 페이': '네이버페이', '톡체크아웃': '톡(카카오)', '모바일웹': '모바일웹', 'PC쇼핑몰': 'PC' };
    const channels = {};
    valid.forEach(o => { const k = LABEL[o.order_place_name] || o.order_place_name || '기타'; channels[k] = (channels[k] || 0) + 1; });
    const channelList = Object.entries(channels).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    // 결제수단 분포 (payment_gateway_names raw) — GA4 funnel보다 정확한 결제 흐름 진실
    const payMethods = { 자체결제: 0, 네이버페이: 0, 카카오페이: 0, 기타간편: 0 };
    valid.forEach(o => {
      const gw = (o.payment_gateway_names || []).join('').toLowerCase();
      if (gw.includes('naver')) payMethods.네이버페이++;
      else if (gw.includes('kakao')) payMethods.카카오페이++;
      else if (gw.includes('payco') || gw.includes('toss') || gw.includes('ssg') || gw.includes('smilepay')) payMethods.기타간편++;
      else payMethods.자체결제++;
    });
    return {
      totalCount: all.length,
      validCount: valid.length,
      paidCount,
      canceledCount: all.length - valid.length,
      revenue,
      channels: channelList,
      payMethods,
    };
  } catch(e) { console.error('Cafe24 일별주문 오류:', e.message); return null; }
}

// ── 재구매·리텐션 분석 (카페24 회원 주문 이력) ──────────
// OKR "바질 재구매자 300명" 추적용. 송마망 봇 미커버 영역.
async function getRepurchaseStats(lookbackDays, periodStart, periodEnd) {
  try {
    const start = dateStr(lookbackDays);
    const end = dateStr(1);
    let allOrders = [], offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}orders?start_date=${start}&end_date=${end}&limit=100&offset=${offset}`;
      const data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
      if (!data.orders || data.orders.length === 0) break;
      allOrders = allOrders.concat(data.orders);
      if (data.orders.length < 100) break;
      offset += 100;
      if (offset > 20000) break;
    }
    const valid = allOrders.filter(o => o.paid === 'T' && o.canceled === 'F');

    // 회원별 주문 이력 (게스트는 신원 식별 불가 → 신규로 취급)
    const byMember = {};
    valid.forEach(o => {
      const mid = (o.member_id || '').trim();
      if (!mid) return;
      const d = String(o.order_date || '').slice(0, 10);
      const amt = cafe24OrderRevenue(o);
      (byMember[mid] = byMember[mid] || []).push({ date: d, amt });
    });
    Object.values(byMember).forEach(list => list.sort((a, b) => a.date < b.date ? -1 : 1));

    const distinctMembers = Object.keys(byMember).length;
    const repeatMembers = Object.values(byMember).filter(l => l.length >= 2).length;
    const repurchaseRate = distinctMembers ? (repeatMembers / distinctMembers * 100) : 0;

    // 재구매까지 평균 일수 (1→2회차)
    let gapSum = 0, gapN = 0;
    Object.values(byMember).forEach(l => {
      if (l.length >= 2) {
        const g = (new Date(l[1].date) - new Date(l[0].date)) / 86400000;
        if (g >= 0) { gapSum += g; gapN++; }
      }
    });
    const avgDaysToRepeat = gapN ? Math.round(gapSum / gapN) : null;

    // 이번 기간(주간) 신규 vs 재구매 매출 분리
    let newCount = 0, newAmt = 0, repCount = 0, repAmt = 0, guestCount = 0, guestAmt = 0;
    valid.forEach(o => {
      const od = String(o.order_date || '').slice(0, 10);
      if (od < periodStart || od > periodEnd) return;
      const amt = cafe24OrderRevenue(o);
      const mid = (o.member_id || '').trim();
      if (!mid) { guestCount++; guestAmt += amt; return; }
      const hist = byMember[mid] || [];
      const earlier = hist.some(x => x.date < od);
      if (earlier) { repCount++; repAmt += amt; }
      else { newCount++; newAmt += amt; }
    });
    const periodTotal = newAmt + repAmt + guestAmt;
    const repShare = periodTotal ? (repAmt / periodTotal * 100) : 0;

    return {
      lookbackDays, distinctMembers, repeatMembers, repurchaseRate, avgDaysToRepeat,
      week: { newCount, newAmt, repCount, repAmt, guestCount, guestAmt, repShare },
    };
  } catch (e) { console.error('재구매 분석 오류:', e.message); return null; }
}

// ── 고객 세그먼트 (Cafe24 raw 기준 — GA4 newVsReturning 신뢰 X) ──
// 어제 주문자의 진짜 NEW/RETURN을 회원ID·전화번호로 식별.
// lookbackDays: 어제 이전 윈도우 (기본 90일). 베이스라인 코호트 비교용은 365일 권장.
async function fetchCafe24OrdersRange(startDate, endDate) {
  // date range가 너무 길면 카페24 측 한도 의심 → 30일 단위로 분할 호출
  const SPAN = 30;
  const all = [];
  let s = new Date(startDate + 'T00:00:00Z');
  const e = new Date(endDate + 'T00:00:00Z');
  while (s <= e) {
    const chunkEnd = new Date(Math.min(s.getTime() + (SPAN - 1) * 86400000, e.getTime()));
    const cs = s.toISOString().slice(0, 10);
    const ce = chunkEnd.toISOString().slice(0, 10);
    let offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}orders?start_date=${cs}&end_date=${ce}&limit=100&offset=${offset}`;
      let data = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
        if (data && Array.isArray(data.orders)) break;   // 정상 응답(빈 배열 포함) — 재시도 불필요
        await new Promise(r => setTimeout(r, 600));        // rate limit/일시 오류 → 대기 후 재시도 (부분 데이터 방지)
      }
      if (!data || !Array.isArray(data.orders) || data.orders.length === 0) break;
      all.push(...data.orders);
      if (data.orders.length < 100) break;
      offset += 100;
      if (offset > 20000) break;
    }
    s = new Date(chunkEnd.getTime() + 86400000);
  }
  return all.filter(o => o.paid === 'T' && o.canceled === 'F');
}

// ⚠️ cafe24 customers API에 first_order_date 필드 X (검증 2026-05-26). 주문 raw lookback이 유일한 정확 경로.
// 그래서 기본 lookback을 365일로 확대 — 베이스라인(5개월) 코호트 비교 충분 커버.

async function getCafe24CustomerSegments(date, lookbackDays = 365) {
  try {
    // 1) 어제 주문 raw
    const todayOrders = await fetchCafe24OrdersRange(date, date);
    if (todayOrders.length === 0) return null;

    // 2) 어제 주문에서 식별자 추출
    const memberIds = new Set();
    const guestPhones = new Set();
    todayOrders.forEach(o => {
      const mid = (o.member_id || '').trim();
      if (mid) memberIds.add(mid);
      else {
        const tel = String(o.buyer_cellular || o.buyer_phone || '').replace(/[^0-9]/g, '');
        if (tel) guestPhones.add(tel);
      }
    });

    // 3) lookback 윈도우 내 모든 prior 주문 fetch (회원·게스트 둘 다 식별용)
    const lookbackStart = new Date(new Date(date + 'T00:00:00Z').getTime() - lookbackDays * 86400000).toISOString().slice(0, 10);
    const lookbackEnd = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const priorOrders = await fetchCafe24OrdersRange(lookbackStart, lookbackEnd);

    // 4) 회원별 첫 주문일 / 게스트별 이전 주문 횟수 빌드
    const firstOrderByMember = {};
    const priorCountByPhone = {};
    priorOrders.forEach(o => {
      const od = String(o.order_date || '').slice(0, 10);
      const mid = (o.member_id || '').trim();
      if (mid) {
        if (!firstOrderByMember[mid] || od < firstOrderByMember[mid]) firstOrderByMember[mid] = od;
      } else {
        const tel = String(o.buyer_cellular || o.buyer_phone || '').replace(/[^0-9]/g, '');
        if (tel) priorCountByPhone[tel] = (priorCountByPhone[tel] || 0) + 1;
      }
    });

    // 5) 어제 주문 분류
    const member = { newCount: 0, newAmt: 0, retCount: 0, retAmt: 0 };
    const guest = { newCount: 0, newAmt: 0, repeatCount: 0, repeatAmt: 0 };
    const returnMemberIds = []; // 재방문 회원 list (디버그용)
    const repeatGuestPhones = []; // 반복 게스트 list (디버그용)
    todayOrders.forEach(o => {
      const amt = cafe24OrderRevenue(o);
      const mid = (o.member_id || '').trim();
      if (mid) {
        const first = firstOrderByMember[mid];
        if (first && first < date) { member.retCount++; member.retAmt += amt; returnMemberIds.push(mid); }
        else { member.newCount++; member.newAmt += amt; }
      } else {
        const tel = String(o.buyer_cellular || o.buyer_phone || '').replace(/[^0-9]/g, '');
        if (tel && priorCountByPhone[tel] > 0) { guest.repeatCount++; guest.repeatAmt += amt; repeatGuestPhones.push(tel); }
        else { guest.newCount++; guest.newAmt += amt; }
      }
    });

    return {
      date, lookbackDays,
      totalOrders: todayOrders.length,
      totalAmt: todayOrders.reduce((s, o) => s + cafe24OrderRevenue(o), 0),
      member, guest,
      memberShare: todayOrders.length ? ((member.newCount + member.retCount) / todayOrders.length) : 0,
      memberRetRate: (member.newCount + member.retCount) > 0 ? (member.retCount / (member.newCount + member.retCount)) : 0,
      guestPhones: Array.from(guestPhones), // CRM join용 노출
      returnMemberIds, repeatGuestPhones,
    };
  } catch (e) { console.error('고객 세그먼트 오류:', e.message); return null; }
}

// CRM 고객목록 시트 매칭 — 게스트 buyer_tel을 회원 전화번호와 join하면
// "회원 가입했는데 비회원으로 산 사람" 또는 "이전 게스트가 결국 회원이 된 사람" 식별 가능
const CRM_SHEET_ID = '1AQX7-CAEfWuJ4cbnxA-1jq4pK9CqEusMgY6cY--ZQ34';
async function enrichGuestSegmentsWithCRM(segments) {
  if (!segments || !segments.guestPhones || segments.guestPhones.length === 0) return segments;
  try {
    const token = await getGA4Token(); // drive.readonly + spreadsheets.readonly 같은 scope
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CRM_SHEET_ID}/values/${encodeURIComponent('고객목록!A2:F2000')}`;
    const data = await fetchJson(url, { 'Authorization': `Bearer ${token}` });
    const phoneSet = new Set();
    (data.values || []).forEach(row => {
      const tel = String(row[1] || '').replace(/[^0-9]/g, '');
      if (tel) phoneSet.add(tel);
    });
    let matched = 0;
    segments.guestPhones.forEach(tel => { if (phoneSet.has(tel)) matched++; });
    segments.crmMatchedGuests = matched;
    segments.crmMatchRate = segments.guestPhones.length ? (matched / segments.guestPhones.length) : 0;
    return segments;
  } catch (e) { console.error('CRM 매칭 오류:', e.message); return segments; }
}

// ── CRM 시트 (재입고알림 / 최근 VOC) ───────────────────
async function fetchRestockRequests() {
  try {
    const token = await getGA4Token();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CRM_SHEET_ID}/values/${encodeURIComponent('재입고알림!A2:D1000')}`;
    const data = await fetchJson(url, { 'Authorization': `Bearer ${token}` });
    const rows = (data.values || []).filter(r => r[0]);
    const today = dateStr(0);
    const todayCount = rows.filter(r => String(r[2] || '').startsWith(today)).length;
    const thisMonth = today.slice(0, 7);
    const lastMonth = (() => { const d = new Date(today); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
    const thisMonthCount = rows.filter(r => String(r[2] || '').startsWith(thisMonth)).length;
    const lastMonthCount = rows.filter(r => String(r[2] || '').startsWith(lastMonth)).length;
    const sentCount = rows.filter(r => r[3] === 'Y').length;
    const pendingCount = rows.length - sentCount;
    return {
      totalCount: rows.length, sentCount, pendingCount,
      todayCount, thisMonthCount, lastMonthCount,
      paceVsLastMonth: lastMonthCount > 0 ? (thisMonthCount / lastMonthCount) : null,
    };
  } catch (e) { console.error('재입고알림 fetch 오류:', e.message); return null; }
}

async function fetchNegativeVOC(dateStrYmd) {
  // dateStrYmd: 'YYYY-MM-DD' — 어제 + 오늘 VOC 중 부정/중립/개선만
  try {
    const token = await getGA4Token();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CRM_SHEET_ID}/values/${encodeURIComponent('📢 VOC!A2:H1500')}`;
    const data = await fetchJson(url, { 'Authorization': `Bearer ${token}` });
    const rows = (data.values || []).filter(r => r[0] === dateStrYmd || r[0] === dateStr(0));
    const negs = rows.filter(r => !/긍정/.test(r[6] || ''));
    return {
      totalToday: rows.length,
      negCount: negs.length,
      items: negs.slice(0, 3).map(r => ({ date: r[0], cls: r[6], product: r[3], rating: r[4], excerpt: String(r[5] || '').slice(0, 80) })),
    };
  } catch (e) { console.error('VOC fetch 오류:', e.message); return null; }
}

// ── 송마망 회의록 (RAW + 액션 + Telegram 단톡방 — Claude 프롬프트 주입용) ──
const SONGMAMANS_SHEET_ID = '1pBqKnyOQHwepzo65B_TCJ0dU-yjRL1aLs-TfEfBjXJI';
const { fetchSongmamansChat } = require('./lib/telegram_user');

async function fetchSongmamansContext() {
  try {
    const token = await getGA4Token();
    const today = dateStr(0);
    const yesterday = dateStr(1);
    // batch: RAW 최근 + 액션 + 의견_결정 + 단톡방 직접 fetch
    const ranges = [
      encodeURIComponent('📥 RAW!A2:E300'),
      encodeURIComponent('✅ 액션!A2:I100'),
      encodeURIComponent('💡 의견_결정!A2:I100'),
    ];
    const urls = ranges.map(r => `https://sheets.googleapis.com/v4/spreadsheets/${SONGMAMANS_SHEET_ID}/values/${r}`);
    const [[rawData, actData, decData], tgChat] = await Promise.all([
      Promise.all(urls.map(u => fetchJson(u, { 'Authorization': `Bearer ${token}` }))),
      fetchSongmamansChat(1).catch(e => { console.error('[단톡방 fetch 오류]', e.message); return null; }),
    ]);

    const rawRows = rawData.values || [];
    const recentRaw = rawRows.filter(r => {
      const t = String(r[0] || '');
      return t.startsWith(today) || t.startsWith(yesterday);
    }).slice(-20);

    const actions = (actData.values || []).filter(r => r[6] !== '완료' && r[2]);
    const openActions = actions.map(r => ({
      id: r[0], date: r[1], owner: r[2], content: String(r[3] || '').slice(0, 100),
      due: r[4], priority: r[5], status: r[6], by: r[7],
    }));

    const recentDecisions = (decData.values || []).filter(r => r[1]).slice(-10).map(r => ({
      id: r[0], date: r[1], topic: r[2], status: r[4], decision: String(r[5] || '').slice(0, 80), decidedAt: r[7],
    }));

    // 단톡방: 사람 메시지만 추출 (봇 출력은 분량 절약 — 봇 발화수만 카운트)
    let tgMessages = null;
    let tgBotSummary = null;
    if (tgChat) {
      tgMessages = tgChat.messages
        .filter(m => !m.isBot && m.text)
        .slice(-30)
        .map(m => `[${m.date.slice(11, 16)} ${m.senderName}] ${m.text.slice(0, 120)}`);
      tgBotSummary = Object.entries(tgChat.bySender)
        .filter(([k]) => k.includes('(bot)'))
        .map(([k, v]) => `${k}: ${v}건`)
        .join(', ');
    }

    return { recentRaw, openActions, recentDecisions, tgMessages, tgBotSummary, tgTotal: tgChat?.total };
  } catch (e) { console.error('회의록 컨텍스트 오류:', e.message); return null; }
}

// ── Meta 광고 ──────────────────────────────────────────
async function getMetaStats(since, until) {
  try {
    const fields = 'spend,impressions,reach,frequency,clicks,ctr,cpm,actions,action_values';
    const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT}/insights?fields=${fields}&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`;
    const data = await fetchJson(url);
    if (!data.data?.length) return { spend:0, impressions:0, reach:0, frequency:0, clicks:0, ctr:0, cpm:0, purchases:0, revenue:0, roas:0, landing:0, viewContent:0, addToCart:0, checkout:0 };
    const d = data.data[0];
    const spend = parseFloat(d.spend||0);
    const findA = (type) => parseInt((d.actions||[]).find(a=>a.action_type===type)?.value||0);
    const purchases = findA('purchase');
    const revenue = parseFloat((d.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
    return {
      spend,
      impressions: parseInt(d.impressions||0),
      reach: parseInt(d.reach||0),
      frequency: parseFloat(d.frequency||0),
      clicks: parseInt(d.clicks||0),
      ctr: parseFloat(d.ctr||0),
      cpm: parseFloat(d.cpm||0),
      purchases,
      revenue,
      roas: spend>0 ? ((revenue/spend)*100).toFixed(0) : 0,
      landing: findA('landing_page_view'),
      viewContent: findA('view_content'),
      addToCart: findA('add_to_cart'),
      checkout: findA('initiate_checkout'),
    };
  } catch(e) { return { spend:0, impressions:0, reach:0, frequency:0, clicks:0, ctr:0, cpm:0, purchases:0, revenue:0, roas:0, landing:0, viewContent:0, addToCart:0, checkout:0 }; }
}

// 캠페인별 메타 성과 (주간 스냅샷용) — 메타 자체 추적이라 UTM 불필요·정확
async function getMetaByCampaign(since, until) {
  try {
    const fields = 'campaign_name,spend,ctr,actions,action_values';
    const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT}/insights?level=campaign&fields=${fields}&time_range={"since":"${since}","until":"${until}"}&limit=200&access_token=${META_TOKEN}`;
    const data = await fetchJson(url);
    if (!data.data?.length) return [];
    return data.data.map(d => {
      const spend = parseFloat(d.spend || 0);
      const purchases = parseInt((d.actions || []).find(a => a.action_type === 'purchase')?.value || 0);
      const revenue = parseFloat((d.action_values || []).find(a => a.action_type === 'purchase')?.value || 0);
      return {
        campaign: (d.campaign_name || '(이름없음)').slice(0, 60),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: spend > 0 ? Math.round((revenue / spend) * 100) : 0,
        ctr: parseFloat((d.ctr || 0)).toFixed(2),
        purchases,
      };
    }).sort((a, b) => b.spend - a.spend);
  } catch (e) { console.error('[캠페인별 메타 오류]', e.message); return []; }
}

// GA4 채널·신규재방문 슬라이스 (임의 주간 범위, 백필 가능)
async function getGA4Slices(since, until) {
  try {
    const token = await getGA4Token();
    const dr = { startDate: since, endDate: until };
    const [chRes, utRes] = await Promise.all([
      ga4Fetch(token, { dateRanges:[dr], metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'sessionDefaultChannelGroup'}] }),
      ga4Fetch(token, { dateRanges:[dr], metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
    ]);
    const channels = (chRes.rows || []).map(r => ({
      channel: r.dimensionValues[0].value || '(미지정)',
      sessions: parseInt(r.metricValues[0].value),
      conv: parseInt(r.metricValues[1].value),
    })).sort((a, b) => b.sessions - a.sessions);
    const userType = (utRes.rows || []).map(r => ({
      type: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      conv: parseInt(r.metricValues[1].value),
    }));
    return { channels, userType };
  } catch (e) { console.error('[GA4 슬라이스 오류]', e.message); return { channels: [], userType: [] }; }
}

async function getMetaLandingPage() {
  try {
    const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT}/ads?fields=creative&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&limit=1&access_token=${META_TOKEN}`;
    const ads = await fetchJson(url);
    const creativeId = ads.data?.[0]?.creative?.id;
    if (!creativeId) return null;
    const c = await fetchJson(`https://graph.facebook.com/v19.0/${creativeId}?fields=object_story_spec&access_token=${META_TOKEN}`);
    const rawLink = c.object_story_spec?.video_data?.call_to_action?.value?.link
                 || c.object_story_spec?.link_data?.link
                 || '';
    const productNos = [...rawLink.matchAll(/surl\/p\/(\d+)/g)].map(m => parseInt(m[1]));
    const displayUrl = productNos.length ? productNos.map(n => `#${n}`).join(', ') : (rawLink.split('%20')[0] || null);
    return { url: displayUrl || null, productNos };
  } catch(e) { return { url: null, productNos: [] }; }
}

// ── P0: ACTIVE 광고 23개 URL 형식 검증 (2026-05-21 incident 재발 방지) ──
// 정상: https://italy-jungmiso.com/surl/p/{숫자}  (옵션 ?utm_*)
// 깨짐: 공백 합침, 두 URL, surl/p/숫자 외 path
async function auditMetaAdUrls() {
  try {
    const fields = 'name,effective_status,creative{object_story_spec}';
    const filter = encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]');
    const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT}/ads?fields=${fields}&filtering=${filter}&limit=100&access_token=${META_TOKEN}`;
    const data = await fetchJson(url);
    if (!data.data?.length) return { total: 0, broken: [], healthy: 0 };

    // 정상으로 인정하는 단일 클린 URL: surl 단축링크 또는 카페24 표준 상품페이지(자사몰 전체가 쓰는 형식)
    const SURL_RE   = /^https:\/\/italy-jungmiso\.com\/surl\/p\/\d+(?:\?[^\s%]*)?$/;
    const DETAIL_RE = /^https:\/\/italy-jungmiso\.com\/product\/detail\.html\?product_no=\d+(?:&[^\s%]*)?$/;
    const broken = [];        // 진짜 깨짐(JS 에러 유발): %20·공백·여러 URL 합침
    const nonStandard = [];   // 작동은 하나 UTM 단축링크 표준(/surl/p) 아님 — 추적 누락 가능
    let healthy = 0;

    for (const ad of data.data) {
      const spec = ad.creative?.object_story_spec || {};
      const link = spec.video_data?.call_to_action?.value?.link
                || spec.link_data?.link
                || '';
      if (!link) continue;
      const malformed = link.includes('%20') || / /.test(link) || (link.match(/https?:\/\//g) || []).length > 1;
      if (malformed) {
        const reason = (link.includes('%20') || / /.test(link)) ? '공백/%20 포함' : '여러 URL 합침';
        broken.push({ id: ad.id, name: ad.name, link: link.slice(0, 120), reason });
      } else if (SURL_RE.test(link)) {
        healthy++;
      } else if (DETAIL_RE.test(link)) {
        nonStandard.push({ id: ad.id, name: ad.name, link: link.slice(0, 120), reason: '표준 상품URL(작동 OK·UTM 없음)' });
      } else {
        broken.push({ id: ad.id, name: ad.name, link: link.slice(0, 120), reason: '알 수 없는 형식' });
      }
    }
    return { total: data.data.length, broken, nonStandard, healthy };
  } catch (e) { console.error('[광고 URL 검증 오류]', e.message); return null; }
}

// ── GA4 액세스 토큰 ────────────────────────────────────
async function getGA4Token() {
  const body = Buffer.from(`client_id=${ga4Config.client_id}&client_secret=${ga4Config.client_secret}&refresh_token=${ga4Config.refresh_token}&grant_type=refresh_token`);
  const res = await new Promise((resolve, reject) => {
    const req = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':body.length} }, (r)=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(body); req.end();
  });
  return res.access_token;
}

function ga4Fetch(token, body) {
  return new Promise((resolve, reject) => {
    const s = JSON.stringify(body);
    const req = https.request({ hostname:'analyticsdata.googleapis.com', path:`/v1beta/properties/${ga4Config.property_id}:runReport`, method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(s)} }, (res)=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(s); req.end();
  });
}

// GA4 주간 비교 데이터
async function getGA4Weekly() {
  try {
    const token = await getGA4Token();
    const tw = { startDate: dateStr(7), endDate: dateStr(1) };
    const lw = { startDate: dateStr(14), endDate: dateStr(8) };
    const base = (dr) => ({ dateRanges:[dr] });

    const [chThis, chLast, utThis, utLast, landingRes, productsRes] = await Promise.all([
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'averageSessionDuration'}], dimensions:[{name:'sessionDefaultChannelGroup'}] }),
      ga4Fetch(token, { ...base(lw), metrics:[{name:'sessions'}], dimensions:[{name:'sessionDefaultChannelGroup'}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(lw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'landingPagePlusQueryString'}], limit:5, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'screenPageViews'},{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'pagePathPlusQueryString'}], limit:50, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
    ]);

    const channels = {};
    (chThis.rows||[]).forEach(r => {
      const ch = r.dimensionValues[0].value;
      channels[ch] = { cur: { sessions: parseInt(r.metricValues[0].value), avgDuration: Math.round(parseFloat(r.metricValues[1].value)) }, prev: { sessions: 0 } };
    });
    (chLast.rows||[]).forEach(r => {
      const ch = r.dimensionValues[0].value;
      if (!channels[ch]) channels[ch] = { cur: { sessions:0 }, prev: { sessions:0 } };
      channels[ch].prev.sessions = parseInt(r.metricValues[0].value);
    });

    const parseUT = (rows) => {
      const res = { new:{sessions:0,conv:0}, ret:{sessions:0,conv:0} };
      (rows||[]).forEach(r => {
        const key = r.dimensionValues[0].value === 'new' ? 'new' : 'ret';
        res[key].sessions = parseInt(r.metricValues[0].value);
        res[key].conv = parseInt(r.metricValues[1].value);
      });
      return res;
    };
    const userType = { cur: parseUT(utThis.rows), prev: parseUT(utLast.rows) };

    const landings = (landingRes.rows||[]).slice(0,5).map(r => ({
      page: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      conversions: parseInt(r.metricValues[1].value),
      cvr: pct(parseInt(r.metricValues[1].value), parseInt(r.metricValues[0].value)),
    }));

    // 상품별 페이지 성과 (product_no 기준 그루핑)
    const products = {};
    (productsRes.rows||[]).forEach(r => {
      const path = r.dimensionValues[0].value;
      const m = path.match(/product_no=(\d+)/);
      if (!m) return;
      const id = m[1];
      if (!products[id]) products[id] = { id, pv:0, sessions:0, purchases:0 };
      products[id].pv += parseInt(r.metricValues[0].value);
      products[id].sessions += parseInt(r.metricValues[1].value);
      products[id].purchases += parseInt(r.metricValues[2].value);
    });
    const topProducts = Object.values(products).sort((a,b)=>b.sessions-a.sessions).slice(0,5);

    return { channels, userType, landings, topProducts };
  } catch(e) { console.error('GA4 오류:', e.message); return null; }
}

// ── 카페24 리뷰 ────────────────────────────────────────
async function getCafe24Reviews(startDate, endDate) {
  endDate = endDate || startDate;
  try {
    let articles = [], offset = 0;
    while (true) {
      const url = `${CAFE24_BASE}boards/4/articles?created_start_date=${startDate}&created_end_date=${endDate}&limit=100&offset=${offset}`;
      const data = await fetchJson(url, { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION });
      if (!data.articles || data.articles.length === 0) break;
      articles = articles.concat(data.articles);
      if (data.articles.length < 100) break;
      offset += 100;
    }
    const ratings = articles.map(a => parseInt(a.rating || 0)).filter(r => r > 0);
    const avg = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : 0;
    const dist = { 5: 0, 4: 0, low: 0 };
    ratings.forEach(r => { if (r === 5) dist[5]++; else if (r === 4) dist[4]++; else dist.low++; });
    const texts = articles.slice(0, 30).map(a => `[${a.rating}점] ${a.title}`).join('\n');
    return { count: articles.length, avg, dist, texts };
  } catch(e) { console.error('리뷰 오류:', e.message); return null; }
}

// ── GA4 일간 (어제 채널·상품 페이지·짧은URL 손실 감지) ─
// 유입 출처(채널) 기준 라벨 — 사용자 확정 매핑 (2026-05-26)
// 같은 SKU도 어떤 채널로 들어왔는지로 분류해야 의미있음. cafe24 진열명이 아니라 트래픽 출처로.
const PRODUCT_NAME = {
  '27': '오가닉',
  '38': '생활작가 콜라보 (판매중지)',
  '40': '요진편 공구',
  '41': '쿠코 공구 (판매중지)',
  '42': '비밀링크',
  '50': '예닮 공구 (판매중지)',
  '51': '찬밥 공구 (판매중지)',
  '52': '메가쇼 특가 (판매중지)',
  '83': '메타광고',
  '84': '메타광고',
  '85': 'LG 임직원 특가',
  '87': '꿀동이 공구',
};
// 꿀동이 = #87 only (확정). 다른 채널별 공구 SKU는 별도 카운트.
const KKUL_PRODUCT_NO = '87';
const CHANNEL_KR = { 'Paid Social':'유료SNS', 'Organic Social':'자연SNS', 'Direct':'직접유입', 'Organic Search':'검색', 'Paid Other':'기타광고', 'Referral':'추천', 'Organic Shopping':'쇼핑', 'Unassigned':'미분류' };

async function getGA4Daily(dateStrYmd) {
  try {
    const token = await getGA4Token();
    const range = { startDate: dateStrYmd, endDate: dateStrYmd };
    const [chRes, utRes, pageRes, funnelRes] = await Promise.all([
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'sessionDefaultChannelGroup'}], limit: 8, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'screenPageViews'},{name:'sessions'}], dimensions:[{name:'pagePathPlusQueryString'}], limit: 40, orderBys:[{metric:{metricName:'screenPageViews'},desc:true}] }),
      // 결제 단계별 이탈 — 이벤트 횟수 X, "이벤트가 발생한 세션 수"(사람 기준)로 집계.
      // eventCount는 한 사람이 결제창 들락날락하면 중복 카운트(예: 5/21 begin_checkout 37건=실제 24세션).
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'sessions'}], dimensions:[{name:'eventName'}], dimensionFilter:{ filter:{ fieldName:'eventName', inListFilter:{ values:['add_to_cart','begin_checkout','purchase'] } } } }),
    ]);
    const channels = (chRes.rows||[]).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      purchases: parseInt(r.metricValues[1].value),
    }));
    const userType = { new:{sessions:0,purchases:0}, ret:{sessions:0,purchases:0} };
    (utRes.rows||[]).forEach(r => {
      const k = r.dimensionValues[0].value === 'new' ? 'new' : 'ret';
      userType[k].sessions = parseInt(r.metricValues[0].value);
      userType[k].purchases = parseInt(r.metricValues[1].value);
    });
    let surlSessions = 0;
    (pageRes.rows||[]).forEach(r => {
      const path = r.dimensionValues[0].value;
      if (/^\/surl\/p\//i.test(path)) surlSessions += parseInt(r.metricValues[1].value);
    });
    // 결제 퍼널: add_to_cart → begin_checkout → purchase (세션 수 기준)
    const funnelMap = {};
    (funnelRes.rows||[]).forEach(r => { funnelMap[r.dimensionValues[0].value] = parseInt(r.metricValues[0].value); });
    const checkoutFunnel = {
      addToCart: funnelMap['add_to_cart'] || 0,
      beginCheckout: funnelMap['begin_checkout'] || 0,
      purchase: funnelMap['purchase'] || 0,
    };
    // 이탈률 계산
    checkoutFunnel.cartToCheckoutPct = checkoutFunnel.addToCart > 0
      ? Math.round(checkoutFunnel.beginCheckout / checkoutFunnel.addToCart * 100) : null;
    checkoutFunnel.checkoutToPurchasePct = checkoutFunnel.beginCheckout > 0
      ? Math.round(checkoutFunnel.purchase / checkoutFunnel.beginCheckout * 100) : null;

    return { channels, userType, surlSessions, checkoutFunnel };
  } catch(e) { console.error('GA4 일간 오류:', e.message); return null; }
}

// ── Clarity ────────────────────────────────────────────
async function getClarityData() {
  try {
    const data = await fetchJson(`https://www.clarity.ms/export-data/api/v1/project-live-insights?projectId=${CLARITY_PROJECT_ID}`, { 'Authorization': `Bearer ${clarityToken}` });
    const get = (name) => data.find(d => d.metricName === name);
    const traffic = get('Traffic')?.information[0];
    const totalSessions = parseInt(traffic?.totalSessionCount || 1);
    const browsers = get('Browser')?.information || [];
    const instagramPct = ((parseInt(browsers.find(b=>b.name==='InstagramApp')?.sessionsCount||0) / totalSessions) * 100).toFixed(1);
    const popularPages = get('PopularPages')?.information || [];
    const topPages = get('PageTitle')?.information || [];
    const getVisits = (kw) => parseInt(popularPages.find(p=>p.url?.includes(kw))?.visitsCount||0);
    const purchasePages = topPages.filter(p=>p.name?.includes('구매하기'));

    return {
      totalSessions,
      quickbackPct: get('QuickbackClick')?.information[0]?.sessionsWithMetricPercentage || 0,
      scriptErrorPct: get('ScriptErrorCount')?.information[0]?.sessionsWithMetricPercentage || 0,
      deadClickPct: get('DeadClickCount')?.information[0]?.sessionsWithMetricPercentage || 0,
      rageClickPct: get('RageClickCount')?.information[0]?.sessionsWithMetricPercentage || 0,
      scrollDepth: get('ScrollDepth')?.information[0]?.averageScrollDepth || 0,
      activeTimeSec: parseInt(get('EngagementTime')?.information[0]?.activeTime || 0),
      instagramPct: parseFloat(instagramPct),
      funnel: {
        landing: getVisits('surl/p'),
        product: getVisits('product/detail'),
        login: getVisits('member/login'),
        cart: getVisits('order/basket'),
        checkout: purchasePages.reduce((s,p)=>s+parseInt(p.sessionsCount||0),0),
      },
    };
  } catch(e) { console.error('Clarity 오류:', e.message); return null; }
}

// Cafe24 외부결제(네이버페이·톡 등) → GA4 MP push (gtag로 추적 불가한 결제 attribution 회복)
async function pushExternalOrdersToGA4(date) {
  try {
    const all = await fetchCafe24OrdersRange(date, date);
    const paid = all.filter(o => o.paid === 'T' && o.canceled === 'F');
    // 외부결제 필터: order_place_name이 모바일웹/PC쇼핑몰이 아닌 것 (gtag 추적 못 함)
    const external = paid.filter(o => {
      const ch = String(o.order_place_name || '');
      return ch && !/^모바일웹$|^PC쇼핑몰$|^PC.?웹$/i.test(ch);
    });
    if (!external.length) return { ok: true, sent: 0, total: paid.length, note: '외부결제 없음' };
    const orders = external.map(o => ({ id: String(o.order_id), value: cafe24OrderRevenue(o), channel: o.order_place_name || '' }));
    const res = await postToAppsScript({ action: 'push_ga4_orders', date, orders }, APPS_SCRIPT_URL);
    return res;
  } catch (e) { console.error('[GA4 외부결제 push 실패]', e.message); return null; }
}

// 일별 스냅샷 — Before/After 측정 + 7일 이동평균 폭증 감지용
function buildDailySnapshot(date, { clarity, dailyOrders, segments, meta, adAudit, pageStats, ltv }) {
  const findP = (pno) => pickClarityPage(pageStats?.byUrl, v => v.url.includes(`product_no=${pno}`) || v.url.includes(`/surl/p/${pno}`));
  const findCO = (prefix) => pickClarityPage(pageStats?.byUrl, v => v.url.startsWith(prefix));
  const basket = findCO('/order/basket'), orderform = findCO('/order/orderform'), login = findCO('/member/login');
  const p87 = findP('87'), p83 = findP('83'), p84 = findP('84'), p27 = findP('27');
  const blended = meta?.spend > 0 ? Math.round((dailyOrders?.revenue || 0) / meta.spend * 100) : 0;
  const metaShare = dailyOrders?.revenue > 0 ? Math.round((meta?.revenue || 0) / dailyOrders.revenue * 100) : 0;
  return {
    date,
    카페24매출: dailyOrders?.revenue || 0,
    카페24주문: dailyOrders?.totalCount || 0,
    광고비: Math.round(meta?.spend || 0),
    메타픽셀매출: Math.round(meta?.revenue || 0),
    메타ROAS: parseInt(meta?.roas) || 0,
    실제ROAS: blended,
    메타주장비중: metaShare,
    사이트_스크립트에러: clarity?.scriptErrorPct || 0,
    사이트_뒤로: clarity?.quickbackPct || 0,
    사이트_데드: clarity?.deadClickPct || 0,
    사이트_레이지: clarity?.rageClickPct || 0,
    사이트_인스타인앱: clarity?.instagramPct || 0,
    결제_장바구니_데드: basket?.dead || 0,
    결제_장바구니_뒤로: basket?.quick || 0,
    결제_결제폼_데드: orderform?.dead || 0,
    결제_결제폼_뒤로: orderform?.quick || 0,
    결제_로그인_데드: login?.dead || 0,
    결제_로그인_뒤로: login?.quick || 0,
    제품87_스크롤: p87?.scroll || 0,
    제품87_뒤로: p87?.quick || 0,
    제품83_스크롤: p83?.scroll || 0,
    제품83_뒤로: p83?.quick || 0,
    제품84_스크롤: p84?.scroll || 0,
    제품84_뒤로: p84?.quick || 0,
    제품27_스크롤: p27?.scroll || 0,
    제품27_뒤로: p27?.quick || 0,
    회원_신규: segments?.member?.newCount || 0,
    회원_재방문: segments?.member?.retCount || 0,
    게스트_신규: segments?.guest?.newCount || 0,
    게스트_반복: segments?.guest?.repeatCount || 0,
    광고URL_정상: adAudit?.healthy || 0,
    광고URL_깨짐: adAudit?.broken?.length || 0,
    LTV_회원수_365d: ltv?.회원_총수_365d || 0,
    LTV_재구매율: ltv?.회원_재구매율 || 0,
    LTV_상위10_점유: ltv?.상위10_매출점유 || 0,
    LTV_휴면_91_180d: ltv?.휴면_91_180d || 0,
    LTV_신규_D30_retention: ltv?.신규_D30_retention || 0,
  };
}

async function saveDailySnapshot(snapshot) {
  try { return await postToAppsScript({ action: 'save_daily_snapshot', ...snapshot }, APPS_SCRIPT_URL); }
  catch (e) { console.error('[일별 스냅샷 저장 실패]', e.message); return null; }
}

async function getDailyBaseline(daysBack = 7) {
  try {
    const res = await postToAppsScript({ action: 'get_daily_baseline', daysBack }, APPS_SCRIPT_URL);
    return res && res.ok ? { baseline: res.baseline || {}, count: res.count || 0 } : { baseline: {}, count: 0 };
  } catch (e) { return { baseline: {}, count: 0 }; }
}

// LTV 메트릭 — 365일 lookback 회원 단위 (cafe24 phone 마스킹으로 게스트 미측정, [[ltv-measurement-limits]])
// 매일 적재. 신규 D+30 retention은 30일 전 신규의 30일 안 재구매율.
async function calculateLTVMetrics(asOfDate) {
  const end = asOfDate;
  const start = new Date(new Date(end + 'T00:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10);
  const orders = await fetchCafe24OrdersRange(start, end);
  if (!orders.length) return null;

  // fetch 건강성용 — 실제 들어온 주문일의 최신/최古 (페이지네이션·토큰 누락 감지)
  const allOrderDates = orders.map(o => String(o.order_date || '').slice(0, 10)).filter(d => d).sort();
  const newestOrderDate = allOrderDates[allOrderDates.length - 1] || '';
  const oldestOrderDate = allOrderDates[0] || '';

  const byMember = {};
  for (const o of orders) {
    const mid = (o.member_id || '').trim();
    if (!mid) continue;
    if (!byMember[mid]) byMember[mid] = { orders: [], revenue: 0 };
    byMember[mid].orders.push(o);
    byMember[mid].revenue += Number(o.payment_amount || 0);
  }
  const list = Object.entries(byMember).map(([id, c]) => {
    const dates = c.orders.map(o => String(o.order_date || '').slice(0,10)).filter(d => d).sort();
    return { id, count: c.orders.length, revenue: c.revenue, first: dates[0] || '', last: dates[dates.length - 1] || '', dates };
  });

  const total = list.length;
  if (!total) return null;
  const sortedByRev = [...list].sort((a, b) => b.revenue - a.revenue);
  const totalRev = list.reduce((a, c) => a + c.revenue, 0);
  const top10Count = Math.ceil(total * 0.1);
  const top10Rev = sortedByRev.slice(0, top10Count).reduce((a, c) => a + c.revenue, 0);

  const repurchasers = list.filter(c => c.count >= 2).length;
  const nowMs = new Date(end + 'T00:00:00Z').getTime();
  const dormant91_180 = list.filter(c => {
    if (!c.last) return false;
    const ds = Math.floor((nowMs - new Date(c.last + 'T00:00:00Z').getTime()) / 86400000);
    return ds >= 91 && ds <= 180;
  }).length;

  // 신규 D+30 retention — 30~60일 전 첫구매자 중 첫구매 후 30일 안 재구매한 비율
  const thirty = new Date(nowMs - 30 * 86400000).toISOString().slice(0, 10);
  const sixty = new Date(nowMs - 60 * 86400000).toISOString().slice(0, 10);
  const d30Cohort = list.filter(c => c.first >= sixty && c.first < thirty);
  const d30Retained = d30Cohort.filter(c => {
    if (c.count < 2) return false;
    const firstMs = new Date(c.first + 'T00:00:00Z').getTime();
    const secondDate = c.dates[1];
    if (!secondDate) return false;
    const secondMs = new Date(secondDate + 'T00:00:00Z').getTime();
    return (secondMs - firstMs) <= 30 * 86400000;
  }).length;

  // lookback stale 감지용 — first 분포 폭
  const firsts = list.map(c => c.first).filter(d => d).sort();
  const firstSpanDays = firsts.length > 1
    ? Math.round((new Date(firsts[firsts.length-1] + 'T00:00:00Z') - new Date(firsts[0] + 'T00:00:00Z')) / 86400000)
    : 0;

  return {
    회원_총수_365d: total,
    회원_재구매율: Number((repurchasers / total * 100).toFixed(2)),
    상위10_매출점유: Number((top10Rev / totalRev * 100).toFixed(2)),
    휴면_91_180d: dormant91_180,
    신규_D30_retention: d30Cohort.length > 0 ? Number((d30Retained / d30Cohort.length * 100).toFixed(2)) : 0,
    신규_D30_cohort_size: d30Cohort.length,
    실제_lookback_일수: firstSpanDays,
    최신_주문일: newestOrderDate,
    최古_주문일: oldestOrderDate,
  };
}

// ── UX 사례 보고서 (월·목 단톡방) ─────────────────────────
// [[insights-not-reports]] 룰 적용: 검증→자가검토→인사이트. 송마망봇 화요일 보고와 같은 형식이되 카테고리는 UI/UX.
const UX_CATEGORIES = [
  '결제·체크아웃 (Shop Pay·Stripe·1탭 결제·passwordless)',
  '상품 페이지 (사회적 증거·image gallery·video-first PDP·micro-interaction)',
  '모바일 UX (sticky CTA·bottom sheet·인앱 브라우저 fallback·thumb zone)',
  '온보딩·회원전환 (post-purchase account·magic link·OAuth 1탭)',
  '장바구니 (persistent cart·optimistic UI·1-page checkout·empty state)',
  '신뢰 신호 (trust badges·review summary·shipping policy·return policy)',
  '리텐션 UX (윈백·D+N 후크·empty state engagement·notification design)',
  '검색·발견성 (search-as-you-type·filter UX·zero result design)',
];

// UX 권위 source RSS fetch — 학습 데이터 cutoff 우회용 fresh signal
// 실패해도 graceful — 빈 array 반환하고 Claude 학습 데이터만으로 fallback
async function fetchRecentUXArticles() {
  const sources = [
    { name: 'NN/g',          url: 'https://www.nngroup.com/feed/rss/' },
    { name: 'Baymard',       url: 'https://baymard.com/blog.atom' },
    { name: 'Built for Mars', url: 'https://builtformars.com/feed/' },
    { name: 'CXL',           url: 'https://cxl.com/blog/feed/' },
  ];
  const results = [];
  for (const src of sources) {
    try {
      const xml = await new Promise((resolve, reject) => {
        const u = new URL(src.url);
        const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'cx-report-bot/1.0' }, timeout: 10000 }, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      // RSS·Atom 둘 다 — 최근 3개 item·entry 추출
      const itemRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
      const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/;
      const linkRe = /<link[^>]*(?:href="([^"]+)"|>([^<]+)<\/link>)/;
      const descRe = /<(?:description|summary|content[^>]*)>(?:<!\[CDATA\[)?([\s\S]{0,400})/;
      const dateRe = /<(?:pubDate|published|updated)>([^<]+)/;
      let m, count = 0;
      while ((m = itemRe.exec(xml)) && count < 3) {
        const body = m[1];
        const t = (body.match(titleRe) || [])[1] || '';
        const l = (body.match(linkRe) || [])[1] || (body.match(linkRe) || [])[2] || '';
        const d = (body.match(descRe) || [])[1] || '';
        const date = (body.match(dateRe) || [])[1] || '';
        if (t.trim()) {
          results.push({
            source: src.name,
            title: t.trim().slice(0, 160),
            url: l.trim(),
            date: date.trim().slice(0, 24),
            summary: d.replace(/<[^>]+>/g, '').replace(/\]\]>/g, '').trim().slice(0, 280),
          });
          count++;
        }
      }
    } catch (e) {
      console.error(`[UX RSS ${src.name}] 실패:`, e.message);
    }
  }
  return results;
}

async function generateUXInsight(usedTechniques, feedback, metrics) {
  if (!CLAUDE_API_KEY) return null;
  const usedList = (usedTechniques || []).slice(-20).map(t => `- ${t.기법명} (${t.카테고리})`).join('\n');
  const feedbackBlock = feedback ? `\n\n[사용자 수정 요청 — 이번 회차 반드시 반영]\n${feedback}\n` : '';
  const metricsBlock = metrics ? `\n[이태리정미소 최신 실측 데이터 — 이번 보고서에 반드시 인용]\n${metrics}\n` : '';

  // 최근 권위 source 글 fetch — 학습 데이터 cutoff 우회
  const articles = await fetchRecentUXArticles();
  const articleBlock = articles.length > 0
    ? `\n[최근 권위 UX source 새 글 — 가능하면 인용 또는 영감으로 활용]\n${articles.map((a, i) => `${i+1}. "${a.title}" (${a.source}, ${a.date})\n   URL: ${a.url}\n   요약: ${a.summary}`).join('\n\n')}\n`
    : '';

  const prompt = `너는 이태리정미소(한국 프리미엄 식료품 D2C) CX 매니저야. UI/UX 개선 사례를 매주 월·목 2회 단톡방에 공유한다.${feedbackBlock}${metricsBlock}${articleBlock}

이번 보고서 1편을 작성해. 송마망봇 화요일 마케팅/심리학 기법 보고와 같은 형식 — 단 카테고리는 UI/UX 인터페이스 패턴 한정 (가격심리학·앵커링 X).

이미 다룬 기법 (중복 회피 필수):
${usedList || '(아직 없음)'}

[이태리정미소 자사몰 이미 반영/계획된 UX — 사례 선택 시 제외 필수]
- 카카오 채널 친구추가 + 자동 웰컴메시지 (배포 완료)
- GA4 모바일 버튼 클릭 트래킹 (상단 vs 하단 CTA 분석 인프라)
- 구매하기 옵션 바텀시트 (모바일 결제 마찰 감소, skin8 배포)
- Sticky CTA 3개 (바로구매·장바구니·선물하기, 모바일 thumb zone)
- 자사몰 폰트 통일 (디자인 토큰 시스템, 진행 중)
- 게스트 체크아웃 (카페24 기본 활성)
이미 로드맵 박힌 9개 액션 — 사례로 다시 surface 금지:
- 게스트→회원 후크 · 장바구니 데드 진단 · 인스타 인앱 fallback · 꿀동이 종료 시퀀스
- 상품 페이지 사회적 증거 · 신규 D+14 후크 · 휴면 윈백 · VIP 차별화 · 첫 주문 AOV 끌어올리기

위 패턴이 사례 후보로 등장하면 다른 카테고리/기법으로 자체적으로 교체. 면밀히 검토.

카테고리 풀:
${UX_CATEGORIES.map((c, i) => `${i+1}. ${c}`).join('\n')}

위 풀에서 카테고리 1개 골라 그 안의 구체적 기법 1개 선택.

[사례 선정 엄격 룰 — 위반 시 다시 작성]
1. 뻔한 클래식 회사 풀에서 자제 (이미 자주 인용됨): ASOS · Shop Pay · Amazon One-Click · Stripe Checkout · Booking.com · Glossier · Allbirds · Stitch Fix · Williams-Sonoma. 위 회사를 쓸 경우 *덜 알려진 실험·구체적 페이지·정량 데이터* 위주로 새 각도여야 함.
2. 한국 D2C/커머스 사례 적극 surface: 마뗑킴 · 생활공작소 · 해녀가깨 · 앤캐럿 · 이파리 · 논픽션 · 무신사 · 29CM · 마켓컬리 · 오늘의집 · 와디즈 · 윙잇 · 매스프레소 · 핏앤펑크 · 도서출판 사이드웨이 등. 한국 시장 행동 패턴(인앱 브라우저 · 카카오톡 · 토스/네이버페이) 구체 사례 우선.
3. 다른 vertical에서 *식료품에 변환* 강조: B2B SaaS(Linear·Notion·Figma) · 핀테크(토스·뱅크샐러드·Stripe Atlas) · 여행(Klook·트리플·마이리얼트립) · 교육(클래스101·코드잇·매스프레소) · 콘텐츠(왓챠·티빙·라프텔)의 UX 패턴이 식료품 D2C에 어떻게 작동하는지.
4. 학술·권위 source 인용 우선: Baymard Institute · Nielsen Norman Group · Built for Mars · Growth.Design · CXL ConversionXL · UX Research conference (CHI·UIST). 위 [최근 권위 source 새 글] 블록이 있으면 그 글 1개를 명시적으로 인용·참조.
5. 정량 데이터 필수: A/B test 결과·CVR·이탈률·LTV 등 숫자 동반. 출처 명시. 모르면 "검증 안 됨"으로 솔직히.
6. 이미 다룬 기법 (위 history) 반복 X. 각 카테고리 안에서 다른 패턴.

분량 가이드 (엄수): 전체 본문 약 1,500자(공백 포함, 구분선 제외). 단톡방용이라 짧고 정확하게. 각 섹션 압축.

형식 엄수 (5섹션):

[제목] 기법명 (영어 병기)

[정의] 2줄. 정확히 무엇을 의미하는지.

━━━━━━━━━━━━

[숨은 메커니즘] 작동 원리·인지부하·행동경제학 등. 4~5줄, 약 280자.

━━━━━━━━━━━━

[사례 1개 deep dive]
회사 1개 선택 (기성 클래식 또는 최신 실리콘밸리 — 어느 한 쪽). 두 사례 X.
- 회사명·국가·업종·연도 (1줄)
- 문제 상황 (1~2줄)
- 실행 (구체·UI 패턴 명시) (2~3줄)
- 결과 (정량·출처 명시) (1~2줄)
- 왜 작동했나 (1~2줄, 메커니즘 연결)
약 500자.

━━━━━━━━━━━━

[이태리정미소 변형 적용]
위 [최신 실측 데이터] 블록의 숫자를 1~2개 명시적으로 인용. 실행안 2~3개 + 각 임팩트 추정.
약 500자.

━━━━━━━━━━━━

[예상 누적 임팩트] 1~2줄. 정량.

규칙:
- 마크다운 기호(#, *, **) 사용 금지. 일반 텍스트.
- 이모지 사용 X (token 경계에서 잘리면 깨진 글자 ��로 표시됨). 텍스트로만.
- 사례 1개만. 두 회사·두 시대 비교 X (메시지 분산 방지).
- 숫자 출처 명시 (Baymard·NN Group·Shopify 공식·a16z report·논문 등)
- 가정·한계 솔직히 명시 (예: "한국 시장 검증 안 됨")
- 보고/체크리스트 형식 X — 패턴·메커니즘·사례·액션·임팩트 흐름
- 총 약 1,500자 한정. 한 섹션이라도 넘으면 다른 섹션 줄여서 균형 맞춤.`;

  try {
    const res = await postJson('api.anthropic.com', '/v1/messages',
      { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: CLAUDE_MODEL, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] });
    return res.content?.[0]?.text || null;
  } catch (e) { console.error('UX Claude 오류:', e.message); return null; }
}

async function uxDraftFlow() {
  const date = dateStr(0);
  const today = new Date();
  const dow = today.getDay(); // 0=Sun, 1=Mon, 4=Thu
  const dowKR = ['일', '월', '화', '수', '목', '금', '토'][dow];

  // 사용된 기법 목록 fetch (중복 회피)
  let history = [];
  try {
    const r = await postToAppsScript({ action: 'get_ux_history' }, APPS_SCRIPT_URL);
    if (r && r.ok) history = r.history || [];
  } catch (e) { console.error('[UX history] 실패:', e.message); }

  // 사용자 /UX 수정 feedback fetch + 자동 clear
  let feedback = '';
  try {
    const r = await postToAppsScript({ action: 'get_ux_feedback' }, APPS_SCRIPT_URL);
    if (r && r.ok && r.feedback) feedback = r.feedback;
  } catch (e) { console.error('[UX feedback] 실패:', e.message); }

  // 자사몰 최신 실측 데이터 fetch — Claude prompt에 inject. 일반 hardcode 대체.
  let metricsBlock = '';
  try {
    const yesterday = dateStr(1);
    const [dailyOrders, segments, ltv, clarity, ga4Daily, baselineRes] = await Promise.all([
      getCafe24DailyOrders(yesterday).catch(() => null),
      getCafe24CustomerSegments(yesterday, 365).catch(() => null),
      calculateLTVMetrics(yesterday).catch(() => null),
      getClarityData(1).catch(() => null),
      getGA4Daily(yesterday).catch(() => null),
      getDailyBaseline(7).catch(() => ({ baseline: {}, count: 0 })),
    ]);

    const lines = [];
    if (dailyOrders) lines.push(`어제 매출 ${formatMoney(dailyOrders.revenue)}·${dailyOrders.totalCount}건·AOV ${formatMoney(Math.round(dailyOrders.revenue/dailyOrders.totalCount))}`);
    if (segments) {
      const m = segments.member, g = segments.guest;
      const totalRev = (m?.newAmt||0)+(m?.retAmt||0)+(g?.newAmt||0)+(g?.repeatAmt||0);
      if (totalRev > 0) {
        const pct = v => (v/totalRev*100).toFixed(0);
        lines.push(`세그먼트 매출: 신규회원 ${pct(m.newAmt)}%·재방문 ${pct(m.retAmt)}%·게스트신규 ${pct(g.newAmt)}%·게스트반복 ${pct(g.repeatAmt)}%`);
      }
    }
    if (ltv) lines.push(`회원 LTV(365d): 총 ${ltv.회원_총수_365d}명·재구매율 ${ltv.회원_재구매율}%·신규 D+30 ${ltv.신규_D30_retention}%·휴면 91-180d ${ltv.휴면_91_180d}명·VIP top10% 매출 ${ltv.상위10_매출점유}%`);
    if (clarity) lines.push(`사이트: 인스타인앱 ${clarity.instagramPct}%·체류 ${clarity.activeTimeSec}초·스크롤 ${clarity.scrollDepth?.toFixed(0)}%`);
    if (ga4Daily?.checkoutFunnel) {
      const cf = ga4Daily.checkoutFunnel;
      const drop = cf.addToCart > 0 ? ((cf.addToCart - cf.beginCheckout)/cf.addToCart*100).toFixed(0) : 0;
      lines.push(`결제 funnel: 장바구니 ${cf.addToCart} → 결제진입 ${cf.beginCheckout} (이탈 ${drop}%)`);
    }
    if (baselineRes.count >= 3 && baselineRes.baseline?.카페24매출?.avg) {
      lines.push(`7일 평균 매출 baseline: ${formatMoney(Math.round(baselineRes.baseline.카페24매출.avg))} (n=${baselineRes.count})`);
    }
    // SKU top 3
    if (dailyOrders?.byProduct) {
      const top = Object.values(dailyOrders.byProduct).filter(p=>p.count>0).sort((a,b)=>b.amount-a.amount).slice(0,3);
      if (top.length) {
        const lines2 = top.map(p => `${PRODUCT_NAME[String(p.productNo)]||'SKU'}#${p.productNo} ${formatMoney(p.amount)}·${p.count}건`).join(' · ');
        lines.push(`상품 매출 top3: ${lines2}`);
      }
    }
    metricsBlock = lines.join('\n');
    console.log('[UX metrics inject]\n' + metricsBlock);
  } catch (e) { console.error('[UX metrics fetch] 실패:', e.message); }

  const insight = await generateUXInsight(history, feedback, metricsBlock);
  if (!insight) { console.error('UX 초안 생성 실패 — 종료'); return; }

  // 제목 추출 (robust — [제목] 패턴 우선, 못 찾으면 첫 줄)
  const titleMatch = insight.match(/\[제목\]\s*(.+)/);
  const technique = (titleMatch
    ? titleMatch[1]
    : (insight.split('\n').find(l => l.trim()) || '제목 추출 실패')
  ).trim().slice(0, 120);

  // 시트 저장 (상태: sent — 컨펌 단계 없는 자동 발송. 케이스북에 바로 등재)
  await postToAppsScript({
    action: 'save_ux_draft',
    date, dow: dowKR, technique,
    body: insight,
    status: 'sent',
  }, APPS_SCRIPT_URL);

  // 단톡방 자동 발송 (월·목, 컨펌 없이 바로). 사용자가 /UX 발송 안 눌러도 됨.
  const groupMsg = `📚 <b>UX 사례 — ${escapeHtml(technique)}</b>\n\n${escapeHtml(insight)}`;
  await sendTelegramChunked(groupMsg, true);
  console.log(`[UX auto-send] ${date} ${dowKR} ${technique} → 단톡방 직접 발송 + 시트 sent`);
}

async function uxSendFlow() {
  // 대기 중 초안 fetch + 단톡방 발송 + mark sent
  let draft = null;
  try {
    const r = await postToAppsScript({ action: 'get_ux_pending' }, APPS_SCRIPT_URL);
    if (r && r.ok && r.draft) draft = r.draft;
  } catch (e) { console.error('[UX pending] 실패:', e.message); return; }

  if (!draft) { console.log('대기 중 UX 초안 없음'); return; }

  const groupMsg = `📚 <b>UX 사례 — ${escapeHtml(draft.technique)}</b>\n\n${escapeHtml(draft.body)}`;
  const r = await sendTelegramChunked(groupMsg, true);
  if (r && r.ok) {
    await postToAppsScript({ action: 'mark_ux_sent', date: draft.date }, APPS_SCRIPT_URL);
    console.log(`[UX send] ${draft.date} ${draft.technique} → 단톡방 발송 완료`);
  } else {
    console.error('UX 단톡방 발송 실패:', JSON.stringify(r));
  }
}

// 공구·콜라보 일정 — 메모리 [[gongu-schedule]] 단일 진실 소스. 새 공구 들어오면 여기 갱신.
const PROMO_SCHEDULE = [
  { title: '꿀동이 공구 (바질 #87)',      productNo: '87', start: '2026-05-25', end: '2026-05-31' },
  { title: '찬밥 공구 (바질 #51)',         productNo: '51', start: '2026-06-04', end: '2026-06-10' },
  { title: '유나레시피 공구 (엘가팬 #60)', productNo: '60', start: '2026-06-11', end: '2026-06-14' },
  { title: '유나레시피 공구 (클래식 바질 #88)', productNo: '88', start: '2026-07-08', end: '2026-07-11' },
];

// 활성·예정 공구 목록 (오늘 기준 진행 중 또는 30일 이내 시작 예정)
function getActivePromos() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const out = [];
  PROMO_SCHEDULE.forEach(p => {
    const startD = new Date(p.start + 'T00:00:00');
    const endD = new Date(p.end + 'T00:00:00');
    const dToStart = Math.ceil((startD - t0) / 86400000);
    const dToEnd = Math.ceil((endD - t0) / 86400000);
    if (dToEnd < 0) return; // 종료된 공구
    if (dToStart > 30) return; // 30일 이상 미래 제외
    let dDay;
    if (dToStart > 0) dDay = `시작 D-${dToStart} (${p.start})`;
    else if (dToEnd > 0) dDay = `종료 D-${dToEnd} (~${p.end})`;
    else dDay = `오늘 종료 (${p.end})`;
    out.push({ ...p, dToStart, dToEnd, dDay, active: dToStart <= 0 && dToEnd >= 0 });
  });
  // 활성 먼저, 그 다음 가까운 예정 순
  return out.sort((a, b) => (b.active - a.active) || (a.dToStart - b.dToStart));
}

// 이전 GCal 호출 함수는 안 쓰지만 외부 export 호환 위해 빈 함수로 유지
async function getKkulDongYiSchedule() { return null; }

// Clarity URL별 페이지 데이터 (DeadClick + Quickback + ScrollDepth) — 1회 호출로 다 받음
// 결제 흐름·상품 페이지·자동 마찰 진단 모두 이 한 번의 응답에서 분기
async function getClarityPageStats(daysBack = 1) {
  try {
    const url = `https://www.clarity.ms/export-data/api/v1/project-live-insights?projectId=${CLARITY_PROJECT_ID}&numOfDays=${daysBack}&dimension1=URL`;
    const data = await fetchJson(url, { 'Authorization': `Bearer ${clarityToken}` });
    if (!Array.isArray(data)) return null;
    const pick = (n) => data.find(m => m.metricName === n);
    const dead = pick('DeadClickCount')?.information || [];
    const quick = pick('QuickbackClick')?.information || [];
    const scroll = pick('ScrollDepth')?.information || [];
    const norm = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
    const byUrl = {};
    const upsert = (raw, sessions) => {
      const u = norm(raw); if (!u) return null;
      if (!byUrl[u]) byUrl[u] = { url: u, sessions };
      else if (sessions > byUrl[u].sessions) byUrl[u].sessions = sessions;
      return byUrl[u];
    };
    dead.forEach(x => { const o = upsert(x.URL || x.url || x.name, parseInt(x.sessionsCount || 0)); if (o) o.dead = x.sessionsWithMetricPercentage || 0; });
    quick.forEach(x => { const o = upsert(x.URL || x.url || x.name, parseInt(x.sessionsCount || 0)); if (o) o.quick = x.sessionsWithMetricPercentage || 0; });
    scroll.forEach(x => { const o = upsert(x.URL || x.url || x.name, parseInt(x.sessionsCount || 0)); if (o) o.scroll = x.averageScrollDepth || 0; });
    const all = Object.values(byUrl);
    // 자동 마찰(결제·상품 페이지 제외 = 그 외 페이지에서 폭증한 것): 데드 ≥10% 또는 뒤로 ≥50%, 세션 10+
    const isCheckout = (u) => /\/(order\/basket|order\/orderform|member\/login)/.test(u);
    const isProduct = (u) => /(product_no=|surl\/p\/)/.test(u);
    const friction = all.filter(x => x.sessions >= 10 && !isCheckout(x.url) && !isProduct(x.url) && ((x.dead || 0) >= 10 || (x.quick || 0) >= 50))
      .sort((a, b) => ((b.dead || 0) + (b.quick || 0) * 0.3) - ((a.dead || 0) + (a.quick || 0) * 0.3))
      .slice(0, 1);
    return { byUrl, friction };
  } catch (e) { console.error('[Clarity 페이지 데이터 오류]', e.message); return null; }
}

// 결제 흐름 3페이지 + 상품 페이지(매출 top SKU) Clarity 데이터 조회 헬퍼
function pickClarityPage(byUrl, predicate) {
  if (!byUrl) return null;
  const matches = Object.values(byUrl).filter(predicate);
  if (!matches.length) return null;
  return matches.sort((a, b) => b.sessions - a.sessions)[0];
}

// ── Claude 분석 ────────────────────────────────────────
async function getClaudeAnalysis(mode, data) {
  const { meta, cafe24, clarity, ga4, ga4Daily, dailyOrders, reviews, repurchase, segments, restock, voc, songmamans, adAudit, baseline, baselineN, pageStats, memos, promos } = data;
  const f = clarity?.funnel;

  let prompt;
  if (mode === 'daily') {
    const cafeMain = cafe24?.byProduct?.['83'] || {amount:0,count:0};
    const cafeOthers = cafe24 ? Object.entries(cafe24.byProduct||{}).filter(([k])=>k!=='83').reduce((s,[,v])=>({amount:s.amount+v.amount, count:s.count+v.count}), {amount:0,count:0}) : {amount:0,count:0};
    const seg = segments || {};
    const m = seg.member || {newCount:0,retCount:0,newAmt:0,retAmt:0};
    const g = seg.guest || {newCount:0,repeatCount:0,newAmt:0,repeatAmt:0};
    const trafficLine = ga4Daily?.channels?.length
      ? ga4Daily.channels.slice(0,5).map(c=>`${c.name} ${c.sessions}세션`).join(' / ')
      : '-';

    const songCtx = (() => {
      if (!songmamans) return '(미수집)';
      const acts = (songmamans.openActions || []).slice(0, 5).map(a => `- ${a.id} [${a.owner}] ${a.content} (마감 ${a.due || '-'}, ${a.status})`).join('\n') || '없음';
      const decs = (songmamans.recentDecisions || []).slice(-3).map(d => `- ${d.date} ${d.topic} → ${d.decision} [${d.status}]`).join('\n') || '없음';
      const raw = (songmamans.recentRaw || []).slice(-5).map(r => `- ${r[0]} ${r[1]}: ${String(r[2]||'').slice(0,60)}`).join('\n') || '없음';
      const tg = songmamans.tgMessages && songmamans.tgMessages.length
        ? songmamans.tgMessages.join('\n')
        : '(미수집)';
      const botSummary = songmamans.tgBotSummary ? `봇 발화: ${songmamans.tgBotSummary}` : '';
      return `[열린 액션]\n${acts}\n[최근 결정]\n${decs}\n[RAW 시트 최근]\n${raw}\n[단톡방 직접 (사람 메시지 최근 30건)]\n${tg}\n${botSummary}`;
    })();

    prompt = `너는 이태리정미소 CX 관리자야. 송마망봇이 매일 통합 발송하는 영역(매출·메타광고·VOC수집·재입고알림·재고경보)은 분석·🚨 X. 너는 (1) 사이트 행동·결제퍼널 (Clarity·GA4) (2) 리텐션 (Cafe24 raw 세그먼트) (3) 상품별 매출 분포 — **이 세 축만** 1차 분석 대상.

재입고·VOC·광고URL 데이터는 컨텍스트로 인식하되 그것만으로 🚨 띄우지 마. CX·리텐션·상품믹스 통찰과 결합될 때(예: 게스트 비중↑ + 재입고 대기↑ → 회원전환 후크)만 결합해서 한 신호로 다뤄.

송마망 회의록 컨텍스트는 인식만 하고 메시지에 출력 X. 단, 신호 판단할 때 "오늘 회사 분위기·진행중인 일"을 알고 행동 제안에 반영해.

[사이트 — Microsoft Clarity]
- 세션 ${clarity?.totalSessions||'-'} / 스크립트에러 ${clarity?.scriptErrorPct?.toFixed(1)||'-'}% / 빠른뒤로 ${clarity?.quickbackPct?.toFixed(1)||'-'}%
- 데드클릭 ${clarity?.deadClickPct?.toFixed(1)||'-'}% (정상 10↓) / 레이지클릭 ${clarity?.rageClickPct?.toFixed(2)||'-'}% (정상 2↓)
- 인스타 인앱 ${clarity?.instagramPct||'-'}% (트래픽 비중. 50↑면 인앱 노이즈가 ScriptError 부풀림)
- 체류 ${clarity?.activeTimeSec||'-'}초 / 스크롤 ${clarity?.scrollDepth?.toFixed(0)||'-'}%
- 결제 페이지 ${clarity?.funnel?.checkout||0}세션 / 장바구니 ${clarity?.funnel?.cart||0}
- (Clarity 한도 시) GA4 트래픽: ${trafficLine}

[Clarity 해석 가이드 — 매우 중요. 노이즈는 🚨 X]
- ScriptError와 Quickback은 인스타 인앱브라우저·픽셀·서드파티가 늘 뱉는 비차단 노이즈가 큼. 단독 수치만 보고 🚨 띄우지 마.
- 진짜 사이트 막힘은 **데드클릭과 레이지클릭이 같이 임계 초과**할 때만. 둘 다 정상이면 ScriptError 50%·Quickback 15%여도 막힘 아님(노이즈).
- 인스타 인앱 50%↑이면 ScriptError가 자연히 30~50% 범위 나옴(못 고치는 환경). 임계치 10% 기계적 적용 금지.

[매출·주문 — Cafe24 실데이터 (네이버페이/톡 포함 100%)]
- 매출 ${formatMoney(dailyOrders?.revenue||0)} / 주문 ${dailyOrders?.totalCount||0}건 (결제 ${dailyOrders?.paidCount||0} · 취소 ${dailyOrders?.canceledCount||0})
- 유입경로: ${(dailyOrders?.channels||[]).map(c=>`${c.name} ${c.count}`).join(' · ')||'-'}
※ 유입경로는 "주문이 일어난 곳"(자사몰/네이버페이/카카오)이지 광고소재별 추적 아님.

[사이트 장바구니 이탈 — GA4 (참고용, 외부결제 미포함)]
- 장바구니 ${ga4Daily?.checkoutFunnel?.addToCart||0} → 결제진입 ${ga4Daily?.checkoutFunnel?.beginCheckout||0}(${ga4Daily?.checkoutFunnel?.cartToCheckoutPct??'-'}%)
※ ⚠️ GA4 결제진입 이탈은 네이버페이·톡 등 외부결제가 begin_checkout 이벤트 안 쏴서 항상 과소집계됨(어제 cafe24 실주문 85건 vs GA4 결제진입 27 같은 구조). **GA4 이탈% 단독으로는 🚨 절대 X.** 결제 마찰은 아래 Clarity 마찰 페이지로만 판단.

[메타 광고 URL 검증]
- ACTIVE ${adAudit?.total||'-'}개 중 정상 ${adAudit?.healthy||'-'}개 / 진짜 깨짐 ${adAudit?.broken?.length||0}개 / 비표준(작동 OK·UTM 없음) ${adAudit?.nonStandard?.length||0}개
${adAudit?.broken?.length ? adAudit.broken.slice(0,3).map(a=>`- ${a.name}: ${a.reason}`).join('\n') : '- 모두 정상'}
※ broken은 %20·공백·여러 URL 합침 같은 진짜 깨진 것만. broken이 3개 미만이거나 전체의 10% 미만이면 노이즈 수준이라 🚨 X (그냥 해당 광고만 미주에게 핸드오프 메모). nonStandard는 작동하는 표준 상품URL이라 🚨 절대 X(UTM 보강은 측정 갭, 별개 이슈).

[리텐션 — Cafe24 raw 기준, OKR "재구매자 300명"]
- 어제 주문 ${seg.totalOrders||0}건 / 매출 ${formatMoney(seg.totalAmt||0)}
- 회원 ${m.newCount+m.retCount}건 → 신규 ${m.newCount} / 재방문 ${m.retCount} (재방문률 ${(m.newCount+m.retCount)>0?((m.retCount/(m.newCount+m.retCount))*100).toFixed(1):0}%)
- 게스트 ${g.newCount+g.repeatCount}건 → 신규 ${g.newCount} / 반복 ${g.repeatCount}
- CRM 고객목록 매칭 게스트: ${seg.crmMatchedGuests ?? '-'}/${seg.guestPhones?.length || 0}
※ GA4 ecommercePurchases는 카페24 실주문의 15%만 잡혀 측정 신뢰 X — 무조건 위 Cafe24 raw 사용.

[상품별 매출 분포 — 카페24 자사몰, 매출순 top 6 (#83 포함)]
${(() => {
  if (!cafe24 || !cafe24.byProduct) return '- 데이터 없음';
  const all = Object.values(cafe24.byProduct).filter(v => v.count > 0).sort((a, b) => b.amount - a.amount).slice(0, 6);
  if (!all.length) return '- 데이터 없음';
  return all.map(p => {
    const nm = PRODUCT_NAME[String(p.productNo)] || p.name || `#${p.productNo}`;
    return `- ${nm}: ${formatMoney(p.amount)}·${p.count}건`;
  }).join('\n');
})()}
※ #83이 메인이나 다른 SKU 매출 비중·CVR이 의미있는 신호. 단순 합계가 아니라 분포 변화에 주목.

[바질페스토 재입고알림 — CRM 시트]
- 오늘 +${restock?.todayCount||0}건 / 누적 ${restock?.totalCount||0}건 / 대기 ${restock?.pendingCount||0}건
- 이번달 ${restock?.thisMonthCount||0} vs 지난달 ${restock?.lastMonthCount||0} (${restock?.paceVsLastMonth?.toFixed(2)||'-'}배 페이스)
※ 대기 누적이 높고 발송 갱신 안 되면 LTV 누수 신호. 솔라피 실제 발송 확인은 미주 영역.

[부정/중립 VOC — CRM 시트 (어제+오늘)]
${voc && voc.negCount > 0 ? voc.items.map(i=>`- ${i.cls} ${i.rating} ${i.product}: "${i.excerpt}"`).join('\n') : '- 없음 (긍정만 ' + (voc?.totalToday||0) + '건)'}

[직전 7일 평균 대비 어제 (자동 폭증 감지 — 진짜 신호용)]
${(() => {
  if (!baseline || !baselineN) return '- 데이터 부족 (스냅샷 누적 시작 단계, 7일 모이면 자동 비교)';
  const findP = (pno) => pickClarityPage(pageStats?.byUrl, v => v.url.includes(`product_no=${pno}`) || v.url.includes(`/surl/p/${pno}`));
  const findCO = (prefix) => pickClarityPage(pageStats?.byUrl, v => v.url.startsWith(prefix));
  const today = {
    '카페24매출': dailyOrders?.revenue || 0,
    '회원_재방문': segments?.member?.retCount || 0,
    '게스트_신규': segments?.guest?.newCount || 0,
    '사이트_스크립트에러': clarity?.scriptErrorPct || 0,
    '사이트_데드': clarity?.deadClickPct || 0,
    '사이트_레이지': clarity?.rageClickPct || 0,
    '결제_장바구니_데드': findCO('/order/basket')?.dead || 0,
    '결제_장바구니_뒤로': findCO('/order/basket')?.quick || 0,
    '결제_결제폼_데드': findCO('/order/orderform')?.dead || 0,
    '제품87_스크롤': findP('87')?.scroll || 0,
    '제품87_뒤로': findP('87')?.quick || 0,
  };
  const lines = [];
  Object.entries(today).forEach(([k, v]) => {
    const b = baseline[k];
    if (!b || b.n < 3) return; // 비교 표본 3일 미만이면 스킵
    const diff = v - b.avg;
    const pct = b.avg !== 0 ? Math.abs(diff / b.avg * 100) : 0;
    // 폭증/폭락 기준: 절대치 +5%p 이상이거나 +30% 상대변화
    if (Math.abs(diff) >= 5 || pct >= 30) {
      const arrow = diff > 0 ? '↑' : '↓';
      lines.push(`- ${k}: 어제 ${v.toFixed(1)} vs 7일평균 ${b.avg.toFixed(1)} ${arrow} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`);
    }
  });
  return lines.length ? lines.join('\n') + '\n※ 위 폭증·폭락이 진짜 신호. 일상 노이즈와 구분해서 다뤄.' : '- 7일 평균 대비 큰 변화 없음 (정상 범위)';
})()}

[활성·예정 공구 일정 — 종료 D-3 이내면 대기열 #4(꿀동이 종료 시퀀스) 트리거 강함]
${promos && promos.length ? promos.map(p => `- ${p.title}: ${p.dDay}${p.active ? ' [진행 중]' : ''}`).join('\n') : '- 진행/예정 공구 없음'}

[Jung 현재 진행 중 메모 — CX 대기열 surface 결정 시 참고. 메모에 항목 키워드 들어있으면 그 항목 surface X]
${memos && memos.length ? memos.map(m => `- ${m.text}`).join('\n') : '- 없음'}

[CX 개선 대기열 — Jung 영역, 진행 시 매출 직결. 어제 데이터와 맞물리는 1개만 surface]
1. **게스트→회원 후크** — 주문완료 페이지에 즉시 5천원 쿠폰 + 카카오 채널 친구추가. 사례 정육각·Graza. 예상 +50만원/월. 트리거: 게스트 비중 50%↑ 또는 재방문률 5%↓
2. **장바구니 페이지 데드클릭 진단·수정** — Clarity 세션 5개 보고 막힘 위치 찾기. 사례 Stripe Checkout·Patagonia. 예상 +12~16만원/일. 트리거: /order/basket 데드 10%↑ 또는 뒤로 50%↑
3. **인스타 인앱→사파리 fallback 배너** — 인앱 감지 시 상단 1줄 "더 빠른 결제: 사파리에서 열기". 사례 Liquid Death·Allbirds. 예상 +5만원/일. 트리거: 인스타 인앱 50%↑
4. **꿀동이 공구 종료 시퀀스** — 구매자 → 정가 SKU 5% off 솔라피 시퀀스. 사례 Olipop. 예상 +90만원/일 (종료 후). 트리거: 꿀동이 매출 비중 50%↑ 또는 공구 종료 D-7 이내
5. **상품 페이지 사회적 증거+퍼스트뷰** — 위 fold에 "320명 구매·평균 4.6점" + 컨셉샷. 사례 Notion·마뗑킴. 예상 +8만원/일. 트리거: 상품페이지 스크롤 50%↓ 또는 뒤로 30%↑

※ 위 5개 중 어제 신호와 직결되는 것이 있으면 액션을 **"[항목명] 빌드 시작 — [구체 위치/단계]"** 형태로 그날 1순위 신호의 액션으로 surface. 직결 안 되면 surface X.
※ 진행 중·완료 표시: 사용자가 '/메모 게스트 후크 진행 중' 같이 메모 등록하면 그 항목은 매일 다시 surface 안 됨 (메모 본문에 항목명 들어있는지로 판단).
※ 송마망봇 영역(공구 결정·SKU 운영·메타광고 직접수정·솔라피 발송·통합매출) 신호는 단독 🚨 X. 우리 봇은 Jung이 직접 자사몰에서 손댈 수 있는 액션만 줘.

[송마망 회의록 — 인식만, 출력 X]
${songCtx}

판단 기준:
- 즉시 행동 필요한가 (yes만 신호로 만듦)
- 5축 중 하나라도 임계 초과·역전·정체면 신호
- 회의록의 "오늘 진행중 액션·최근 결정"을 알고, 신호 발견 시 그 액션이 영향 주는지 명시
- "데이터 미수집"은 신호 X
- 게스트 비중 60%↑면 식별·전환 신호 가치 있음

신호 형식 (있는 만큼만, 최대 3개. 진짜 신호 없으면 1개 또는 ✅ 한 줄로 끝):
🚨 <한 줄 진단 — 항목·핵심수치만, 30자 이내>
근거: <수치 2~3개 콤마 구분, 50자 이내>
액션: <담당자(Jung/경태/소망 중 하나)> · <기한(오늘/이번주)> · <구체 행동 한 가지>

[담당자 배정 룰 — 매우 중요. 정확히 지킬 것]
- **Jung**: 자사몰 UI 수정(상세페이지·결제·주문완료·이메일/팝업 템플릿·테마 코드), CX 행동 분석, 디자인/마케팅 콘텐츠 제작. 자사몰 안에서 손대는 건 전부 Jung.
- **경태**: CRM 시트, CS 응대, 쿠팡/네이버 채널 운영, 재입고알림 시트 발송 추적.
- **소망**: 시딩 인플루언서 팔로우업, 쓰레드 발행.
- ❌ **미주에게 액션 절대 배정 X.** 미주 영역(메타광고 수정·솔라피 알림톡·사입품질·통합매출·VOC·재입고·OAuth)은 송마망봇이 매일 통합 발송하므로 우리 봇은 액션 X. 미주 이름 자체를 액션에 쓰지 마.
- 자사몰 UI 수정처럼 보이는 액션이면 무조건 Jung. "회원가입 후크 삽입"·"상세페이지 수정"·"주문완료 페이지" 같은 건 전부 Jung.

모두 정상이면 한 줄: ✅ 특이사항 없음 — <오늘 본업 한 줄>

규칙:
- **신호 갯수 채우려고 노이즈 만들지 마.** 진짜 행동이 필요한 것만. 0~3개 사이 자유.
- 신호당 최대 3줄. 장황한 맥락 설명 금지. 회의록 컨텍스트는 액션의 담당자·기한 결정에만 활용.
- 액션은 반드시 행동 가능한 한 가지로 압축. "검토 필요"·"확인 필요" 같은 모호한 말 X.
- **GA4 결제이탈%는 외부결제 미포함이라 단독 🚨 절대 X.** Clarity 마찰페이지(데드/뒤로)가 같이 높을 때만 결제 마찰 신호.
- ScriptError·Quickback 단독 🚨 X. DeadClick·RageClick 같이 임계 초과일 때만.
- **마크다운/구분선 절대 금지**: #, *, **, ---, ===, >, 어떤 구분선도 X. 신호 사이는 빈 줄 1개로만 구분. 일반 텍스트만.
- 도입부 멘트("확인했어요"·"분석합니다"·요약 줄) X. 바로 첫 신호 🚨로 시작.`;
  } else {
    prompt = `너는 이태리정미소(프리미엄 이탈리안 식품 쇼핑몰) CX 분석가야.
이번 주 데이터를 분석하고 세 파트로 답해줘.

[이번 주 데이터]
- 메타 ROAS: ${meta.roas}% / 광고비: ${formatMoney(meta.spend)} / 구매: ${meta.purchases}건
- 스크립트 에러: ${clarity?.scriptErrorPct?.toFixed(1)||'-'}% (기준: 5% 이하)
- 빠른 뒤로가기: ${clarity?.quickbackPct?.toFixed(1)||'-'}% (기준: 8% 이하)
- 스크롤 깊이: ${clarity?.scrollDepth?.toFixed(0)||'-'}% (기준: 50% 이상)
- 활성 체류: ${clarity?.activeTimeSec||'-'}초
- 인스타 인앱: ${clarity?.instagramPct||'-'}%
- 구매 퍼널: 랜딩 ${f?.landing||0}명 → 상품 ${f?.product||0}명(${pct(f?.product,f?.landing)}) → 장바구니 ${f?.cart||0}명(${pct(f?.cart,f?.landing)}) → 구매하기 ${f?.checkout||0}명(${pct(f?.checkout,f?.landing)})
- GA4 구매전환율(ecommercePurchases): 신규 ${pct(ga4?.userType?.cur?.new?.conv, ga4?.userType?.cur?.new?.sessions)} / 재방문 ${pct(ga4?.userType?.cur?.ret?.conv, ga4?.userType?.cur?.ret?.sessions)} (재방문이 신규보다 현저히 높으면 리텐션 전략 ROI 시그널)
- 재구매(회원·90일): 재구매율 ${repurchase?.repurchaseRate?.toFixed(1)||'-'}% (재구매 ${repurchase?.repeatMembers||0}/${repurchase?.distinctMembers||0}명), 평균 ${repurchase?.avgDaysToRepeat??'-'}일 만에 재구매 / 이번주 재구매 매출비중 ${repurchase?.week?.repShare?.toFixed(0)||'-'}% (회사 OKR: 바질 재구매자 300명)
- 상품별 페이지 성과(top 5, GA4 product_no 기준): ${(ga4?.topProducts||[]).map(p=>`#${p.id} ${p.sessions}세션·구매 ${p.purchases}(CVR ${pct(p.purchases,p.sessions)})`).join(' / ')||'없음'}
${reviews ? `\n[이번 주 리뷰 ${reviews.count}건 / 평균 ${reviews.avg}점]\n${reviews.texts}` : ''}

== 파트 1: 반드시 이번 주 홈페이지에 적용할 것 ==
수치 근거 포함, 구체적인 실행 방법, 난이도 표시 (쉬움/보통/어려움), 최대 3개

== 파트 2: 고객 리뷰 인사이트 ==
${reviews ? `이번 주 리뷰 ${reviews.count}건 기준, 반복 칭찬 키워드와 불만·개선 요청 키워드를 각각 추출하고, 즉각 대응이 필요한 리뷰가 있으면 알려줘.` : '리뷰 데이터 없음.'}

== 파트 3: 중장기 개선사항 ==
데이터 기반 방향성 제안, 최대 2개

답변은 한국어로, 각 항목은 번호 매겨서.
중요: 마크다운 기호(#, *, **, ---, >) 절대 사용하지 마. 일반 텍스트로만.`;
  }

  try {
    const res = await postJson('api.anthropic.com', '/v1/messages', { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' }, { model: CLAUDE_MODEL, max_tokens: 1000, messages: [{ role:'user', content: prompt }] });
    return res.content?.[0]?.text || null;
  } catch(e) { console.error('Claude 오류:', e.message); return null; }
}

// ── CX 관리자 분석 (개인 DM용) ─────────────────────────
async function getCXManagerAnalysis(data) {
  if (!CLAUDE_API_KEY) return null;
  const { activities, dailyMessages, clarity, ga4Daily, dailyOrders, segments, voc, restock, adAudit } = data;

  const activitiesText = activities && activities.length
    ? activities.slice(-15).map(a => `[${a.id} ${a.status}] ${a.content}`).join('\n')
    : '(기록된 작업 없음)';

  const chatText = dailyMessages && dailyMessages.length
    ? dailyMessages.filter(m => !m.isBot).slice(-30).map(m => `${m.time} ${m.sender}: ${m.text}`).join('\n').slice(0, 3000)
    : '(단톡방 메시지 없음)';

  const cf = ga4Daily?.checkoutFunnel;
  const signals = [
    `매출(Cafe24): ${formatMoney(dailyOrders?.revenue||0)} / 주문 ${dailyOrders?.totalCount||0}건 (결제 ${dailyOrders?.paidCount||0}·취소 ${dailyOrders?.canceledCount||0})`,
    `유입경로(Cafe24): ${(dailyOrders?.channels||[]).map(c=>`${c.name} ${c.count}`).join(' · ') || '-'}`,
    `Clarity: ${clarity ? '정상' : '한도초과'}`,
    `GA4 트래픽: ${ga4Daily?.channels?.slice(0,3).map(c=>`${c.name} ${c.sessions}`).join(' / ') || '-'}`,
    cf ? `사이트 이탈(GA4 참고): 장바구니 ${cf.addToCart} → 결제진입 ${cf.beginCheckout}(${cf.cartToCheckoutPct||'-'}%) ※GA4 구매는 외부결제 미포함이라 매출은 위 Cafe24만 신뢰` : '',
    segments?.totalOrders ? `리텐션: 회원 ${segments.member.newCount+segments.member.retCount}건 (재방문 ${segments.member.retCount}) / 게스트 ${segments.guest.newCount+segments.guest.repeatCount}건` : '리텐션: 미수집',
    `부정 VOC: ${voc?.negCount || 0}건`,
    `재입고: 누적 ${restock?.totalCount||'-'}건 / 대기 ${restock?.pendingCount||'-'}건`,
    `광고 URL 깨짐: ${adAudit?.broken?.length||0}/${adAudit?.total||0}`,
  ].join('\n');

  const facts = `[OKR] 바질 재구매자 Q2 100명/Q4 300명(현 40) · 자사몰 비중 목표 40%(현 29.6%) · ROAS Guardrail 350%+(현 375%)
[CX 6축] 사이트 막힘·결제 누수·재방문·게스트→회원 전환·SKU ROI·수요/VOC
[은우] CX 책임자. 보고보다 판단 선호, 간결한 답 원함.`;

  const prompt = `너는 은우(이태리정미소 CX 책임자)의 CX 어시스턴트야.
어제~24h의 데이터·은우 작업·단톡방을 보고, 오늘 은우가 알면 좋을 핵심만 추려.

${facts}

[데이터 신호 (어제)]
${signals}

[은우 작업 (24h)]
${activitiesText}

[단톡방 (24h)]
${chatText}

요청:
- 데이터+작업+단톡방 연결해서 오늘 우선 봐야 할 것 1~2개
- 측정 공백/무시된 신호 있으면 지적
- 단톡방 결정 중 은우 작업과 연관된 것 있으면 연결

5줄 이내, 마크다운 X, 짧은 문단으로.`;

  try {
    const res = await postJson('api.anthropic.com', '/v1/messages',
      { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: CLAUDE_MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
    return res.content?.[0]?.text || null;
  } catch(e) { console.error('CX 분석 오류:', e.message); return null; }
}

// ── 결제 전환 액션 (데이터 → 오늘 할 일 1개) ──────────────
// 신뢰 가능한 신호로 우선순위 액션 1개를 정함. 정밀 결제단계는 결제슉 대시보드 보완.
function buildPaymentAction({ dailyOrders, ga4Daily, adAudit, segments }) {
  const cf = ga4Daily && ga4Daily.checkoutFunnel;
  // 1순위: 광고 URL 깨짐 = 유입 오염 → 전환 논하기 전에 광고부터
  if (adAudit && adAudit.total > 0 && adAudit.broken && adAudit.broken.length / adAudit.total > 0.3) {
    return `👉 <b>액션:</b> 광고 URL ${adAudit.broken.length}/${adAudit.total}개 깨짐 먼저 정상화 — 유입이 오염되면 전환은 못 믿어요. 광고관리자에서 깨진 URL 교체/일시중지.`;
  }
  // 2순위: 결제진입 이탈 큼 → 결제슉에서 정밀 확인 후 디자인 1개
  if (cf && cf.addToCart > 0 && cf.beginCheckout / cf.addToCart < 0.6) {
    const dropPct = Math.round((1 - cf.beginCheckout / cf.addToCart) * 100);
    return `👉 <b>액션:</b> 장바구니→결제진입 ${dropPct}% 이탈. 결제슉 대시보드에서 방문→클릭→완료 중 가장 큰 이탈 단계 1개 골라 디자인 수정.`;
  }
  // 3순위: 게스트 비중 높음 → 회원전환 누수
  if (segments && segments.totalOrders > 0) {
    const g = segments.guest, total = segments.totalOrders;
    const guestShare = (g.newCount + g.repeatCount) / total;
    if (guestShare > 0.4) {
      return `👉 <b>액션:</b> 게스트 비중 ${Math.round(guestShare * 100)}%. 결제완료 화면에 회원가입 유도(쿠폰) 노출돼 있는지 점검 — 재구매 LTV 누수.`;
    }
  }
  return `👉 <b>액션:</b> 전환 신호 안정. 결제슉 대시보드로 결제페이지 이탈(방문→클릭→완료)을 주 1회 점검하며 큰 이탈 단계 1개씩 개선.`;
}

// ── 데이터 자가점검 (발송 전 검증, 이상 시 리포트에 표시) ──────
// 목적: 데이터 소스가 조용히 실패(null·0)하거나 숫자가 안 맞을 때 사람이 아니라 봇이 먼저 잡는다.
function buildDataHealthWarnings(d) {
  const w = [];
  const { dailyOrders, cafe24, segments, ga4Daily, clarity, analysis, cxManagerAnalysis, restock, voc, adAudit, ltv, songmamansSales, meta, promos, reportDate } = d;
  const asOf = reportDate || dateStr(1);

  // ① 송마망봇 ↔ 은우봇 매출 교차 (메시지 잡혔을 때만)
  if (songmamansSales && dailyOrders && dailyOrders.revenue > 0) {
    const diff = Math.abs(dailyOrders.revenue - songmamansSales);
    const diffPct = diff / songmamansSales * 100;
    if (diffPct > 5) w.push(`🚨 매출 교차 ${diffPct.toFixed(1)}% 차이 (은우 ${formatMoney(dailyOrders.revenue)} vs 송마망 ${formatMoney(songmamansSales)})`);
    else if (diffPct > 1) w.push(`매출 교차 ${diffPct.toFixed(1)}% 차이 — cutoff·취소 처리 의심`);
  }
  // ② AOV 자체 검증
  if (dailyOrders && dailyOrders.totalCount > 0 && dailyOrders.revenue > 0) {
    const expected = Math.round(dailyOrders.revenue / dailyOrders.totalCount);
    if (dailyOrders.aov && Math.abs(expected - dailyOrders.aov) > 100) {
      w.push(`AOV 계산 불일치: 매출/주문=${expected.toLocaleString()} vs 보고 AOV ${dailyOrders.aov.toLocaleString()}`);
    }
  }
  // ③ 세그먼트 합계 = 전체 매출
  if (segments && dailyOrders && dailyOrders.revenue > 0) {
    const segSum = (segments.member?.newAmt || 0) + (segments.member?.retAmt || 0) + (segments.guest?.newAmt || 0) + (segments.guest?.repeatAmt || 0);
    if (segSum > 0) {
      const diffPct = Math.abs(segSum - dailyOrders.revenue) / dailyOrders.revenue * 100;
      if (diffPct > 5) w.push(`세그먼트 합계 ${formatMoney(segSum)} ≠ 전체 ${formatMoney(dailyOrders.revenue)} (${diffPct.toFixed(1)}%)`);
    }
  }
  // ④ Funnel 단조성 — 진짜 이상만 alert.
  //    begin_checkout > 구매 역전(결제완료>결제진입)은 측정구조상 정상: 외부결제(네이버·카카오)는
  //    begin_checkout 미발사(과소)인데 purchase는 GA4 MP push로 외부결제까지 보강(정확)됨 [[ga4-mp]].
  //    의미있는 이상은 "구매 > 장바구니"(상류보다 하류가 큼) 뿐.
  if (ga4Daily?.checkoutFunnel) {
    const f = ga4Daily.checkoutFunnel;
    if (f.beginCheckout > f.addToCart) w.push(`funnel 역전: 결제진입(${f.beginCheckout}) > 장바구니(${f.addToCart})`);
    if (f.purchase && f.addToCart && f.purchase > f.addToCart) w.push(`funnel 역전: 결제완료(${f.purchase}) > 장바구니(${f.addToCart})`);
  }
  // ⑤ LTV fetch 건강성 — 운영 시작(자사몰 2025-12 오픈)이라 lookback span 짧은 건 정상(오탐 제거).
  //    진짜 이상은 "최근 주문이 안 들어옴" = 토큰/페이지네이션으로 최신 데이터 누락.
  if (ltv && ltv.회원_총수_365d > 100 && ltv.최신_주문일) {
    const newestMs = new Date(ltv.최신_주문일 + 'T00:00:00Z').getTime();
    const cutoffMs = new Date(asOf + 'T00:00:00Z').getTime() - 2 * 86400000; // 기준일-2일 이내 주문 있어야 정상
    if (newestMs < cutoffMs) {
      w.push(`LTV fetch 누락 의심 — 최근 주문일 ${ltv.최신_주문일}, 기준일 ${asOf}보다 오래됨 (토큰·페이지네이션)`);
    }
  }
  // ⑥ 토큰 만료 감지 — 발송 중단 신호
  if (!dailyOrders || dailyOrders.totalCount === 0) {
    w.push('🚨 카페24 주문 0건 — fetch 실패 또는 진짜 0건. 토큰·VPS 확인');
  }
  // ⑦ 공구 active인데 매출 0
  if (promos && cafe24?.byProduct) {
    promos.forEach(p => {
      if (p.status === 'active' || (p.dDay || '').includes('D-')) {
        const sale = cafe24.byProduct[p.productNo];
        if (!sale || !sale.amount) {
          w.push(`${p.title} active인데 매출 0 — 발행/링크/재고 확인`);
        }
      }
    });
  }
  // ⑧ 메타 ROAS vs 실제(blended) ROAS
  if (meta && meta.spend > 0 && meta.roas > 0 && dailyOrders && dailyOrders.revenue > 0) {
    const blended = Math.round(dailyOrders.revenue / meta.spend * 100);
    const diffPct = ((meta.roas - blended) / blended) * 100;
    if (diffPct > 100) w.push(`🚨 메타 ROAS ${meta.roas}% vs 실제 ${blended}% (메타픽셀 ${diffPct.toFixed(0)}% 과대) — 광고 결정 위험`);
    else if (diffPct > 50) w.push(`메타 ROAS ${meta.roas}% vs 실제 ${blended}% (+${diffPct.toFixed(0)}%) — 자사몰 매출 기여 한계`);
  }

  // 기존 매출/주문/리텐션/트래픽 자체 점검 유지
  if (dailyOrders && dailyOrders.totalCount > 0) {
    if (dailyOrders.revenue === 0) w.push('매출 0원인데 주문 있음 → 금액 집계 오류 의심');
    if (dailyOrders.paidCount > dailyOrders.totalCount) w.push('결제건수 > 주문건수 (모순)');
    if (cafe24 && cafe24.totalSales > dailyOrders.revenue + 1) w.push('상품별 합 > 총매출 (집계 불일치)');
  }
  if (!segments) w.push('리텐션(세그먼트) 미수집');
  else if (segments.guest && (segments.guest.newCount + segments.guest.repeatCount) > 0 && (!segments.guestPhones || segments.guestPhones.length === 0)) {
    w.push('게스트 주문 있는데 전화번호 0건 → 게스트→회원 매칭 불가(embed=receivers 필요)');
  }
  if (!ga4Daily || !ga4Daily.checkoutFunnel) w.push('GA4 미수집');
  else if (ga4Daily.checkoutFunnel.addToCart > 0 && ga4Daily.checkoutFunnel.beginCheckout === 0) {
    w.push('결제진입 0 (추적 누락 의심 — 장바구니는 잡히는데 결제진입 이벤트 미발화)');
  }
  if (!clarity) w.push('Clarity 한도/미수집(GA4 백업으로 대체됨)');
  if (!analysis) w.push('CX 판단(Claude) 비어있음');
  if (!cxManagerAnalysis) w.push('CX 관리자 분석(Claude) 비어있음');
  if (!restock) w.push('재입고알림(CRM) 미수집');
  if (adAudit && adAudit.total > 0 && adAudit.broken && adAudit.broken.length / adAudit.total > 0.5) {
    w.push(`광고 URL 절반 이상 깨짐 (${adAudit.broken.length}/${adAudit.total})`);
  }
  return w;
}

// 송마망봇 단톡방 매출 메시지 파싱 — 교차 검증용
function parseSongmamansSales(songmamans) {
  if (!songmamans?.tgMessages) return null;
  // tgMessages는 사람 메시지만. 봇 메시지는 따로 fetch 필요.
  // 일단 raw 시트 RAW 탭에서 매출 행 탐색
  if (songmamans.recentRaw && Array.isArray(songmamans.recentRaw)) {
    for (const row of songmamans.recentRaw) {
      const text = (row || []).join(' ');
      const m = text.match(/자사몰\s*매출[^\d]*([\d,]+)\s*원/) || text.match(/매출\s*([\d,]+)\s*원/);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100000) return v; // 노이즈 방지
      }
    }
  }
  return null;
}

// ── 텔레그램 발송 ──────────────────────────────────────
function escapeHtml(s) {
  let str = String(s || '');
  // 깨진 surrogate pair (불완전 이모지·잘린 emoji token) 제거 — Telegram에서 `��` 표시되는 원인
  str = str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
  str = str.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  // Unicode replacement character·NULL 등 invisible 문자 strip
  str = str.replace(/[� ]/g, '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const DRY_RUN = process.env.DRY_RUN === '1';
function sendTelegram(text, replyMarkup) {
  if (DRY_RUN) { console.log('\n[DRY_RUN][개인 DM]\n' + text.replace(/<[^>]+>/g, '') + '\n'); return Promise.resolve({ ok: true, dry: true }); }
  const payload = { chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return postJson('api.telegram.org', `/bot${TG_TOKEN}/sendMessage`, {}, payload);
}
function sendTelegramGroup(text, replyMarkup) {
  if (DRY_RUN) { console.log('\n[DRY_RUN][단톡방]\n' + text.replace(/<[^>]+>/g, '') + '\n'); return Promise.resolve({ ok: true, dry: true }); }
  const payload = { chat_id: GROUP_CHAT_ID, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return postJson('api.telegram.org', `/bot${TG_TOKEN}/sendMessage`, {}, payload);
}
// 4096자 제한 — 줄 단위로 chunk 발송. 메시지 순서 보장 위해 await 직렬.
// replyMarkup(인라인 버튼)은 마지막 chunk에만 붙임.
async function sendTelegramChunked(text, group, replyMarkup) {
  const send = group ? sendTelegramGroup : sendTelegram;
  const MAX = 3800; // 안전 마진
  if (text.length <= MAX) return await send(text, replyMarkup);
  const lines = text.split('\n');
  const chunks = [];
  let buf = '';
  for (const line of lines) {
    if ((buf + '\n' + line).length > MAX && buf) { chunks.push(buf); buf = line; }
    else { buf = buf ? buf + '\n' + line : line; }
  }
  if (buf) chunks.push(buf);
  let last = null;
  for (let i = 0; i < chunks.length; i++) {
    last = await send(chunks[i], i === chunks.length - 1 ? replyMarkup : undefined);
  }
  return last;
}

// ── 일간 리포트 ────────────────────────────────────────
async function dailyReport() {
  const today = dateStr(1);
  const display = formatDate(today);
  console.log(`[일간] ${today}`);

  // 데이터 fetch — Cafe24 raw 중심 (GA4 newVsReturning은 측정 누락 신뢰 X)
  let [clarity, sheetsTasks, ga4Daily, cafe24, dailyOrders, segments, restock, voc, songmamans, pageStats, kkulSchedule] = await Promise.all([
    getClarityData(),
    getSheetsTasks(),
    getGA4Daily(today),
    getCafe24SalesByProduct(today),
    getCafe24DailyOrders(today),
    getCafe24CustomerSegments(today, 365),
    fetchRestockRequests(),
    fetchNegativeVOC(today),
    fetchSongmamansContext(),
    getClarityPageStats(1),
  ]);
  const promos = getActivePromos(); // 공구·콜라보 활성/예정 일정 (sync — 메모리에서 즉시 로드)
  // pageStats = { byUrl: { url: {dead, quick, scroll, sessions} }, friction: [...top1] }
  if (segments) segments = await enrichGuestSegmentsWithCRM(segments);

  // P0: 메타 광고 URL 검증 (Claude 분석이 adAudit을 입력으로 받으므로 순차 실행)
  const adAudit = await auditMetaAdUrls();
  // 메타 광고 일일 통계도 fetch (스냅샷·baseline 비교용)
  const metaToday = await getMetaStats(today, today);
  // 직전 7일 baseline 가져와서 Claude 프롬프트 컨텍스트로 주입 (자동 폭증 감지)
  const baselineRes = await getDailyBaseline(7);
  // Jung 진행 중 메모 fetch — Claude가 CX 개선 대기열 surface 결정 시 참고
  const memosForClaude = await getMemos();
  const analysis = await getClaudeAnalysis('daily', { clarity, ga4Daily, dailyOrders, cafe24, segments, restock, voc, songmamans, adAudit, baseline: baselineRes.baseline, baselineN: baselineRes.count, pageStats, memos: memosForClaude, promos });

  // 🚦 사이트 (Clarity 우선, 한도 시 GA4 트래픽 채널 백업) + GA4 결제 퍼널 통합
  // 매출·유입경로는 송마망봇이 통합 발송하므로 여기선 행동·퍼널 신호만.
  // [[clarity-noise]] 룰: ScriptError·Quickback 단독은 인앱 노이즈. 진짜 막힘은 DeadClick+RageClick 동시 발생만 surface.
  // 인스타인앱 비중과 GA4 funnel만 핵심 신호로 노출.
  let healthSection;
  if (clarity) {
    const inappPct = parseFloat(clarity.instagramPct || 0);
    healthSection = `인스타인앱 ${inappPct}%${inappPct >= 50 ? '⚠️' : ''}`;
    // 💳 결제수단 분포 (cafe24 raw — GA4 funnel보다 정확. 실주문 기준)
    if (dailyOrders?.payMethods) {
      const pm = dailyOrders.payMethods;
      const tot = pm.자체결제 + pm.네이버페이 + pm.카카오페이 + pm.기타간편;
      if (tot > 0) {
        const pct = v => Math.round(v / tot * 100);
        const parts = [`자체 ${pct(pm.자체결제)}%`];
        if (pm.네이버페이) parts.push(`네이버페이 ${pct(pm.네이버페이)}%`);
        if (pm.카카오페이) parts.push(`카카오페이 ${pct(pm.카카오페이)}%`);
        if (pm.기타간편) parts.push(`기타간편 ${pct(pm.기타간편)}%`);
        healthSection += `\n💳 결제수단 (${tot}건): ${parts.join(' · ')}`;
      }
    }
    if (ga4Daily?.checkoutFunnel) {
      const cf = ga4Daily.checkoutFunnel;
      const dropPct = cf.addToCart > 0 ? ((cf.addToCart - cf.beginCheckout) / cf.addToCart * 100) : 0;
      healthSection += `\nGA4 퍼널(참고용): 장바구니 ${cf.addToCart} → 진입 ${cf.beginCheckout} — ⚠️측정착시(외부간편결제·인앱 begin_checkout 누락). 실결제는 위 결제수단 기준`;
    }
    // 진짜 막힘 페이지만 (friction 함수가 이미 DeadClick 기반 필터링하는 곳에서)
    if (pageStats?.friction?.length) {
      const fpLines = pageStats.friction.map(p => `${p.url} — 데드 ${(p.dead || 0).toFixed(0)}%·뒤로 ${(p.quick || 0).toFixed(0)}% (${p.sessions}세션)`);
      healthSection += `\n🔥 막힘 페이지:\n  ${fpLines.join('\n  ')}`;
    }
  } else {
    healthSection = (ga4Daily && ga4Daily.channels && ga4Daily.channels.length)
      ? `⚠️ Clarity 한도 — 트래픽: ${ga4Daily.channels.slice(0,3).map(c=>`${c.name} ${c.sessions}`).join(' / ')}`
      : '⚠️ 데이터 없음';
  }

  // 🔁 리텐션 (Cafe24 raw — 365일 lookback 윈도우 내 식별)
  // ⚠️ cafe24 customers API에 first_order_date 필드 없음(검증 5/26) → orders raw lookback이 유일 정확 경로.
  let retentionSection;
  if (segments && segments.totalOrders > 0) {
    const total = segments.totalOrders;
    const m = segments.member, g = segments.guest;
    const memberTotal = m.newCount + m.retCount;
    const guestTotal = g.newCount + g.repeatCount;
    const memberSharePct = total > 0 ? (memberTotal / total * 100) : 0;
    const memberRetPct = memberTotal > 0 ? (m.retCount / memberTotal * 100) : 0;
    const guestRepeatPct = guestTotal > 0 ? (g.repeatCount / guestTotal * 100) : 0;
    const crmMatch = segments.crmMatchedGuests != null
      ? ` · CRM매칭 ${segments.crmMatchedGuests}/${segments.guestPhones.length}`
      : '';
    const lb = segments.lookbackDays || 365;
    retentionSection = `회원 ${memberTotal}건 → 재방문 ${m.retCount}건 (${memberRetPct.toFixed(1)}%, ${lb}일 lookback)\n게스트 ${guestTotal}건 → 반복 ${g.repeatCount}건${crmMatch}`;
  } else {
    retentionSection = '⚠️ Cafe24 데이터 미수집';
  }

  // 🛍️ 상품별 매출 분포 (#83 포함 전체 SKU, 매출순 top 6) — 송마망봇이 안 다루는 차원
  // 꿀동이 공구(#83) vs 자체 SKU 의존도 라인 + 항상 (#N) 라벨 (이름 중복 SKU 구분)
  let productSalesSection = '데이터 없음';
  if (cafe24 && cafe24.byProduct) {
    const all = Object.values(cafe24.byProduct).filter(v => v.count > 0).sort((a, b) => b.amount - a.amount);
    if (all.length) {
      const topN = all.slice(0, 6);
      const topAmt = topN.reduce((s, p) => s + p.amount, 0);
      const lines = topN.map(p => {
        const id = String(p.productNo);
        const customNm = PRODUCT_NAME[id];
        const label = customNm ? `${customNm} (#${id})` : `${(p.name || '제품').replace(/^\[.*?\]\s*/, '')} (#${id})`;
        return `${label}: ${formatMoney(p.amount)}·${p.count}건`;
      });
      // 공구 일정 (PROMO_SCHEDULE 메모리 단일 소스) — 활성·예정 모두 표시
      let scheduleLine = '';
      if (promos && promos.length) {
        scheduleLine = promos.map(p => `📅 ${p.title} — ${p.dDay}`).join('\n') + '\n';
      }
      productSalesSection = `${scheduleLine}합계 ${formatMoney(topAmt)}\n${lines.join('\n')}`;
    }
  }

  // 🔗 광고 URL 검증 — broken ≥3 또는 전체의 10% 이상일 때만 🚨 노출 (1~2개 깨짐은 노이즈 수준이라 매일 헛경보 방지)
  let adAuditSection = '';
  if (adAudit) {
    const brokenN = adAudit.broken.length;
    const significant = adAudit.total > 0 && (brokenN >= 3 || brokenN / adAudit.total > 0.1);
    if (significant) {
      const names = adAudit.broken.slice(0, 3).map(a => a.name.slice(0, 20)).join(', ');
      adAuditSection = `\n\n🚨 <b>광고 URL 이상</b> ${brokenN}개/${adAudit.total}개\n${names}${brokenN > 3 ? ` 외 ${brokenN - 3}개` : ''}\n→ 메타 광고 매니저 URL 즉시 확인`;
    }
  }

  // 📦 재입고알림 (오늘 신규 신청 있거나 대기 누적이 클 때만)
  let restockSection = '';
  if (restock) {
    const pace = restock.paceVsLastMonth ? ` · ${restock.paceVsLastMonth.toFixed(1)}배 페이스` : '';
    if (restock.todayCount > 0) {
      restockSection = `\n\n📦 <b>바질페스토 재입고알림</b>\n오늘 +${restock.todayCount}건 · 누적 ${restock.totalCount}건 (대기 ${restock.pendingCount}건)${pace}`;
    } else if (restock.pendingCount >= 100) {
      restockSection = `\n\n📦 <b>바질페스토 재입고알림</b> · 대기 ${restock.pendingCount}건${pace}`;
    }
  }

  // 📢 부정/중립 VOC (있을 때만)
  let vocSection = '';
  if (voc && voc.negCount > 0) {
    const list = voc.items.map(i => `${i.cls || ''} ${i.rating || ''} ${i.product || ''} — "${i.excerpt}"`).join('\n');
    vocSection = `\n\n📢 <b>부정/중립 후기</b> ${voc.negCount}건\n${list}`;
  }

  // 💳 결제 흐름 3페이지 — 매일 같은 자리 추적해 추세 폭증 즉시 감지
  let checkoutSection = '';
  if (pageStats?.byUrl) {
    const m = pageStats.byUrl;
    const basket = pickClarityPage(m, v => v.url.startsWith('/order/basket'));
    const orderform = pickClarityPage(m, v => v.url.startsWith('/order/orderform'));
    const login = pickClarityPage(m, v => v.url.startsWith('/member/login'));
    const fmt = (p) => p ? `데드 ${(p.dead || 0).toFixed(0)}%·뒤로 ${(p.quick || 0).toFixed(0)}% (${p.sessions}세션)` : '데이터 없음';
    if (basket || orderform || login) {
      checkoutSection = `\n\n💳 <b>결제 흐름 마찰</b>
  장바구니: ${fmt(basket)}
  결제폼: ${fmt(orderform)}
  로그인: ${fmt(login)}`;
    }
  }

  // 📜 매출 SKU 페이지 행동 — top 매출 SKU 4개 페이지의 스크롤·뒤로 추적 (Jung 자사몰 수정 신호)
  let productPageSection = '';
  if (pageStats?.byUrl && cafe24 && cafe24.byProduct) {
    const topSkus = Object.values(cafe24.byProduct).filter(v => v.count > 0).sort((a, b) => b.amount - a.amount).slice(0, 4).map(p => String(p.productNo));
    const lines = [];
    topSkus.forEach(pno => {
      const p = pickClarityPage(pageStats.byUrl, v => v.url.includes(`product_no=${pno}`) || v.url.includes(`/surl/p/${pno}`));
      if (p && p.sessions >= 5) {
        const label = PRODUCT_NAME[pno] || `상품 #${pno}`;
        lines.push(`  ${label} (#${pno}): 스크롤 ${(p.scroll || 0).toFixed(0)}%·뒤로 ${(p.quick || 0).toFixed(0)}% (${p.sessions}세션)`);
      }
    });
    if (lines.length) productPageSection = `\n\n📜 <b>매출 SKU 페이지 행동</b>\n${lines.join('\n')}`;
  }

  // 🆕 LTV 3개 surface — 신규 D+30·휴면 91-180·상위10% 점유 (방금 박은 calculateLTVMetrics)
  let ltvForReport = null;
  try { ltvForReport = await calculateLTVMetrics(today); }
  catch (e) { console.error('[LTV daily fetch] 실패:', e.message); }
  const ltvSection = ltvForReport
    ? `\n신규 D+30 재구매 ${ltvForReport.신규_D30_retention}% (cohort ${ltvForReport.신규_D30_cohort_size}명) · 휴면 91-180d ${ltvForReport.휴면_91_180d}명 · VIP top10% 매출 ${ltvForReport.상위10_매출점유}%`
    : '';

  // 🆕 세그먼트 매출 분해 — 별도 섹션 (빈 줄 분리)
  let segmentSalesSection = '';
  if (segments && dailyOrders?.revenue > 0) {
    const m = segments.member, g = segments.guest;
    const totalRev = (m?.newAmt || 0) + (m?.retAmt || 0) + (g?.newAmt || 0) + (g?.repeatAmt || 0);
    if (totalRev > 0) {
      const pct = (v) => (v / totalRev * 100).toFixed(0);
      segmentSalesSection = `\n\n📊 <b>세그먼트 매출 분해</b>\n신규 회원: ${formatMoney(m.newAmt)} (${pct(m.newAmt)}%)\n재방문 회원: ${formatMoney(m.retAmt)} (${pct(m.retAmt)}%)\n게스트 신규: ${formatMoney(g.newAmt)} (${pct(g.newAmt)}%)\n게스트 반복: ${formatMoney(g.repeatAmt)} (${pct(g.repeatAmt)}%)`;
    }
  }

  // 🆕 인앱 비중 안내문 (50%+일 때만) — 사이트 섹션 안 한 단락 내부
  const inappPct = parseFloat(clarity?.instagramPct || 0);
  const inappNotice = inappPct >= 50
    ? `\n⚠️ 인스타인앱 ${inappPct}% — ScriptError·Quickback 단독은 노이즈 가능. 진짜 막힘은 DeadClick+RageClick 동시만 surface.`
    : '';

  // 🆕 상품 별 매출 (라벨 변경) + 공구 일정 별도 섹션 분리
  let promoScheduleSection = '';
  if (promos && promos.length) {
    promoScheduleSection = `\n\n📅 <b>공구 일정</b>\n${promos.map(p => `${p.title} — ${p.dDay}`).join('\n')}`;
  }
  // productSalesSection에서 공구 일정 prepend 제거 — 따로 분리됐으니
  let productSalesOnly = '데이터 없음';
  if (cafe24 && cafe24.byProduct) {
    const all = Object.values(cafe24.byProduct).filter(v => v.count > 0).sort((a, b) => b.amount - a.amount);
    if (all.length) {
      const topN = all.slice(0, 6);
      const topAmt = topN.reduce((s, p) => s + p.amount, 0);
      const lines = topN.map(p => {
        const id = String(p.productNo);
        const customNm = PRODUCT_NAME[id];
        const label = customNm ? `${customNm} (#${id})` : `${(p.name || '제품').replace(/^\[.*?\]\s*/, '')} (#${id})`;
        return `${label}: ${formatMoney(p.amount)}·${p.count}건`;
      });
      productSalesOnly = `합계 ${formatMoney(topAmt)}\n${lines.join('\n')}`;
    }
  }

  // 🎯 오늘 할 것 — 레버 데이터에서 규칙으로 액션 도출 (측정값 직결, Claude 판단의 안전판).
  // 데이터→행동 루프: 각 줄이 "지표 → 바꿀 행동". 행동하면 그 지표가 다음날 바뀌어야 함.
  const dailyActions = [];
  if (segments && segments.guest && segments.totalOrders) {
    const gShare = (segments.guest.newCount + segments.guest.repeatCount) / Math.max(segments.totalOrders, 1);
    if (gShare >= 0.35) dailyActions.push(`👤 게스트 ${Math.round(gShare * 100)}% → 결제완료에 회원전환 쿠폰+친추 후크 (재구매 추적 가능하게)`);
  }
  if (ltvForReport && ltvForReport.휴면_91_180d >= 400) {
    dailyActions.push(`🔁 휴면 ${ltvForReport.휴면_91_180d}명 → 소비주기(20일) 기반 레시피 리마인드 (할인 X·레시피 O)`);
  }
  if (promos && promos.length) {
    const soon = promos.find(p => /D-[0-3]\b/.test(p.dDay || ''));
    if (soon) dailyActions.push(`📅 ${soon.title} ${soon.dDay} → 발행·링크·재고 점검`);
  }
  const actionSection = dailyActions.length ? `\n\n🎯 <b>오늘 할 것</b>\n${dailyActions.join('\n')}` : '';
  // 🤖 CX 판단 — Claude 인사이트 1개를 본문에 통합 (별도 발송하면 묻힘). 실발송엔 채워지고 DRY_RUN(로컬 키 X)만 빔.
  const analysisSection = analysis ? `\n\n🤖 <b>CX 판단</b>\n${analysis}` : '';

  // 단톡방 메시지 — 송마망봇과 중복되는 섹션(매출·유입경로·VOC·재입고·광고URL)은 제거.
  // 송마망봇이 매일 통합 발송하므로 은우봇은 CX 고유 차원(사이트행동·결제흐름·상품페이지·리텐션·상품믹스·CX판단)만.
  const msg = `🔎 <b>CX 일간</b> · ${display}
━━━━━━━━━━━━━━━━━
🚦 <b>사이트</b>
${healthSection}${inappNotice}${checkoutSection}${productPageSection}

🔁 <b>리텐션</b> (Cafe24 raw)
${retentionSection}${ltvSection}${segmentSalesSection}

🛍️ <b>상품 별 매출</b>
${productSalesOnly}${promoScheduleSection}${actionSection}${analysisSection}`;

  const analysisMsg = analysis ? `🤖 <b>CX 판단</b>\n${analysis}` : null;

  console.log('\n======= 텔레그램 전문 =======');
  console.log(msg.replace(/<[^>]+>/g, ''));
  if (analysisMsg) { console.log('\n--- Claude 분석 ---\n' + analysisMsg.replace(/<[^>]+>/g, '')); }
  console.log('==============================\n');

  let tasksSection = '';
  if (sheetsTasks && sheetsTasks.oneThing) {
    const isDone = sheetsTasks.isDone || sheetsTasks.oneThing.startsWith('[완료]');
    const oneThingText = sheetsTasks.oneThing.replace(/^\[완료\]\s*/, '');
    const statusIcon = isDone ? '✅' : '⬜';
    const oneThingFormatted = isDone ? `<s>${oneThingText}</s>` : oneThingText;
    tasksSection = `\n📋 <b>주간 전략</b>  ⭐ ${statusIcon} ${oneThingFormatted}`;
    if (sheetsTasks.subs.length) {
      const subLines = sheetsTasks.subs.map(s => {
        const done = s.startsWith('[완료]');
        const text = s.replace(/^\[완료\]\s*/, '');
        return done ? `  • <s>${text}</s>` : `  • ${text}`;
      });
      tasksSection += '\n' + subLines.join('\n');
    }
    if (sheetsTasks.note) {
      tasksSection += `\n📌 비고: ${sheetsTasks.note}`;
    }
  }

  // 개인메모 = COMPASS 전략대시보드에서 /메모로 추가한 것 (잊지 않게 매일 자동 표시)
  const compassMemos = await getCompassMemos();
  let memoSection = '';
  if (compassMemos.length > 0) {
    memoSection = `\n📝 <b>개인메모</b> (COMPASS · /메모)\n${compassMemos.map(m => `• ${m}`).join('\n')}`;
  }

  // 역할 고정(2026-05-20): 회의록/일일대화/리마인드는 미주 통합 영역. 은우봇은 CX 행동·이상신호 + 개인 할일/메모만 발송.
  // (processTelegramMessages/getRemindersFromSheet/saveMeetingNotes/getDailyMessagesFromSheet 함수는 personal-metrics 등 추후 재사용 위해 export 유지)

  // ── CX 관리자 분석 (개인 DM에 추가) ──
  const [activities, dailyMessages] = await Promise.all([
    getRecentActivities(24).catch(() => []),
    getDailyMessagesFromSheet(today).catch(() => [])
  ]);
  const cxManagerAnalysis = await getCXManagerAnalysis({
    activities, dailyMessages, clarity, ga4Daily, dailyOrders, segments, voc, restock, adAudit
  });
  const cxManagerSection = cxManagerAnalysis
    ? `\n\n🎯 <b>CX 관리자 분석</b>\n${cxManagerAnalysis}`
    : '';

  // 발송 전 자가점검 — 이상 있으면 콘솔 로그 + 개인 DM에 표시
  const songmamansSales = parseSongmamansSales(songmamans);
  const warnings = buildDataHealthWarnings({
    dailyOrders, cafe24, segments, ga4Daily, clarity, analysis, cxManagerAnalysis, restock, voc, adAudit,
    ltv: ltvForReport, songmamansSales, meta: metaToday, promos, reportDate: today,
  });
  if (warnings.length) console.error('⚠️ 데이터 점검 경고:\n- ' + warnings.join('\n- '));
  const healthSectionDM = warnings.length ? `\n\n🔧 <b>데이터 점검</b>\n${warnings.map(x => `⚠️ ${x}`).join('\n')}` : '';

  // 개인 DM: 할일 + 메모 + CX 분석 + (이상 시) 데이터 점검
  const personalMsg = `☀️ <b>오늘 할일</b>${tasksSection}${memoSection}${cxManagerSection}${healthSectionDM}`;

  const groupResult = await sendTelegramGroup(msg);
  if (groupResult.ok) {
    // 🤖 CX 판단은 이제 msg 본문(analysisSection)에 통합 — 별도 발송 안 함 (묻힘 방지)
    if (tasksSection || memoSection || cxManagerSection || healthSectionDM) await sendTelegram(personalMsg);
    console.log('일간 발송 완료 ✅');
  } else {
    console.error('발송 실패 ❌:', JSON.stringify(groupResult));
  }

  // 📊 일별 스냅샷 저장 (Before/After 측정 + 7일 이동평균 baseline용)
  try {
    let ltv = null;
    try { ltv = await calculateLTVMetrics(today); }
    catch (e) { console.error('[LTV 계산] 실패:', e.message); }
    const snap = buildDailySnapshot(today, { clarity, dailyOrders, segments, meta: metaToday, adAudit, pageStats, ltv });
    const res = await saveDailySnapshot(snap);
    console.log(`[일별 스냅샷] ${today} 저장 → ${res && res.ok ? 'OK' : JSON.stringify(res)}`);
  } catch (e) { console.error('[일별 스냅샷] 실패:', e.message); }

  // 🔁 Cafe24 외부결제 → GA4 MP push (attribution 정확도 회복)
  try {
    const r = await pushExternalOrdersToGA4(today);
    console.log(`[GA4 외부결제 push] ${today} → ${JSON.stringify(r)}`);
  } catch (e) { console.error('[GA4 외부결제 push] 실패:', e.message); }
}

// ── 주간 스냅샷 (Looker Studio 다차원 보고서용) ──────────
const SNAP_CH_MAP = {
  'Paid Social':'유료SNS(메타)', 'Organic Social':'자연SNS', 'Direct':'직접유입',
  'Organic Search':'검색', 'Paid Search':'검색광고', 'Referral':'리퍼럴',
  'Email':'이메일', 'Display':'디스플레이', 'Paid Other':'기타광고',
  'Organic Shopping':'쇼핑검색', 'Organic Video':'자연동영상', 'Cross-network':'크로스네트워크',
  'Unassigned':'미지정', '(other)':'기타', '(미지정)':'미지정'
};
const snapCh = (ch) => SNAP_CH_MAP[ch] || ch;

// 월~일 주간 범위. weeksAgo=1 → 지난주(완전한 주). 라벨=그 주 월요일(YYYY-MM-DD).
function weekRange(weeksAgo) {
  const now = new Date();
  const day = now.getDay();                  // 0=일 ~ 6=토
  const mondayOffset = (day === 0 ? 6 : day - 1);
  const start = new Date(now); start.setDate(now.getDate() - mondayOffset - weeksAgo * 7);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const fmt = (d) => d.toISOString().split('T')[0];
  return { start: fmt(start), end: fmt(end), label: fmt(start) };
}

async function buildWeeklySnapshot(weekStart, weekEnd, label) {
  const [meta, cafe24, ga4, campaigns] = await Promise.all([
    getMetaStats(weekStart, weekEnd),
    getCafe24Sales(weekStart, weekEnd),
    getGA4Slices(weekStart, weekEnd),
    getMetaByCampaign(weekStart, weekEnd),
  ]);
  // cafe24 토큰 없으면 sales/count=0 → 실제 0과 구분 위해 blank 처리(주간 0매출은 비현실적)
  const hasCafe24 = cafe24 && (cafe24.sales > 0 || cafe24.count > 0);
  // 실제ROAS = 카페24 실매출 ÷ 광고비 (메타 자체 ROAS는 과대측정 경향이라 실매출 기준이 진짜)
  const realRoas = hasCafe24 && meta.spend > 0 ? Math.round((cafe24.sales / meta.spend) * 100) : '';
  // 메타주장비중 = 메타픽셀매출 ÷ 카페24 실매출 (높을수록 메타가 전체매출을 과하게 자기공으로 주장 = 과대측정)
  const metaShare = hasCafe24 && cafe24.sales > 0 ? Math.round((meta.revenue / cafe24.sales) * 100) : '';

  const summary = [{
    주차: label,
    광고비: Math.round(meta.spend),
    메타픽셀매출: Math.round(meta.revenue),
    메타ROAS: parseInt(meta.roas) || 0,
    실제ROAS: realRoas,
    메타주장비중: metaShare,
    카페24매출: hasCafe24 ? cafe24.sales : '',
    카페24주문: hasCafe24 ? cafe24.count : '',
    AOV: hasCafe24 && cafe24.count > 0 ? Math.round(cafe24.sales / cafe24.count) : '',
  }];
  const channel = ga4.channels.map(c => ({
    주차: label, 채널: snapCh(c.channel), 세션: c.sessions, 전환: c.conv,
    전환율: c.sessions > 0 ? +((c.conv / c.sessions) * 100).toFixed(2) : 0,
  }));
  const customer = ga4.userType.map(u => ({
    주차: label, 구분: u.type === 'new' ? '신규' : u.type === 'returning' ? '재방문' : '미상',
    세션: u.sessions, 전환: u.conv,
    전환율: u.sessions > 0 ? +((u.conv / u.sessions) * 100).toFixed(2) : 0,
  }));
  const campaign = campaigns.map(c => ({
    주차: label, 캠페인: c.campaign, 광고비: c.spend, 매출: c.revenue,
    ROAS: c.roas, CTR: parseFloat(c.ctr) || 0, 구매: c.purchases,
  }));
  return { week: label, summary, channel, customer, campaign };
}

async function saveWeeklySnapshot(weekStart, weekEnd, label) {
  const snap = await buildWeeklySnapshot(weekStart, weekEnd, label);
  const res = await postToAppsScript({ action: 'save_weekly', ...snap }, APPS_SCRIPT_URL);
  console.log(`[스냅샷 ${label}] 채널 ${snap.channel.length} · 고객 ${snap.customer.length} · 캠페인 ${snap.campaign.length} → ${res && res.ok ? 'OK' : JSON.stringify(res)}`);
  return { snap, res };
}

// 지난 N주 백필 (오래된 주부터)
async function backfillWeeklySnapshots(numWeeks = 8) {
  for (let w = numWeeks; w >= 1; w--) {
    const { start, end, label } = weekRange(w);
    try { await saveWeeklySnapshot(start, end, label); }
    catch (e) { console.error(`[백필 ${label}] 실패:`, e.message); }
  }
}

// ── 쿠폰 전환율 (등급쿠폰 사용률 — 미주 발송, 전환 측정은 은우 고유) ──
// 등급쿠폰은 매월 재발급(recurring)이라 당월분은 사용시간 부족 → 직전 캘린더월 발급분으로 측정.
async function fetchCouponConversion() {
  try {
    const headers = { 'Authorization': `Bearer ${CAFE24_ACCESS_TOKEN}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION };
    const cpData = await fetchJson(`${CAFE24_BASE}coupons?limit=100`, headers);
    // 재구매 유도용 등급쿠폰만 (웰컴=신규용이라 제외, issues 5000+로 무겁기도)
    const coupons = (cpData.coupons || []).filter(c => /VIP|패밀리|Ambassador/i.test(c.coupon_name || ''));
    // 직전월 YYYY-MM (로컬 기준 — toISOString은 UTC라 월초가 전달로 밀려서 쓰면 안 됨)
    const dm = new Date(); dm.setDate(1); dm.setMonth(dm.getMonth() - 1);
    const lastMonth = dm.getFullYear() + '-' + String(dm.getMonth() + 1).padStart(2, '0');
    const out = [];
    for (const c of coupons) {
      let off = 0, all = [];
      while (true) {
        const d = await fetchJson(`${CAFE24_BASE}coupons/${c.coupon_no}/issues?limit=100&offset=${off}`, headers);
        if (!d.issues || !d.issues.length) break;
        all.push(...d.issues);
        if (d.issues.length < 100) break;
        off += 100; if (off > 3000) break;
      }
      const lm = all.filter(i => String(i.issued_date || '').slice(0, 7) === lastMonth);
      if (!lm.length) continue;
      const used = lm.filter(i => i.used_coupon === 'T');
      const orderIds = used.filter(i => i.related_order_id).map(i => i.related_order_id);
      out.push({ name: (c.coupon_name || '').replace(/\[|\]/g, '').slice(0, 14), issued: lm.length, used: used.length, rate: lm.length ? used.length / lm.length * 100 : 0, orders: orderIds.length });
    }
    return { month: lastMonth, coupons: out };
  } catch (e) { console.error('[쿠폰 전환]', e.message); return null; }
}

// ── 재구매 골든타임 세그먼트 (마지막 구매 경과일 버킷) ──
// 재구매 중앙값 ~20일 → D+21~35 = 막 떠나기 시작한 "깨울 타겟"
async function getRepurchaseGoldenZone(asOfDate) {
  try {
    const end = asOfDate || dateStr(1);
    const start = new Date(new Date(end + 'T00:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const orders = await fetchCafe24OrdersRange(start, end);
    if (!orders.length) return null;
    const lastByMember = {};
    orders.forEach(o => {
      const m = (o.member_id || '').trim();
      if (!m) return;
      const d = String(o.order_date || '').slice(0, 10);
      if (!lastByMember[m] || d > lastByMember[m]) lastByMember[m] = d;
    });
    const today = new Date(end + 'T00:00:00Z');
    const seg = { d0_20: 0, d21_35: 0, d36_60: 0, d61_90: 0, d91: 0 };
    Object.values(lastByMember).forEach(last => {
      const days = Math.round((today - new Date(last + 'T00:00:00Z')) / 86400000);
      if (days <= 20) seg.d0_20++; else if (days <= 35) seg.d21_35++;
      else if (days <= 60) seg.d36_60++; else if (days <= 90) seg.d61_90++; else seg.d91++;
    });
    return { ...seg, total: Object.keys(lastByMember).length };
  } catch (e) { console.error('[재구매 골든존]', e.message); return null; }
}

// ── 헤더 메뉴 페이지뷰 전주 대비 (레시피=재구매 동선 선행지표) ──
async function getPageViewWoW() {
  try {
    const token = await getGA4Token();
    if (!token) return null;
    const tw = { startDate: dateStr(7), endDate: dateStr(1) };
    const lw = { startDate: dateStr(14), endDate: dateStr(8) };
    const q = (dr) => ga4Fetch(token, { dateRanges: [dr], metrics: [{ name: 'screenPageViews' }], dimensions: [{ name: 'pagePathPlusQueryString' }], limit: 400 });
    const [t, l] = await Promise.all([q(tw), q(lw)]);
    const bucket = (rows) => {
      const b = { 레시피: 0, 상품상세: 0, 장바구니: 0, 메인: 0, 마이페이지: 0 };
      (rows || []).forEach(rr => {
        const p = rr.dimensionValues[0].value, pv = parseInt(rr.metricValues[0].value) || 0;
        if (/recipe|레시피/i.test(p)) b.레시피 += pv;
        else if (/product\/detail/.test(p)) b.상품상세 += pv;
        else if (/basket|cart/.test(p)) b.장바구니 += pv;
        else if (p === '/' || /\/index/.test(p)) b.메인 += pv;
        else if (/myshop|mypage/.test(p)) b.마이페이지 += pv;
      });
      return b;
    };
    return { cur: bucket(t.rows), prev: bucket(l.rows) };
  } catch (e) { console.error('[페이지뷰 WoW]', e.message); return null; }
}

// ── UTM 채널 효과 (우리가 정한 campaign별 클릭→주문→매출) ──
// 카카오 친구톡·구글 검색광고·엽서 QR. UTM 적용 후 데이터 들어오기 시작.
async function getUtmChannelEffect() {
  try {
    const token = await getGA4Token();
    if (!token) return null;
    const tw = { startDate: dateStr(7), endDate: dateStr(1) };
    const ours = ['welcome', 'restock', 'grade-coupon', 'pc-v1', 'pesto_search'];
    const res = await ga4Fetch(token, {
      dateRanges: [tw],
      metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'totalRevenue' }],
      dimensions: [{ name: 'sessionCampaignName' }],
      dimensionFilter: { filter: { fieldName: 'sessionCampaignName', inListFilter: { values: ours } } },
      limit: 20, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });
    return (res.rows || []).map(rr => ({
      campaign: rr.dimensionValues[0].value,
      sessions: parseInt(rr.metricValues[0].value) || 0,
      purchases: parseInt(rr.metricValues[1].value) || 0,
      revenue: Math.round(Number(rr.metricValues[2].value)) || 0,
    }));
  } catch (e) { console.error('[UTM 채널 효과]', e.message); return null; }
}

// ── 주간 리포트 (월요일) ────────────────────────────────
async function weeklyReport() {
  const thisStart = dateStr(7), thisEnd = dateStr(1);
  const display = `${formatDate(thisStart)} ~ ${formatDate(thisEnd)}`;
  console.log(`[주간] ${display}`);

  const [metaThis, metaLast, cafe24This, cafe24Last, clarity, ga4, reviews, repurchase, pvWoW] = await Promise.all([
    getMetaStats(thisStart, thisEnd),
    getMetaStats(dateStr(14), dateStr(8)),
    getCafe24Sales(thisStart, thisEnd),
    getCafe24Sales(dateStr(14), dateStr(8)),
    getClarityData(),
    getGA4Weekly(),
    getCafe24Reviews(thisStart, thisEnd),
    getRepurchaseStats(90, thisStart, thisEnd),
    getPageViewWoW(),
  ]);
  // cafe24 무거운 호출(365일 orders·쿠폰 issues)은 순차 실행 —
  // Promise.all 동시 실행 시 cafe24 rate limit으로 최신 chunk가 누락돼 골든존이 부분 데이터(휴면만)로 나옴.
  const goldenZone = await getRepurchaseGoldenZone(thisEnd);
  const couponConv = await fetchCouponConversion();
  const utmEffect = await getUtmChannelEffect();

  // 📊 레버 baseline 저장 (UI/UX 개입 전후 비교의 기준점) — 매주 자동, 같은 주차 upsert.
  // 이게 있으면 UI/UX 바꾼 뒤 다음주 레버와 비교해 "바꿨더니 숫자가 바뀜"이 측정됨.
  try {
    const avgCoupon = couponConv?.coupons?.length ? Math.round(couponConv.coupons.reduce((s, c) => s + c.rate, 0) / couponConv.coupons.length) : '';
    const wk = repurchase?.week;
    const guestPct = wk && wk.guestCount != null && (wk.newCount + wk.repCount + wk.guestCount) > 0
      ? Math.round(wk.guestCount / (wk.newCount + wk.repCount + wk.guestCount) * 100) : '';
    await postToAppsScript({ action: 'save_levers', 주차: display, 쿠폰전환: avgCoupon, 골든타임: goldenZone?.d21_35 || '', 레시피PV: pvWoW?.cur?.레시피 || '', 재구매율: repurchase?.repurchaseRate || '', 게스트: guestPct }, APPS_SCRIPT_URL).catch(() => {});
    console.log('[레버 baseline] 저장:', display);
  } catch (e) { console.error('[레버 저장]', e.message); }

  const analysis = await getClaudeAnalysis('weekly', { meta: metaThis, cafe24: cafe24This, clarity, ga4, reviews, repurchase });

  const chMap = { 'Paid Social':'유료SNS', 'Organic Social':'자연SNS', 'Direct':'직접유입', 'Organic Search':'검색', 'Paid Other':'기타광고' };
  const chLines = Object.entries(ga4?.channels||{}).sort((a,b)=>b[1].cur.sessions-a[1].cur.sessions).slice(0,4).map(([ch, v]) =>
    `${chMap[ch]||ch}: ${v.cur.sessions}명${diff(v.cur.sessions, v.prev.sessions)}`
  ).join('\n');

  const f = clarity?.funnel;
  const funnelLine = f ? `랜딩 ${f.landing.toLocaleString()} → 상품 ${f.product}(${pct(f.product,f.landing)}) → 장바구니 ${f.cart}(${pct(f.cart,f.landing)}) → 구매 ${f.checkout}(${pct(f.checkout,f.landing)})` : '-';

  const ut = ga4?.userType?.cur;
  const utPrev = ga4?.userType?.prev;
  const userTypeLine = ut
    ? `신규: ${ut.new.sessions.toLocaleString()}명 | 구매전환 ${pct(ut.new.conv, ut.new.sessions)}${diff(ut.new.conv/Math.max(ut.new.sessions,1)*100, utPrev?.new?.conv/Math.max(utPrev?.new?.sessions||1,1)*100)}
재방문: ${ut.ret.sessions.toLocaleString()}명 | 구매전환 ${pct(ut.ret.conv, ut.ret.sessions)}${diff(ut.ret.conv/Math.max(ut.ret.sessions,1)*100, utPrev?.ret?.conv/Math.max(utPrev?.ret?.sessions||1,1)*100)}`
    : '-';

  const landingLines = (ga4?.landings||[]).map(l => {
    const name = l.page.length > 20 ? l.page.slice(0,20)+'…' : l.page;
    return `${name}: ${l.sessions}명 CVR ${l.cvr}`;
  }).join('\n');

  // 상품별 페이지 성과 (top 5)
  const productLines = (ga4?.topProducts||[]).map(p => {
    const nm = PRODUCT_NAME[p.id] || `상품 #${p.id}`;
    return `${nm}: ${p.sessions}세션·구매 ${p.purchases} (CVR ${pct(p.purchases, p.sessions)})`;
  }).join('\n');

  // 결제 누수 추정액 (Clarity 스크립트에러 × 세션 × 자사몰 CVR × AOV)
  let leakageLine = '데이터 부족';
  if (clarity && clarity.totalSessions && clarity.scriptErrorPct && cafe24This.count > 0) {
    const errorSessions = clarity.totalSessions * (clarity.scriptErrorPct / 100);
    const aov = cafe24This.sales / cafe24This.count;
    const siteCVR = cafe24This.count / Math.max(clarity.totalSessions, 1);
    const lostRevenue = errorSessions * siteCVR * aov;
    leakageLine = `${formatMoney(lostRevenue)}/주 잠재손실 추정 (에러 ${errorSessions.toFixed(0)}세션 × CVR ${(siteCVR*100).toFixed(1)}% × AOV ${formatMoney(aov)})`;
  }

  // 💳 쿠폰 전환 (등급쿠폰 사용률 — 직전월 발급분)
  let couponLine = '데이터 없음';
  if (couponConv && couponConv.coupons && couponConv.coupons.length) {
    const body = couponConv.coupons.map(c => `${c.name}: ${c.used}/${c.issued} 사용 (${c.rate.toFixed(0)}%)${c.orders ? ` · 주문 ${c.orders}건` : ''}`).join('\n');
    couponLine = `(${couponConv.month} 발급분)\n${body}`;
  } else if (couponConv) couponLine = '직전월 등급쿠폰 발급분 없음';

  // 🔁 재구매 골든타임 (마지막구매 경과일)
  let goldenLine = '데이터 없음';
  if (goldenZone) {
    goldenLine = `D+0~20 ${goldenZone.d0_20}명 · <b>D+21~35 ${goldenZone.d21_35}명</b> ⭐ · D+36~60 ${goldenZone.d36_60}명 · 휴면(D91+) ${goldenZone.d91}명
→ 이번주 깨울 타겟(소비주기 막 지남): <b>${goldenZone.d21_35}명</b>`;
  }

  // 📄 헤더 페이지뷰 전주 대비 (레시피=재구매 동선 선행지표)
  let pvLine = '데이터 없음';
  if (pvWoW) {
    const c = pvWoW.cur, p = pvWoW.prev;
    pvLine = `레시피 ${c.레시피}${diff(c.레시피, p.레시피)} · 상품상세 ${c.상품상세}${diff(c.상품상세, p.상품상세)} · 장바구니 ${c.장바구니}${diff(c.장바구니, p.장바구니)} · 메인 ${c.메인}${diff(c.메인, p.메인)}`;
  }

  // 📡 UTM 채널 효과 (카카오·구글·엽서 → 매출). 적용 전엔 데이터 없음
  const UTM_LABEL = { welcome: '친구톡 웰컴', restock: '친구톡 재입고', 'grade-coupon': '친구톡 등급쿠폰', 'pc-v1': '엽서 QR', pesto_search: '구글 검색광고' };
  let utmLine = '아직 데이터 없음 — 미주 UTM 적용 후 측정 시작 (카카오 친구톡·엽서 QR)';
  if (utmEffect && utmEffect.length) {
    utmLine = utmEffect.map(u => `${UTM_LABEL[u.campaign] || u.campaign}: ${u.sessions}클릭 → ${u.purchases}주문 → ${formatMoney(u.revenue)}`).join('\n');
  }

  // 🎯 이번주 할 것 — 레버 종합 (데이터→행동, 측정값 직결). 각 줄 = "지표 → 바꿀 행동".
  const weeklyActions = [];
  if (couponConv && couponConv.coupons && couponConv.coupons.length) {
    const avgRate = couponConv.coupons.reduce((s, c) => s + c.rate, 0) / couponConv.coupons.length;
    if (avgRate < 5) weeklyActions.push(`💳 등급쿠폰 사용 ${avgRate.toFixed(0)}% → 발송 타이밍 D+21(소비주기)로 + 멤버십 혜택 노출`);
  }
  if (goldenZone && goldenZone.d21_35 > 0) {
    weeklyActions.push(`🔁 골든타임 ${goldenZone.d21_35}명 → 이번주 레시피 리마인드 (휴면 직전 깨우기)`);
  }
  if (pvWoW) {
    const rc = pvWoW.cur.레시피, rp = pvWoW.prev.레시피;
    if (rp && rc < rp) weeklyActions.push(`📖 레시피 PV ↓${Math.round((1 - rc / rp) * 100)}% → 상세→레시피 동선 강화 (재구매 입구)`);
    else if (rc > rp) weeklyActions.push(`📖 레시피 PV ↑ 효과 나는 중 → 상세페이지 레시피 링크 더 노출`);
  }
  const weeklyActionSection = weeklyActions.length ? `🎯 <b>이번주 할 것</b>\n${weeklyActions.join('\n')}\n\n` : '';

  const weeklyMsg = `📈 <b>이태리정미소 지난주 CX 리포트</b>
📅 ${display}
━━━━━━━━━━━━━━━━━
${weeklyActionSection}🏪 <b>자사몰 매출 (카페24)</b>
${formatMoney(cafe24This.sales)}${diff(cafe24This.sales, cafe24Last.sales)} (${cafe24This.count}건)

🔁 <b>재구매·리텐션</b> (회원, 최근 90일)
${repurchase
  ? `재구매율 ${repurchase.repurchaseRate.toFixed(1)}% (재구매 회원 ${repurchase.repeatMembers}/${repurchase.distinctMembers}명)${repurchase.avgDaysToRepeat != null ? ` · 평균 ${repurchase.avgDaysToRepeat}일 만에 재구매` : ''}
이번주 신규 ${formatMoney(repurchase.week.newAmt)}(${repurchase.week.newCount}건) vs 재구매 ${formatMoney(repurchase.week.repAmt)}(${repurchase.week.repCount}건) · 재구매 매출비중 ${repurchase.week.repShare.toFixed(0)}%${repurchase.week.guestCount ? `\n비회원 ${formatMoney(repurchase.week.guestAmt)}(${repurchase.week.guestCount}건, 식별불가)` : ''}`
  : '데이터 없음'}

💳 <b>쿠폰 전환</b> (등급쿠폰 · 미주 발송→은우 전환측정)
${couponLine}

🔁 <b>재구매 골든타임</b>
${goldenLine}

📄 <b>헤더 페이지뷰</b> (전주 대비)
${pvLine}

📡 <b>UTM 채널 효과</b> (발송→클릭→매출)
${utmLine}

📊 <b>GA4 채널</b>
${chLines}

👥 <b>신규 vs 재방문</b>
${userTypeLine}

🏠 <b>랜딩 페이지 CVR</b>
${landingLines}

🛍️ <b>상품 페이지 성과 (top 5)</b>
${productLines || '데이터 없음'}

🔽 <b>구매 퍼널 (Clarity)</b>
${funnelLine}

👁️ <b>Clarity</b>
스크롤 깊이: ${clarity?.scrollDepth?.toFixed(0)||'-'}% | 체류: ${clarity?.activeTimeSec||'-'}초
스크립트 에러: ${clarity?.scriptErrorPct?.toFixed(1)||'-'}% ${clarity ? icon(clarity.scriptErrorPct,10,30) : ''} | 빠른뒤로가기: ${clarity?.quickbackPct?.toFixed(1)||'-'}% ${clarity ? icon(clarity.quickbackPct,8,15) : ''}

💸 <b>결제 누수 추정</b>
${leakageLine}

⭐ <b>고객 리뷰</b>
${reviews ? `${reviews.count}건 | 평균 ${reviews.avg}점 | 5점 ${reviews.dist[5]}건 / 4점 ${reviews.dist[4]}건 / 3점이하 ${reviews.dist.low}건` : '데이터 없음'}`;

  const claudeMsg = analysis ? `🤖 <b>이번 주 분석</b>
━━━━━━━━━━━━━━━━━
${analysis}` : '';

  console.log('\n======= 텔레그램 전문 (주간) =======');
  console.log(weeklyMsg.replace(/<[^>]+>/g, ''));
  if (claudeMsg) { console.log('\n--- Claude 분석 ---'); console.log(claudeMsg.replace(/<[^>]+>/g, '')); }
  console.log('=====================================\n');

  const r1 = await sendTelegram(weeklyMsg);
  if (claudeMsg) await sendTelegram(claudeMsg);
  if (r1.ok) {
    console.log('주간 발송 완료 ✅');
  } else {
    console.error('발송 실패 ❌:', JSON.stringify(r1));
  }

  // 주간 스냅샷 적재 (Looker Studio 다차원 보고서용) — 지난주(완전한 주) 기준
  try {
    const wk = weekRange(1);
    await saveWeeklySnapshot(wk.start, wk.end, wk.label);
  } catch (e) { console.error('주간 스냅샷 적재 실패:', e.message); }
}

// ── 실행 ───────────────────────────────────────────────
async function main() {
  const tokenOk = await refreshCafe24Token();
  if (!tokenOk && !DRY_RUN) {
    console.error('[FATAL] cafe24 토큰 갱신 실패. 일간 발송 중단 (VPS 점검 필요).');
    await sendTelegram('🚨 <b>cafe24 토큰 만료</b>\nDrive 토큰 읽기 불가 — VPS 갱신 상태 확인 필요. 일간/주간 리포트 발송 중단.').catch(() => {});
    process.exit(1);
  }
  if (!tokenOk && DRY_RUN) console.warn('[DRY_RUN] 토큰 갱신 실패 — 진행 (메시지 미리보기 목적)');
  const mode = process.argv[2] || (isMonday() ? 'weekly' : 'daily');
  console.log(`모드: ${mode}`);
  if (mode === 'weekly') await weeklyReport();
  else if (mode === 'ux_draft') await uxDraftFlow();
  else if (mode === 'ux_send') await uxSendFlow();
  else await dailyReport();
}

// 모듈로 require될 때(personal-metrics 등)는 main 자동실행 금지
if (require.main === module) {
  main().catch(e => { console.error('에러:', e.message); process.exit(1); });
}

// personal-metrics 등 외부 스크립트에서 데이터 수집 함수 재사용
module.exports = {
  refreshCafe24Token,
  getCafe24Sales,
  getCafe24SalesByProduct,
  getCafe24DailyOrders,
  getCafe24Reviews,
  getRepurchaseStats,
  getCafe24CustomerSegments,
  enrichGuestSegmentsWithCRM,
  fetchCafe24OrdersRange,
  fetchRestockRequests,
  fetchNegativeVOC,
  fetchSongmamansContext,
  getMetaStats,
  getMetaByCampaign,
  auditMetaAdUrls,
  getGA4Weekly,
  getGA4Daily,
  getGA4Slices,
  getClarityData,
  getClarityPageStats,
  getKkulDongYiSchedule,
  buildDailySnapshot,
  saveDailySnapshot,
  getDailyBaseline,
  calculateLTVMetrics,
  generateUXInsight,
  uxDraftFlow,
  uxSendFlow,
  fetchRecentUXArticles,
  pushExternalOrdersToGA4,
  getMemos,
  getCXManagerAnalysis,
  getRecentActivities,
  getDailyMessagesFromSheet,
  getSheetsTasks,
  getClaudeAnalysis,
  buildWeeklySnapshot,
  saveWeeklySnapshot,
  backfillWeeklySnapshots,
  weekRange,
  dateStr,
  formatDate,
  ga4Fetch,
  getGA4Token,
  fetchCouponConversion,
  getRepurchaseGoldenZone,
  getPageViewWoW,
  getCompassMemos,
  getUtmChannelEffect,
};
