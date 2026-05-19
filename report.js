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

// ── GAS 기반 메시지/리마인드 조회 (웹훅 전환 후) ───────
async function getDailyMessages(date) {
  try {
    const res = await postToAppsScript({ action: 'get_daily_messages', date }, APPS_SCRIPT_URL);
    return res.messages || [];
  } catch(e) { console.error('[메시지 조회 오류]', e.message); return []; }
}

async function getRemindersFromSheet() {
  try {
    const res = await postToAppsScript({ action: 'get_reminders' }, APPS_SCRIPT_URL);
    return res.reminders || [];
  } catch(e) { console.error('[리마인드 조회 오류]', e.message); return []; }
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
    const tgSummary = `📋 <b>어제 단톡방 요약</b> (${date})
━━━━━━━━━━━━━━━━━
<b>${notes.title}</b>
👥 ${notes.participants}${notes.agenda ? `\n\n📌 안건\n${notes.agenda}` : ''}${notes.decisions ? `\n\n✅ 결정사항\n${notes.decisions}` : ''}${notes.actions ? `\n\n🎯 액션아이템\n${notes.actions}` : ''}${notes.notes ? `\n\n💬 메모\n${notes.notes}` : ''}`;
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

// ── 카페24 토큰 자동 갱신 (GitHub Actions용) ───────────
async function refreshCafe24Token() {
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
  if (token) { CAFE24_ACCESS_TOKEN = token; console.log('[카페24] 토큰 갱신 완료'); }
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
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'conversions'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(lw), metrics:[{name:'sessions'},{name:'conversions'}], dimensions:[{name:'newVsReturning'}] }),
      ga4Fetch(token, { ...base(tw), metrics:[{name:'sessions'},{name:'conversions'}], dimensions:[{name:'landingPagePlusQueryString'}], limit:5, orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
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
  const { meta, cafe24, clarity, ga4, reviews } = data;
  const f = clarity?.funnel;

  let prompt;
  if (mode === 'daily') {
    const productLines = Object.entries(cafe24?.byProduct||{})
      .sort((a,b)=>b[1].count-a[1].count)
      .map(([name, v]) => `  - ${name}: ${v.count}건`).join('\n');
    prompt = `너는 이태리정미소(프리미엄 이탈리안 식품 쇼핑몰) CX 분석가야.
오늘 일간 데이터에서 이상 신호나 즉각 대응이 필요한 것만 짧게 알려줘.

[오늘 데이터]
- 메타 광고비: ${formatMoney(meta.spend)} / ROAS: ${meta.roas}% / 구매: ${meta.purchases}건
- CPM: ${formatMoney(meta.cpm)} / 빈도: ${meta.frequency.toFixed(1)}회 / 도달: ${meta.reach.toLocaleString()}명
- 전환 퍼널: 랜딩 ${meta.landing} → 조회 ${meta.viewContent} → 장바구니 ${meta.addToCart} → 결제 ${meta.checkout} → 구매 ${meta.purchases}
- 자사몰 매출: ${formatMoney(cafe24.totalSales)} (${cafe24.count}건)
- 스크립트 에러: ${clarity?.scriptErrorPct?.toFixed(1)||'-'}%
- 빠른 뒤로가기: ${clarity?.quickbackPct?.toFixed(1)||'-'}%
- 상품별 판매:
${productLines}

이상 신호가 있으면 "🚨 [항목]: [원인 추정] → [즉각 행동]" 형식으로.
이상 없으면 "✅ 오늘 특이사항 없음" 한 줄로.
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
- GA4 신규 전환율: ${pct(ga4?.userType?.cur?.new?.conv, ga4?.userType?.cur?.new?.sessions)} / 재방문 전환율: ${pct(ga4?.userType?.cur?.ret?.conv, ga4?.userType?.cur?.ret?.sessions)}
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
  const sameWeekday = dateStr(2);
  const w7start = dateStr(7);
  const w14start = dateStr(14);
  const w8end = dateStr(8);
  const display = formatDate(today);
  console.log(`[일간] ${today}`);

  const [cafe24, meta, metaPrev, clarity, sheetsTasks, cafe24Week, metaWeek, cafe24PrevWeek, metaPrevWeek] = await Promise.all([
    getCafe24SalesByProduct(today),
    getMetaStats(today, today),
    getMetaStats(sameWeekday, sameWeekday),
    getClarityData(),
    getSheetsTasks(),
    getCafe24Sales(w7start, today),
    getMetaStats(w7start, today),
    getCafe24Sales(w14start, w8end),
    getMetaStats(w14start, w8end),
  ]);

  const analysis = await getClaudeAnalysis('daily', { meta, cafe24, clarity });

  const cpa = meta.spend > 0 && meta.purchases > 0 ? formatMoney(meta.spend / meta.purchases) : '-';

  const p83 = cafe24.byProduct['83'] || { amount: 0, count: 0 };
  const metaRoas = meta.spend > 0 && p83.amount > 0 ? ((p83.amount / meta.spend) * 100).toFixed(0) : '-';

  const weekRoas = metaWeek.spend > 0 && cafe24Week.sales > 0 ? ((cafe24Week.sales / metaWeek.spend) * 100).toFixed(0) : '-';
  const weekCpa  = metaWeek.spend > 0 && metaWeek.purchases > 0 ? formatMoney(metaWeek.spend / metaWeek.purchases) : '-';
  const prevWeekRoas = metaPrevWeek.spend > 0 && cafe24PrevWeek.sales > 0 ? ((cafe24PrevWeek.sales / metaPrevWeek.spend) * 100).toFixed(0) : '-';
  const prevWeekCpa  = metaPrevWeek.spend > 0 && metaPrevWeek.purchases > 0 ? formatMoney(metaPrevWeek.spend / metaPrevWeek.purchases) : '-';

  const claritySection = clarity
    ? `스크립트 에러: ${clarity.scriptErrorPct.toFixed(1)}% ${icon(clarity.scriptErrorPct, 10, 30)}
빠른 뒤로가기: ${clarity.quickbackPct.toFixed(1)}% ${icon(clarity.quickbackPct, 8, 15)}
스크롤 깊이: ${clarity.scrollDepth.toFixed(0)}%  |  체류: ${clarity.activeTimeSec}초`
    : '⚠️ 오늘 데이터 없음 (API 한도 초과)';

  const msg = `📊 <b>이태리정미소 일간 리포트</b>
📅 ${display}
━━━━━━━━━━━━━━━━━

💰 <b>메타 광고</b>
광고비: ${formatMoney(meta.spend)}${diff(meta.spend, metaPrev.spend)}  |  랜딩: #83
노출 ${meta.impressions.toLocaleString()}  |  도달 ${meta.reach.toLocaleString()}  |  빈도 ${meta.frequency.toFixed(1)}회
CTR ${meta.ctr.toFixed(1)}%  |  CPM ${formatMoney(meta.cpm)}${meta.frequency >= 3 ? '\n⚠️ 빈도 3회 이상 — 소재 교체 검토' : ''}

🛒 <b>전환 퍼널</b>
랜딩 ${meta.landing}  →  조회 ${meta.viewContent}  →  장바구니 ${meta.addToCart}  →  결제 ${meta.checkout}  →  구매 ${meta.purchases}건${diffCount(meta.purchases, metaPrev.purchases)}
ROAS ${meta.roas}%  |  CPA ${cpa}  |  전환율 ${pct(meta.purchases, meta.clicks)}
━━━━━━━━━━━━━━━━━

🏪 <b>메타 광고 결과 (바질페스토 #83 기준)</b>
메타 매출: ${formatMoney(p83.amount)} (${p83.count}건)
자사몰 전체: ${formatMoney(cafe24.totalSales)} (${cafe24.count}건, 참고)
메타 ROAS: ${metaRoas}%

📊 <b>주별 성과 비교</b>
<b>이번 주</b> (${formatDate(w7start)} ~ ${display})
광고비: ${formatMoney(metaWeek.spend)}${diff(metaWeek.spend, metaPrevWeek.spend)}  |  구매: ${metaWeek.purchases}건${diffCount(metaWeek.purchases, metaPrevWeek.purchases)}
자사몰 매출: ${formatMoney(cafe24Week.sales)}${diff(cafe24Week.sales, cafe24PrevWeek.sales)}
CPA: ${weekCpa}  |  ROAS: ${weekRoas}%
<b>전주</b> (${formatDate(w14start)} ~ ${formatDate(w8end)})
광고비: ${formatMoney(metaPrevWeek.spend)}  |  구매: ${metaPrevWeek.purchases}건
자사몰 매출: ${formatMoney(cafe24PrevWeek.sales)}
CPA: ${prevWeekCpa}  |  ROAS: ${prevWeekRoas}%
━━━━━━━━━━━━━━━━━

👁️ <b>Clarity</b>
${claritySection}`;

  const analysisMsg = analysis ? `🤖 이상 신호 분석\n━━━━━━━━━━━━━━━━━\n${analysis}` : null;

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
    tasksSection = `\n━━━━━━━━━━━━━━━━━\n📋 <b>이번 주 전략 할일</b>\n⭐ ${statusIcon} ${oneThingFormatted}`;
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
    memoSection = `\n━━━━━━━━━━━━━━━━━\n📝 <b>은우 메모</b>\n${lines.trim()}`;
  }

  const yesterday = dateStr(1);
  const [groupMessages, activeReminders] = await Promise.all([
    getDailyMessages(yesterday),
    getRemindersFromSheet(),
  ]);
  if (groupMessages.length > 0) await saveMeetingNotes(groupMessages, yesterday);

  if (activeReminders.length > 0) {
    const lines = activeReminders.map(r => `[${r.id}] ${r.text}`).join('\n');
    const remindMsg = `🔁 <b>진행 중 리마인드</b>\n━━━━━━━━━━━━━━━━━\n${lines}\n<i>완료 → /완료 번호</i>`;
    await sendTelegramGroup(remindMsg);
  }

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

  const [metaThis, metaLast, cafe24This, cafe24Last, clarity, ga4, reviews] = await Promise.all([
    getMetaStats(thisStart, thisEnd),
    getMetaStats(dateStr(14), dateStr(8)),
    getCafe24Sales(thisStart, thisEnd),
    getCafe24Sales(dateStr(14), dateStr(8)),
    getClarityData(),
    getGA4Weekly(),
    getCafe24Reviews(thisStart, thisEnd),
  ]);

  const analysis = await getClaudeAnalysis('weekly', { meta: metaThis, cafe24: cafe24This, clarity, ga4, reviews });

  const chMap = { 'Paid Social':'유료SNS', 'Organic Social':'자연SNS', 'Direct':'직접유입', 'Organic Search':'검색', 'Paid Other':'기타광고' };
  const chLines = Object.entries(ga4?.channels||{}).sort((a,b)=>b[1].cur.sessions-a[1].cur.sessions).slice(0,4).map(([ch, v]) =>
    `${chMap[ch]||ch}: ${v.cur.sessions}명${diff(v.cur.sessions, v.prev.sessions)}`
  ).join('\n');

  const f = clarity?.funnel;
  const funnelLine = f ? `랜딩 ${f.landing.toLocaleString()} → 상품 ${f.product}(${pct(f.product,f.landing)}) → 장바구니 ${f.cart}(${pct(f.cart,f.landing)}) → 구매 ${f.checkout}(${pct(f.checkout,f.landing)})` : '-';

  const ut = ga4?.userType?.cur;
  const utPrev = ga4?.userType?.prev;
  const userTypeLine = ut
    ? `신규: ${ut.new.sessions.toLocaleString()}명 | 전환 ${pct(ut.new.conv, ut.new.sessions)}${diff(ut.new.conv/Math.max(ut.new.sessions,1)*100, utPrev?.new?.conv/Math.max(utPrev?.new?.sessions||1,1)*100)}
재방문: ${ut.ret.sessions.toLocaleString()}명 | 전환 ${pct(ut.ret.conv, ut.ret.sessions)}${diff(ut.ret.conv/Math.max(ut.ret.sessions,1)*100, utPrev?.ret?.conv/Math.max(utPrev?.ret?.sessions||1,1)*100)}`
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

main().catch(e => { console.error('에러:', e.message); process.exit(1); });
