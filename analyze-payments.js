// 결제수단 분석: 2026-01-01 ~ 현재
// GH Actions에서만 실행 (CAFE24_CLIENT_SECRET, CAFE24_REFRESH_TOKEN secrets 필요)
const https = require('https');
const fs    = require('fs');

const CAFE24_CLIENT_ID   = 'Vv3AL9nXIZ9uDs0f8CXrHA';
const CAFE24_API_VERSION = '2025-12-01';
const secret  = process.env.CAFE24_CLIENT_SECRET;
const rtoken  = process.env.CAFE24_REFRESH_TOKEN;

if (!secret || !rtoken) { console.error('CAFE24_CLIENT_SECRET / CAFE24_REFRESH_TOKEN 없음'); process.exit(1); }

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { reject(new Error(d.slice(0,300))); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const auth = Buffer.from(`${CAFE24_CLIENT_ID}:${secret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${rtoken}`;
  const res = await httpsRequest({
    hostname: 'italyjungmiso.cafe24api.com', path: '/api/v2/oauth/token', method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!res.body.access_token) { console.error('token 발급 실패:', JSON.stringify(res.body)); process.exit(1); }
  return res.body.access_token;
}

async function fetchOrders(token, startDate, endDate) {
  const orders = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const url = `https://italyjungmiso.cafe24api.com/api/v2/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=${limit}&offset=${offset}&embed=items`;
    const res = await httpsRequest({
      hostname: 'italyjungmiso.cafe24api.com',
      path: `/api/v2/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=${limit}&offset=${offset}`,
      headers: { 'Authorization': `Bearer ${token}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION }
    });
    const batch = res.body.orders || [];
    orders.push(...batch);
    console.log(`  offset ${offset}: ${batch.length}건 (누적 ${orders.length}건)`);
    if (batch.length < limit) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  return orders;
}

(async () => {
  console.log('=== 카페24 결제수단 분석 (2026-01-01 ~ 현재) ===');
  const token = await getToken();
  console.log('토큰 발급 OK');

  const orders = await fetchOrders(token, '2026-01-01', '2026-05-21');
  console.log(`\n총 주문: ${orders.length}건`);

  // payment_method 집계
  const pmCount = {};
  const memberTypes = { member: 0, guest: 0, naver_auto: 0, kakao_auto: 0, other_auto: 0 };
  const pmByMemberType = {};

  for (const o of orders) {
    const pm = o.payment_method || 'unknown';
    pmCount[pm] = (pmCount[pm] || 0) + 1;

    let mtype = 'guest';
    if (o.member_id) {
      if (o.member_id.endsWith('@n')) { mtype = 'naver_auto'; memberTypes.naver_auto++; }
      else if (o.member_id.endsWith('@k')) { mtype = 'kakao_auto'; memberTypes.kakao_auto++; }
      else if (o.member_id.includes('@')) { mtype = 'other_auto'; memberTypes.other_auto++; }
      else { mtype = 'member'; memberTypes.member++; }
    } else {
      memberTypes.guest++;
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

  console.log('\n--- 결제수단별 ---');
  Object.entries(pmCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}건 (${(v/orders.length*100).toFixed(1)}%)`);
  });

  console.log('\n--- 회원 유형별 ---');
  Object.entries(memberTypes).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}건 (${(v/orders.length*100).toFixed(1)}%)`);
  });

  console.log('\n--- 유형별 결제수단 ---');
  Object.entries(pmByMemberType).forEach(([mtype, pms]) => {
    const total = Object.values(pms).reduce((a,b)=>a+b,0);
    console.log(`  [${mtype}] ${total}건:`);
    Object.entries(pms).sort((a,b)=>b[1]-a[1]).forEach(([pm,n]) => {
      console.log(`    ${pm}: ${n}건 (${(n/total*100).toFixed(1)}%)`);
    });
  });

  console.log('\n결과 파일: payment-analysis.json');
})();
