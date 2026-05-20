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

function getMemos() {
  try {
    const data = readJson('../memo.json');
    return data.tasks || [];
  } catch(e) { return []; }
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
async function loadCafe24FromDrive() {
  const fileId = process.env.CAFE24_TOKEN_DRIVE_FILE_ID;
  if (!fileId) return null;
  if (!ga4Config.client_id || !ga4Config.refresh_token) return null;
  try {
    // GA4 OAuth refresh_token으로 access_token 발급 (drive.readonly 포함)
    const tokenBody = `client_id=${ga4Config.client_id}&client_secret=${ga4Config.client_secret}&refresh_token=${ga4Config.refresh_token}&grant_type=refresh_token`;
    const tokenRes = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
      req.on('error', reject); req.write(tokenBody); req.end();
    });
    const accessToken = tokenRes.access_token;
    if (!accessToken) return null;
    // Drive API로 파일 내용 다운로드
    const fileBody = await new Promise((resolve, reject) => {
      https.get({ hostname: 'www.googleapis.com', path: `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, headers: { 'Authorization': 'Bearer ' + accessToken } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
    });
    const token = JSON.parse(fileBody);
    // expires_at이 미래면 access_token 그대로 사용
    if (token.access_token && token.expires_at && new Date(token.expires_at) > new Date()) {
      return token.access_token;
    }
    return null;
  } catch (e) { console.error('[카페24] Drive 읽기 오류:', e.message); return null; }
}

async function refreshCafe24Token() {
  // 1순위: Drive에서 최신 access_token 직접 사용
  const fromDrive = await loadCafe24FromDrive();
  if (fromDrive) { CAFE24_ACCESS_TOKEN = fromDrive; console.log('[카페24] 토큰 갱신 완료 (drive)'); return; }

  // 2순위(fallback): 기존 Secret 기반 refresh
  const secret = process.env.CAFE24_CLIENT_SECRET;
  const rtoken = process.env.CAFE24_REFRESH_TOKEN || _cf.refresh_token;
  if (!secret || !rtoken) return;
  const auth = Buffer.from(`${CAFE24_CLIENT_ID}:${secret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${rtoken}`;
  const token = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'italyjungmiso.cafe24api.com',
      path: '/api/v2/oauth/token',
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).access_token || null); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
  if (token) { CAFE24_ACCESS_TOKEN = token; console.log('[카페24] 토큰 갱신 완료 (secret fallback)'); }
  else console.error('[카페24] 토큰 갱신 실패');
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
    const valid = allOrders.filter(o => o.paid === 'T' && o.canceled === 'F');
    return { sales: valid.reduce((s, o) => s + parseFloat(o.payment_amount || 0), 0), count: valid.length };
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
      const amt = parseFloat(o.payment_amount || 0);
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
      const amt = parseFloat(o.payment_amount || 0);
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

    const [chThis, chLast, utThis, utLast, landingRes] = await Promise.all([
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'averageSessionDuration'}], dimensions:[{name:'sessionDefaultChannelGroup'}] }),
      ga4Fetch(token, { ...base(lw), metrics:[{name:'sessions'}], dimensions:[{name:'sessionDefaultChannelGroup'}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(lw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'landingPagePlusQueryString'}], limit:5, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
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

    return { channels, userType, landings };
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
const PRODUCT_NAME = { '83': '바질페스토', '27': '룽고(빵)', '84': '광고랜딩 #84' };
const CHANNEL_KR = { 'Paid Social':'유료SNS', 'Organic Social':'자연SNS', 'Direct':'직접유입', 'Organic Search':'검색', 'Paid Other':'기타광고', 'Referral':'추천', 'Organic Shopping':'쇼핑', 'Unassigned':'미분류' };

async function getGA4Daily(dateStrYmd) {
  try {
    const token = await getGA4Token();
    const range = { startDate: dateStrYmd, endDate: dateStrYmd };
    const [chRes, pageRes] = await Promise.all([
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'sessions'},{name:'ecommercePurchases'}], dimensions:[{name:'sessionDefaultChannelGroup'}], limit: 8, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
      ga4Fetch(token, { dateRanges:[range], metrics:[{name:'screenPageViews'},{name:'sessions'}], dimensions:[{name:'pagePathPlusQueryString'}], limit: 40, orderBys:[{metric:{metricName:'screenPageViews'},desc:true}] }),
    ]);
    const channels = (chRes.rows||[]).map(r => ({
      name: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value),
      purchases: parseInt(r.metricValues[1].value),
    }));
    const products = {};
    let surlSessions = 0, totalSessions = 0;
    (pageRes.rows||[]).forEach(r => {
      const path = r.dimensionValues[0].value;
      const pv = parseInt(r.metricValues[0].value);
      const ses = parseInt(r.metricValues[1].value);
      totalSessions += ses;
      if (/^\/surl\/p\//i.test(path)) surlSessions += ses;
      const m = path.match(/product_no=(\d+)/);
      if (m) {
        const id = m[1];
        if (!products[id]) products[id] = { id, pv: 0, sessions: 0 };
        products[id].pv += pv; products[id].sessions += ses;
      }
    });
    const topProducts = Object.values(products).sort((a,b)=>b.sessions-a.sessions).slice(0,3);
    return { channels, topProducts, surlSessions, totalSessions };
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

// ── Claude 분석 ────────────────────────────────────────
async function getClaudeAnalysis(mode, data) {
  const { meta, cafe24, clarity, ga4, ga4Daily, reviews, repurchase } = data;
  const f = clarity?.funnel;

  let prompt;
  if (mode === 'daily') {
    const chLines = (ga4Daily?.channels || []).slice(0, 5).map(c => `  - ${c.name}: ${c.sessions}세션·구매 ${c.purchases} (CVR ${pct(c.purchases, c.sessions)})`).join('\n') || '  (없음)';
    const prdLines = (ga4Daily?.topProducts || []).slice(0, 3).map(p => `  - #${p.id}: ${p.sessions}세션 (${p.pv}pv)`).join('\n') || '  (없음)';
    prompt = `너는 이태리정미소(프리미엄 이탈리안 식품 쇼핑몰) CX 분석가야.
광고·매출 절대값은 다른 봇이 보고하니 보지 말고, 어제 자사몰 온사이트 행동·진입경로·상품 페이지 데이터에서 CX 이상 신호만 짧게 짚어줘.

[온사이트 행동 (Microsoft Clarity)]
- 세션: ${clarity?.totalSessions||'-'}
- 스크립트 에러율: ${clarity?.scriptErrorPct?.toFixed(1)||'-'}% (정상 10% 이하)
- 빠른 뒤로가기율: ${clarity?.quickbackPct?.toFixed(1)||'-'}% (정상 8% 이하)
- 데드클릭율: ${clarity?.deadClickPct?.toFixed(1)||'-'}%
- 스크롤 깊이: ${clarity?.scrollDepth?.toFixed(0)||'-'}% / 활성 체류: ${clarity?.activeTimeSec||'-'}초
- 인스타 인앱 비중: ${clarity?.instagramPct||'-'}%
- 온사이트 퍼널: 랜딩 ${f?.landing||0} → 상품 ${f?.product||0} → 장바구니 ${f?.cart||0} → 결제 ${f?.checkout||0}

[GA4 어제 채널별 (CVR=구매/세션)]
${chLines}

[GA4 어제 상품 페이지 top 3]
${prdLines}

[짧은URL(/surl/p/*) 세션]: ${ga4Daily?.surlSessions||0} (구매는 0으로 잡힘 → 추적 끊김 가능)

스크립트 에러·이탈·퍼널 단계 급락·채널별 CVR 격차·상품 페이지 트래픽 대비 구매 부진 위주로.
이상 신호가 있으면 축약체로 "🚨 <항목> — <핵심수치·원인 한 토막> ▶ <행동>" 한 신호당 한 줄. 완결문장·조사 최소화, 최대 4개.
이상 없으면 "✅ 특이사항 없음" 한 줄.
중요: 마크다운 기호(#, *, **, ---, >) 절대 사용하지 마. 일반 텍스트로만.`;
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

// ── 텔레그램 발송 ──────────────────────────────────────
function sendTelegram(text) {
  return postJson('api.telegram.org', `/bot${TG_TOKEN}/sendMessage`, {}, { chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
}
function sendTelegramGroup(text) {
  return postJson('api.telegram.org', `/bot${TG_TOKEN}/sendMessage`, {}, { chat_id: GROUP_CHAT_ID, text, parse_mode: 'HTML' });
}

// ── 일간 리포트 ────────────────────────────────────────
async function dailyReport() {
  const today = dateStr(1);
  const display = formatDate(today);
  console.log(`[일간] ${today}`);

  // A안 + CX 관리자 강화: Clarity(온사이트 행동) + GA4 어제(채널·상품·짧은URL 손실)
  const [clarity, sheetsTasks, ga4Daily] = await Promise.all([
    getClarityData(),
    getSheetsTasks(),
    getGA4Daily(today),
  ]);

  const analysis = await getClaudeAnalysis('daily', { clarity, ga4Daily });

  const claritySection = clarity
    ? `에러 ${clarity.scriptErrorPct.toFixed(1)}%${icon(clarity.scriptErrorPct, 10, 30)} · 뒤로 ${clarity.quickbackPct.toFixed(1)}%${icon(clarity.quickbackPct, 8, 15)} · 스크롤 ${clarity.scrollDepth.toFixed(0)}% · 체류 ${clarity.activeTimeSec}초`
    : '⚠️ 데이터 없음 (API 한도)';
  const f = clarity && clarity.funnel;
  const funnelLine = f
    ? `랜딩 ${f.landing.toLocaleString()} → 상품 ${f.product}(${pct(f.product, f.landing)}) → 장바 ${f.cart} → 결제 ${f.checkout}`
    : '-';

  // 채널별 CVR (top 4, Paid Social·Direct·Organic 등)
  let channelSection = '';
  if (ga4Daily && ga4Daily.channels.length) {
    channelSection = '\n📈 <b>어제 진입경로</b>\n' + ga4Daily.channels.slice(0, 4).map(c => {
      const nm = CHANNEL_KR[c.name] || c.name;
      return `${nm}: ${c.sessions}세션·구매 ${c.purchases} (CVR ${pct(c.purchases, c.sessions)})`;
    }).join('\n');
  }

  // 상품 디테일 페이지 top 3
  let productSection = '';
  if (ga4Daily && ga4Daily.topProducts.length) {
    productSection = '\n🛍️ <b>상품 페이지 top 3</b>\n' + ga4Daily.topProducts.map(p => {
      const nm = PRODUCT_NAME[p.id] || `상품 #${p.id}`;
      return `${nm}: ${p.sessions}세션 (${p.pv} pv)`;
    }).join('\n');
  }

  // 짧은URL 추적 손실 경보 (광고 클릭 → 구매 추적 끊김 의심)
  let alertSection = '';
  if (ga4Daily) {
    const paidSoc = ga4Daily.channels.find(c => c.name === 'Paid Social');
    if (paidSoc && paidSoc.sessions >= 50 && paidSoc.purchases / Math.max(paidSoc.sessions, 1) < 0.005) {
      alertSection = `\n🚨 <b>유료SNS CVR ${pct(paidSoc.purchases, paidSoc.sessions)}</b> — 광고 트래픽 구매 미연결 (짧은URL/${ga4Daily.surlSessions}세션 추적 누수 또는 결제 마찰 의심)`;
    }
  }

  const msg = `🔎 <b>CX 일간</b> · ${display}
━━━━━━━━━━━━━━━━━
👁️ <b>온사이트 행동</b>  ${claritySection}
🔽 <b>온사이트 퍼널</b>  ${funnelLine}${channelSection}${productSection}${alertSection}
<i>광고·매출은 송마망 봇 리포트 참고</i>`;

  const analysisMsg = analysis ? `🤖 <b>CX 이상 신호</b>\n${analysis}` : null;

  console.log('\n======= 텔레그램 전문 =======');
  console.log(msg.replace(/<[^>]+>/g, ''));
  if (analysisMsg) { console.log('\n--- Claude 분석 ---\n' + analysisMsg); }
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

  const memos = getMemos();
  let memoSection = '';
  if (memos.length > 0) {
    const urgentItems = memos.filter(t => t.urgent && !t.done);
    const normalItems = memos.filter(t => !t.urgent && !t.done);
    const doneItems   = memos.filter(t => t.done);
    let lines = '';
    if (urgentItems.length) lines += urgentItems.map(t => `🚨 ${t.text}`).join('\n') + '\n';
    if (normalItems.length) lines += normalItems.map(t => `• ${t.text}`).join('\n') + '\n';
    if (doneItems.length)   lines += doneItems.map(t => `• <s>${t.text}</s>`).join('\n');
    memoSection = `\n📝 <b>은우 메모</b>\n${lines.trim()}`;
  }

  // 역할 고정(2026-05-20): 회의록/일일대화/리마인드는 미주 통합 영역. 은우봇은 CX 행동·이상신호 + 개인 할일/메모만 발송.
  // (processTelegramMessages/getRemindersFromSheet/saveMeetingNotes/getDailyMessagesFromSheet 함수는 personal-metrics 등 추후 재사용 위해 export 유지)

  // 개인 DM: 할일 + 메모만
  const personalMsg = `☀️ <b>오늘 할일</b>${tasksSection}${memoSection}`;

  const groupResult = await sendTelegramGroup(msg);
  if (groupResult.ok) {
    if (analysisMsg) await sendTelegramGroup(analysisMsg);
    if (tasksSection || memoSection) await sendTelegram(personalMsg);
    console.log('일간 발송 완료 ✅');
  } else {
    console.error('발송 실패 ❌:', JSON.stringify(groupResult));
  }
}

// ── 주간 리포트 (월요일) ────────────────────────────────
async function weeklyReport() {
  const thisStart = dateStr(7), thisEnd = dateStr(1);
  const display = `${formatDate(thisStart)} ~ ${formatDate(thisEnd)}`;
  console.log(`[주간] ${display}`);

  const [metaThis, metaLast, cafe24This, cafe24Last, clarity, ga4, reviews, repurchase] = await Promise.all([
    getMetaStats(thisStart, thisEnd),
    getMetaStats(dateStr(14), dateStr(8)),
    getCafe24Sales(thisStart, thisEnd),
    getCafe24Sales(dateStr(14), dateStr(8)),
    getClarityData(),
    getGA4Weekly(),
    getCafe24Reviews(thisStart, thisEnd),
    getRepurchaseStats(90, thisStart, thisEnd),
  ]);

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

  const weeklyMsg = `📈 <b>이태리정미소 지난주 CX 리포트</b>
📅 ${display}
━━━━━━━━━━━━━━━━━
💰 <b>메타 광고</b>
광고비: ${formatMoney(metaThis.spend)}${diff(metaThis.spend, metaLast.spend)}
ROAS: ${metaThis.roas}%${diff(parseFloat(metaThis.roas), parseFloat(metaLast.roas))} | 구매: ${metaThis.purchases}건
도달: ${metaThis.reach.toLocaleString()} | 빈도: ${metaThis.frequency.toFixed(1)}회 | CPM: ${formatMoney(metaThis.cpm)}

🏪 <b>자사몰 매출 (카페24)</b>
${formatMoney(cafe24This.sales)}${diff(cafe24This.sales, cafe24Last.sales)} (${cafe24This.count}건)

🔁 <b>재구매·리텐션</b> (회원, 최근 90일)
${repurchase
  ? `재구매율 ${repurchase.repurchaseRate.toFixed(1)}% (재구매 회원 ${repurchase.repeatMembers}/${repurchase.distinctMembers}명)${repurchase.avgDaysToRepeat != null ? ` · 평균 ${repurchase.avgDaysToRepeat}일 만에 재구매` : ''}
이번주 신규 ${formatMoney(repurchase.week.newAmt)}(${repurchase.week.newCount}건) vs 재구매 ${formatMoney(repurchase.week.repAmt)}(${repurchase.week.repCount}건) · 재구매 매출비중 ${repurchase.week.repShare.toFixed(0)}%${repurchase.week.guestCount ? `\n비회원 ${formatMoney(repurchase.week.guestAmt)}(${repurchase.week.guestCount}건, 식별불가)` : ''}`
  : '데이터 없음'}

📊 <b>GA4 채널</b>
${chLines}

👥 <b>신규 vs 재방문</b>
${userTypeLine}

🏠 <b>랜딩 페이지 CVR</b>
${landingLines}

🔽 <b>구매 퍼널 (Clarity)</b>
${funnelLine}

👁️ <b>Clarity</b>
스크롤 깊이: ${clarity?.scrollDepth?.toFixed(0)||'-'}% | 체류: ${clarity?.activeTimeSec||'-'}초
스크립트 에러: ${clarity?.scriptErrorPct?.toFixed(1)||'-'}% ${clarity ? icon(clarity.scriptErrorPct,10,30) : ''} | 빠른뒤로가기: ${clarity?.quickbackPct?.toFixed(1)||'-'}% ${clarity ? icon(clarity.quickbackPct,8,15) : ''}

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
}

// ── 실행 ───────────────────────────────────────────────
async function main() {
  await refreshCafe24Token();
  const mode = process.argv[2] || (isMonday() ? 'weekly' : 'daily');
  console.log(`모드: ${mode}`);
  if (mode === 'weekly') await weeklyReport();
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
  getCafe24Reviews,
  getRepurchaseStats,
  getMetaStats,
  getGA4Weekly,
  getClarityData,
  getSheetsTasks,
  dateStr,
  formatDate,
};
