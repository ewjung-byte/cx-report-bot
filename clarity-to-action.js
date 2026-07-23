/**
 * clarity-to-action.js — Clarity 인앱 막힘신호 → 📹클러리티_일별 시트 자동 적재
 *
 * 왜: 인스타 인앱(메타광고 유입 78%)에서 결제 막힘을 매일 숫자로 추적 = 개입 전후 효과 = 협상카드.
 *     Clarity Export API만 사용 → 로그인/브라우저 불필요, 스케줄러에서 100% 무인.
 *     (AI 요약 서술→액션은 로그인 필요해 불안정 → 요청 시 클로드가 세션에서 처리)
 *
 * 실행: node clarity-to-action.js   (스케줄러 매일 8시)
 */
const fs = require('fs');
const path = require('path');

const GAS_URL = 'https://script.google.com/macros/s/AKfycby_4WNcHLvcgCUIb3qhRi-h9_qApHSLXwCQa3_Qmw4xDNbdaZvPVeshmlGPg661KMRG/exec';
const PROJECT = 'vzm43te29q';
// ★토큰 = env(GitHub Actions 시크릿) 우선, 없으면 로컬 파일 (2026-07-23: 클라우드 무인수집으로 이관 — PC 꺼져도 수집)
const CLARITY_TOKEN = (process.env.CLARITY_TOKEN || (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'clarity_token.txt'), 'utf8').trim(); } catch (e) { return ''; } })()).trim();
const TG = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'telegram_config.json'), 'utf8')); } catch (e) { return {}; } })();

async function tgAlert(msg) {
  if (!TG.bot_token || !TG.chat_id) return;
  try { await fetch(`https://api.telegram.org/bot${TG.bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TG.chat_id, text: msg }) }); } catch (e) {}
}
async function post(action, body) {
  const r = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return r.json();
}

(async () => {
  if (!CLARITY_TOKEN) { console.error('클러리티 토큰 없음(../clarity_token.txt)'); process.exit(1); }
  let d;
  try {
    const r = await fetch(`https://www.clarity.ms/export-data/api/v1/project-live-insights?projectId=${PROJECT}&numOfDays=3&dimension1=Browser`, { headers: { Authorization: 'Bearer ' + CLARITY_TOKEN } });
    d = await r.json();
    if (!Array.isArray(d)) throw new Error('API 응답 이상: ' + JSON.stringify(d).slice(0, 120));
  } catch (e) {
    await tgAlert('⚠ 클러리티 자동수집 실패(토큰 만료?): ' + e.message);
    console.error(e.message); process.exit(2);
  }

  const inapp = (metric) => (d.find(x => x.metricName === metric)?.information || []).find(e => e.Browser === 'InstagramApp');
  const dead = inapp('DeadClickCount'), qb = inapp('QuickbackClick'), rage = inapp('RageClickCount'), scroll = inapp('ScrollDepth'), traf = inapp('Traffic');

  const nums = {
    inappSessions: traf ? parseInt(traf.totalSessionCount) : (dead ? parseInt(dead.sessionsCount) : ''),
    inappDeadPct: dead ? dead.sessionsWithMetricPercentage : '',
    inappQuickbackPct: qb ? qb.sessionsWithMetricPercentage : '',
    inappRagePct: rage ? rage.sessionsWithMetricPercentage : '',
    inappScrollDepth: scroll ? Math.round(scroll.averageScrollDepth || 0) : '',
  };

  const rn = await post('append_clarity_daily', nums);
  console.log('적재:', JSON.stringify(rn));
  console.log('인앱:', JSON.stringify(nums));
})();
