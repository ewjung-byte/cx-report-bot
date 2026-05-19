const https = require('https');
const fs = require('fs');

const TG_TOKEN     = (process.env.TG_BOT_TOKEN     || '').trim();
const GROUP_CHAT_ID = (process.env.TG_GROUP_CHAT_ID || '').toString().trim();
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const TAGS = ['/결정', '/액션', '/아이디어', '/공유', '/광고', '/소싱', '/CS', '/운영', '/디자인'];

// 태그를 토큰 단위로 정확 매칭 (대소문자 무시). "송장/CS/봇" 같은 문장 내 부분일치 오탐 방지.
function detectTags(text) {
  const tokens = text.toLowerCase().split(/\s+/);
  return TAGS.filter(tag => {
    const t = tag.toLowerCase();
    return tokens.some(tok => tok === t || tok.replace(/[^a-z0-9가-힣/]+$/, '') === t);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {}, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

function postToAppsScript(data, url) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
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

async function main() {
  let lastId = 0;
  try {
    const data = JSON.parse(fs.readFileSync('./last_update_id.json', 'utf8'));
    lastId = data.id || 0;
  } catch(e) {}

  const offset = lastId ? lastId + 1 : 0;
  const res = await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&limit=100&allowed_updates=%5B%22message%22%5D`);
  if (!res.ok || !res.result.length) {
    console.log('새 메시지 없음');
    return;
  }

  let newLastId = lastId;
  let taggedCount = 0;
  let reminderCount = 0;
  const dailyMsgs = [];

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

    const addMatch = text.match(/^\/추가\s+([\s\S]+)/);
    if (addMatch) {
      await postToAppsScript({ action: 'add_reminder', text: addMatch[1].trim(), sender, date: dateStr }, APPS_SCRIPT_URL).catch(() => {});
      reminderCount++;
      continue;
    }

    const doneMatch = text.match(/^\/완료\s+(.+)/);
    if (doneMatch) {
      const ids = doneMatch[1].trim().split(/\s+/);
      await postToAppsScript({ action: 'update_reminder_done', ids, texts: ids }, APPS_SCRIPT_URL).catch(() => {});
      continue;
    }

    // 모든 그룹 메시지를 일일대화에 저장 (요약 입력 데이터)
    dailyMsgs.push({ date: dateStr, time: timeStr, sender, isBot, text });

    const foundTags = detectTags(text);
    if (foundTags.length > 0) {
      await postToAppsScript({ action: 'save_tagged', date: dateStr, time: timeStr, sender, tags: foundTags.join(', '), text }, APPS_SCRIPT_URL).catch(() => {});
      taggedCount++;
    }
  }

  if (dailyMsgs.length > 0) {
    await postToAppsScript({ action: 'save_daily', messages: dailyMsgs }, APPS_SCRIPT_URL).catch(() => {});
  }

  fs.writeFileSync('./last_update_id.json', JSON.stringify({ id: newLastId }), 'utf8');
  console.log(`완료: 대화 ${dailyMsgs.length}개, 태그 ${taggedCount}개, 리마인드 ${reminderCount}개 (lastId: ${newLastId})`);
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
