/* 디자인 케이스북 후보 풀 (2026-09-17)
 * report.js 가 발송 전 미발송 큐를 채울 때 웹서치 대신 여기서 꺼낸다.
 *   - 풀 파일: design_pool.json  { "A 식품": [{title,sub,point,apply,src}], "B 주방기기": [...], "D 홈페이지": [...] }
 *   - 채우기(로컬): italy-jungmiso/cx-data/bot/_stock_pool.js  — 도메인 생존검증 + 시트 중복 제외 후 저장
 *   - 꺼내기: takeFromPool() 이 풀 배열에서 제거만 하고, 저장(savePool)은 시트 적재가 성공한 뒤 호출자가 한다
 *   - 워크플로 "Save bot state" 가 줄어든 design_pool.json 을 커밋한다 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'design_pool.json');

function loadPool() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } }
function savePool(pool) { fs.writeFileSync(FILE, JSON.stringify(pool, null, 1), 'utf8'); }

const norm = (s) => String(s || '').trim().toLowerCase();
function hostOf(u) { let x = String(u || '').trim().toLowerCase(); const i = x.indexOf('://'); if (i >= 0) x = x.slice(i + 3); x = x.split('/')[0].split('?')[0]; if (x.slice(0, 4) === 'www.') x = x.slice(4); return x; }
function baseDom(u) { const h = hostOf(u); if (!h) return ''; const p = h.split('.'); if (p.length >= 3 && ['co', 'com', 'or', 'ne', 'go', 'ac'].indexOf(p[p.length - 2]) >= 0) return p.slice(-3).join('.'); return p.slice(-2).join('.'); }

/** 브랜드 풀에서 최대 want개 꺼낸다. usedTitles/usedSrcs(시트에 이미 있는 제목·출처 배열)와 겹치는 건 건너뛰고 풀에서도 버린다.
 *  꺼낸 제목·출처는 usedTitles/usedSrcs 에 push 해서 다음 브랜드가 같은 걸 또 안 꺼내게 한다. */
function takeFromPool(pool, brandKr, want, usedTitles, usedSrcs) {
  const tset = new Set((usedTitles || []).map(norm));
  const dset = new Set((usedSrcs || []).map(baseDom).filter(Boolean));
  const list = Array.isArray(pool[brandKr]) ? pool[brandKr] : [];
  const out = [], keep = [];
  for (const c of list) {
    if (!c || !c.title) continue;                                  // 깨진 항목은 버림
    const dup = tset.has(norm(c.title)) || (baseDom(c.src) && dset.has(baseDom(c.src)));
    if (dup) continue;                                             // 시트에 이미 있음 → 풀에서도 제거
    if (out.length < want) { out.push(c); tset.add(norm(c.title)); if (baseDom(c.src)) dset.add(baseDom(c.src)); if (usedTitles) usedTitles.push(c.title); if (usedSrcs) usedSrcs.push(c.src || ''); }
    else keep.push(c);
  }
  pool[brandKr] = keep;
  return out;
}

function poolDepth(pool) { return Object.keys(pool || {}).map((k) => k + ' ' + (Array.isArray(pool[k]) ? pool[k].length : 0) + '개').join(' · '); }

module.exports = { FILE, loadPool, savePool, takeFromPool, poolDepth, baseDom };
