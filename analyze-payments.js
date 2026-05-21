// 결제수단 분석: 2026-01-01 ~ 현재
// GH Actions에서만 실행 (GA4 + CAFE24 secrets 필요)
const https = require('https');
const fs    = require('fs');

const CAFE24_CLIENT_ID   = 'Vv3AL9nXIZ9uDs0f8CXrHA';
const CAFE24_API_VERSION = '2025-12-01';
const secret = process.env.CAFE24_CLIENT_SECRET;

const ga4 = {
  client_id:     process.env.GA4_CLIENT_ID     || '',
  client_secret: process.env.GA4_CLIENT_SECRET || '',
  refresh_token: process.env.GA4_REFRESH_TOKEN || '',
};

function post(hostname, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...extraHeaders }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d.slice(0,300))); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function get(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { reject(new Error(d.slice(0,300))); } });
    }).on('error', reject);
  });
}

// Drive에서 최신 cafe24 토큰 파일 읽기 (report.js와 동일 패턴)
async function loadTokenFromDrive() {
  const fileId = process.env.CAFE24_TOKEN_DRIVE_FILE_ID;
  if (!fileId || !ga4.client_id || !ga4.refresh_token) return null;
  try {
    const tokenRes = await post('oauth2.googleapis.com', '/token',
      `client_id=${ga4.client_id}&client_secret=${ga4.client_secret}&refresh_token=${ga4.refresh_token}&grant_type=refresh_token`
    );
    if (!tokenRes.access_token) { console.error('[Drive] GA4 토큰 실패:', JSON.stringify(tokenRes)); return null; }
    const fileRes = await new Promise((resolve, reject) => {
      https.get({
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        headers: { 'Authorization': 'Bearer ' + tokenRes.access_token }
      }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }).on('error', reject);
    });
    return JSON.parse(fileRes);
  } catch (e) { console.error('[Drive] 읽기 오류:', e.message); return null; }
}

async function cafe24Refresh(refreshToken) {
  if (!secret || !refreshToken) return null;
  const auth = Buffer.from(`${CAFE24_CLIENT_ID}:${secret}`).toString('base64');
  const res = await post('italyjungmiso.cafe24api.com', '/api/v2/oauth/token',
    `grant_type=refresh_token&refresh_token=${refreshToken}`,
    { 'Authorization': `Basic ${auth}` }
  );
  return res.access_token || null;
}

async function getAccessToken() {
  const drive = await loadTokenFromDrive();
  if (drive) {
    // Drive의 access_token 검증
    const r = await get('italyjungmiso.cafe24api.com', '/api/v2/admin/products?limit=1', {
      'Authorization': 'Bearer ' + drive.access_token,
      'X-Cafe24-Api-Version': CAFE24_API_VERSION
    });
    if (r.status === 200) { console.log('[토큰] Drive access_token 유효'); return drive.access_token; }
    // 만료됐으면 Drive의 refresh_token으로 신규 발급
    if (drive.refresh_token) {
      const newAt = await cafe24Refresh(drive.refresh_token);
      if (newAt) { console.log('[토큰] Drive refresh_token으로 갱신 성공'); return newAt; }
    }
  }
  console.error('[토큰] Drive 방식 실패 — secret fallback 시도');
  const newAt = await cafe24Refresh(process.env.CAFE24_REFRESH_TOKEN);
  if (newAt) { console.log('[토큰] Secret refresh_token으로 갱신 성공'); return newAt; }
  throw new Error('access_token 발급 실패');
}

async function fetchOrders(token, startDate, endDate) {
  const orders = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const r = await get('italyjungmiso.cafe24api.com',
      `/api/v2/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=${limit}&offset=${offset}`,
      { 'Authorization': `Bearer ${token}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION }
    );
    if (r.status !== 200) { console.error('주문 API 오류:', r.status, JSON.stringify(r.body).slice(0,200)); break; }
    const batch = r.body.orders || [];
    orders.push(...batch);
    process.stdout.write(`\r  수집 중: ${orders.length}건...`);
    if (batch.length < limit) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('');
  return orders;
}

(async () => {
  console.log('=== 카페24 결제수단 분석 (2026-01-01 ~ 2026-05-21) ===');
  const token = await getAccessToken();

  const orders = await fetchOrders(token, '2026-01-01', '2026-05-21');
  console.log(`총 주문: ${orders.length}건\n`);

  const pmCount = {};
  const memberTypes = { member: 0, guest: 0, naver_auto: 0, kakao_auto: 0, other_auto: 0 };
  const pmByMemberType = {};

  for (const o of orders) {
    const pm = o.payment_method || 'unknown';
    pmCount[pm] = (pmCount[pm] || 0) + 1;

    let mtype;
    if (!o.member_id) {
      mtype = 'guest';
      memberTypes.guest++;
    } else if (o.member_id.endsWith('@n')) {
      mtype = 'naver_auto'; memberTypes.naver_auto++;
    } else if (o.member_id.endsWith('@k')) {
      mtype = 'kakao_auto'; memberTypes.kakao_auto++;
    } else if (o.member_id.includes('@')) {
      mtype = 'other_auto'; memberTypes.other_auto++;
    } else {
      mtype = 'member'; memberTypes.member++;
    }

    if (!pmByMemberType[mtype]) pmByMemberType[mtype] = {};
    pmByMemberType[mtype][pm] = (pmByMemberType[mtype][pm] || 0) + 1;
  }

  const result = {
    period: '2026-01-01 ~ 2026-05-21',
    total_orders: orders.length,
    payment_method: pmCount,
    member_types: memberTypes,
    payment_by_member_type: pmByMemberType,
    generated_at: new Date().toISOString()
  };

  fs.writeFileSync('payment-analysis.json', JSON.stringify(result, null, 2), 'utf8');

  console.log('--- 결제수단별 ---');
  const total = orders.length;
  Object.entries(pmCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}건 (${(v/total*100).toFixed(1)}%)`);
  });

  console.log('\n--- 회원 유형 ---');
  Object.entries(memberTypes).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}건 (${(v/total*100).toFixed(1)}%)`);
  });

  console.log('\n--- 유형별 결제수단 ---');
  Object.entries(pmByMemberType).forEach(([mtype, pms]) => {
    const subtotal = Object.values(pms).reduce((a,b)=>a+b,0);
    console.log(`  [${mtype}] ${subtotal}건:`);
    Object.entries(pms).sort((a,b)=>b[1]-a[1]).forEach(([pm,n]) => {
      console.log(`    ${pm}: ${n}건 (${(n/subtotal*100).toFixed(1)}%)`);
    });
  });

  console.log('\n결과 저장: payment-analysis.json');
})();
