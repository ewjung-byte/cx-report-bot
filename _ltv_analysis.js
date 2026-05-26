// 회원ID 기반 LTV 트래커 — cafe24 raw 365일 lookback
// 목적: VIP 식별 · 매출 집중도 · 코호트 retention · 회원/게스트 LTV 비교
const r = require('./report.js');

const today = new Date();
const fmt = d => d.toISOString().slice(0, 10);
const days = n => new Date(today.getTime() - n * 86400000);

(async () => {
  await r.refreshCafe24Token();

  const start = fmt(days(365));
  const end = fmt(days(0));
  console.log(`[Fetch] cafe24 orders ${start} ~ ${end}`);
  const orders = await r.fetchCafe24OrdersRange(start, end);
  console.log(`  → 유효 주문 ${orders.length}건`);

  if (orders.length === 0) {
    console.log('주문 0건 — token 만료 가능. 종료.');
    return;
  }

  // 회원/게스트 분리 + 식별자 통일
  const tel = o => String(o.buyer_cellular || o.buyer_phone || '').replace(/[^0-9]/g, '');
  const email = o => String(o.buyer_email || '').toLowerCase().trim();
  const memberId = o => (o.member_id || '').trim();

  // 회원 단위 집계 (회원 ID 우선, 없으면 phone, 없으면 email)
  const customers = {};
  let memberOrderCount = 0, guestOrderCount = 0;
  for (const o of orders) {
    const mid = memberId(o);
    const ph = tel(o);
    const em = email(o);
    let key, type;
    if (mid) { key = 'M:' + mid; type = 'member'; memberOrderCount++; }
    else if (ph && ph.length >= 10) { key = 'P:' + ph; type = 'guest_phone'; guestOrderCount++; }
    else if (em) { key = 'E:' + em; type = 'guest_email'; guestOrderCount++; }
    else continue;

    if (!customers[key]) customers[key] = { type, orders: [], revenue: 0, products: new Set() };
    customers[key].orders.push(o);
    customers[key].revenue += Number(o.payment_amount || 0);
    // 상품 누적
    if (o.items && Array.isArray(o.items)) o.items.forEach(it => customers[key].products.add(it.product_no));
  }

  const list = Object.entries(customers).map(([key, c]) => {
    const dates = c.orders.map(o => String(o.order_date || '').slice(0,10)).filter(d => d).sort();
    return {
      key,
      type: c.type,
      orders: c.orders.length,
      revenue: c.revenue,
      first: dates[0] || '',
      last: dates[dates.length - 1] || '',
      products: c.products.size,
      aov: c.orders.length > 0 ? Math.round(c.revenue / c.orders.length) : 0,
    };
  });

  console.log(`\n[기본 통계]`);
  console.log(`  총 고객(unique): ${list.length}명`);
  console.log(`  회원 단위: ${list.filter(c=>c.type==='member').length}명 · ${memberOrderCount}건`);
  console.log(`  게스트(phone): ${list.filter(c=>c.type==='guest_phone').length}명 · ${guestOrderCount}건`);
  console.log(`  게스트(email only): ${list.filter(c=>c.type==='guest_email').length}명`);

  // === 1. 매출 집중도 (파레토) ===
  console.log(`\n[1. 매출 집중도 — 파레토 분석]`);
  const totalRev = list.reduce((a, c) => a + c.revenue, 0);
  const sortedByRev = [...list].sort((a, b) => b.revenue - a.revenue);
  let cum = 0;
  const breakpoints = [0.10, 0.20, 0.50, 0.80];
  let bIdx = 0;
  for (let i = 0; i < sortedByRev.length; i++) {
    cum += sortedByRev[i].revenue;
    const pct = cum / totalRev;
    if (bIdx < breakpoints.length && pct >= breakpoints[bIdx]) {
      console.log(`  매출 ${(breakpoints[bIdx]*100).toFixed(0)}% = 상위 ${i+1}명 (${((i+1)/list.length*100).toFixed(1)}%)`);
      bIdx++;
    }
  }
  console.log(`  총 매출: ${totalRev.toLocaleString()}원 / 평균 LTV: ${Math.round(totalRev/list.length).toLocaleString()}원`);

  // === 2. 재구매 횟수 분포 ===
  console.log(`\n[2. 재구매 횟수 분포]`);
  const dist = {1:0, 2:0, 3:0, 4:0, 5:0, 'over6':0};
  list.forEach(c => {
    if (c.orders >= 6) dist.over6++;
    else dist[c.orders]++;
  });
  Object.entries(dist).forEach(([k,v]) => {
    const pct = (v / list.length * 100).toFixed(1);
    console.log(`  ${k}회 구매: ${v}명 (${pct}%)`);
  });
  const repurchasers = list.filter(c => c.orders >= 2);
  console.log(`  → 재구매율: ${(repurchasers.length / list.length * 100).toFixed(1)}% (${repurchasers.length}명/${list.length}명)`);

  // === 3. 회원 vs 게스트 LTV 비교 ===
  console.log(`\n[3. 회원 vs 게스트 LTV 비교]`);
  const members = list.filter(c => c.type === 'member');
  const guests = list.filter(c => c.type !== 'member');
  const avgRev = arr => arr.length > 0 ? Math.round(arr.reduce((a,c)=>a+c.revenue,0) / arr.length) : 0;
  const avgOrd = arr => arr.length > 0 ? (arr.reduce((a,c)=>a+c.orders,0) / arr.length).toFixed(2) : 0;
  console.log(`  회원: 평균 LTV ${avgRev(members).toLocaleString()}원 · 평균 주문수 ${avgOrd(members)}`);
  console.log(`  게스트: 평균 LTV ${avgRev(guests).toLocaleString()}원 · 평균 주문수 ${avgOrd(guests)}`);
  console.log(`  → 회원 LTV가 게스트 대비 ${(avgRev(members)/avgRev(guests)).toFixed(2)}배`);

  // === 4. 코호트 retention (월별) ===
  console.log(`\n[4. 코호트 retention — 첫 구매월 기준]`);
  const cohort = {};
  list.forEach(c => {
    const m = c.first.slice(0,7);
    if (!m) return;
    if (!cohort[m]) cohort[m] = [];
    cohort[m].push(c);
  });
  const months = Object.keys(cohort).sort();
  console.log('  월별 | 첫구매자 | 재구매(2+) | 재구매율 | 평균 LTV');
  months.forEach(m => {
    const cs = cohort[m];
    const rp = cs.filter(c => c.orders >= 2).length;
    const ltv = Math.round(cs.reduce((a,c)=>a+c.revenue,0) / cs.length);
    console.log(`  ${m} | ${cs.length}명 | ${rp}명 | ${(rp/cs.length*100).toFixed(1)}% | ${ltv.toLocaleString()}원`);
  });

  // === 5. VIP top 10 ===
  console.log(`\n[5. VIP top 10 (revenue 기준)]`);
  console.log('  순위 | 식별자 | 주문수 | 총매출 | 평균주문 | 첫구매 | 최근구매');
  sortedByRev.slice(0, 10).forEach((c, i) => {
    const k = c.key.slice(0, 16);
    console.log(`  ${i+1}. ${k} | ${c.orders}건 | ${c.revenue.toLocaleString()}원 | ${c.aov.toLocaleString()}원 | ${c.first} | ${c.last}`);
  });

  // === 6. 매출 기여 — 회원 vs 게스트 ===
  console.log(`\n[6. 매출 기여도]`);
  const memberRev = members.reduce((a,c)=>a+c.revenue,0);
  const guestRev = guests.reduce((a,c)=>a+c.revenue,0);
  console.log(`  회원 매출: ${memberRev.toLocaleString()}원 (${(memberRev/totalRev*100).toFixed(1)}%)`);
  console.log(`  게스트 매출: ${guestRev.toLocaleString()}원 (${(guestRev/totalRev*100).toFixed(1)}%)`);

  // === 7. 휴면·이탈 위험 ===
  console.log(`\n[7. 휴면·이탈 위험 (마지막 구매일 기준)]`);
  const now = today.getTime();
  const buckets = {'0-30일': 0, '31-60일': 0, '61-90일': 0, '91-180일': 0, '180일+': 0};
  list.forEach(c => {
    if (!c.last) return;
    const daysSince = Math.floor((now - new Date(c.last+'T00:00:00Z').getTime()) / 86400000);
    if (daysSince <= 30) buckets['0-30일']++;
    else if (daysSince <= 60) buckets['31-60일']++;
    else if (daysSince <= 90) buckets['61-90일']++;
    else if (daysSince <= 180) buckets['91-180일']++;
    else buckets['180일+']++;
  });
  Object.entries(buckets).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}명 (${(v/list.length*100).toFixed(1)}%)`);
  });

  // === 8. 인사이트 도출 — 변경 액션 후보 ===
  console.log(`\n[8. 변경 액션 인사이트]`);
  const top10pct = Math.ceil(list.length * 0.1);
  const top10Rev = sortedByRev.slice(0, top10pct).reduce((a,c)=>a+c.revenue,0);
  console.log(`  ▶ 상위 10%(${top10pct}명)가 매출 ${(top10Rev/totalRev*100).toFixed(1)}% 차지`);

  const dormant90 = list.filter(c => {
    if (!c.last) return false;
    const ds = Math.floor((now - new Date(c.last+'T00:00:00Z').getTime()) / 86400000);
    return ds >= 90 && ds <= 180 && c.orders >= 2;
  });
  console.log(`  ▶ 90~180일 휴면 + 과거 2회+ 구매자: ${dormant90.length}명 (윈백 캠페인 타겟)`);

  const oneTime = list.filter(c => c.orders === 1 && c.revenue >= 30000);
  console.log(`  ▶ 1회 구매 + 3만원+ 결제자: ${oneTime.length}명 (재구매 후크 타겟)`);

  const guestHighValue = guests.filter(c => c.revenue >= 50000);
  console.log(`  ▶ 5만원+ 게스트: ${guestHighValue.length}명 (회원전환 우선 타겟)`);

  // export raw 일부
  const fs = require('fs');
  fs.writeFileSync('./_ltv_dormant_winback.json', JSON.stringify(dormant90.map(c=>({key:c.key, orders:c.orders, revenue:c.revenue, last:c.last})), null, 2));
  fs.writeFileSync('./_ltv_top_vip.json', JSON.stringify(sortedByRev.slice(0, 50).map(c=>({key:c.key, orders:c.orders, revenue:c.revenue, first:c.first, last:c.last})), null, 2));
  console.log(`\n  → dormant_winback / top_vip JSON 저장 (개인정보 보호용 raw 출력)`);
})().catch(e => console.error('FATAL:', e));
