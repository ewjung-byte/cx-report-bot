var SHEET_ID = '1pBqKnyOQHwepzo65B_TCJ0dU-yjRL1aLs-TfEfBjXJI';
var GROUP_CHAT_ID = '-5227165092';
var EUNWOO_CHAT_ID = '8139301716';
var PERSONAL_METRICS_SHEET_ID = '1nxnsbqQSxv-lRcCDsUh6r16qoyeywVRJhPScd2N21bA';
var STRATEGY_SHEET_ID = '1EQaNYcJz1c_WmPKiDbtecCNKtJ5LX4P8zg6m1-xkTBs'; // 전략 대시보드 (COMPASS 개인메모)
var TAGS = ['/결정', '/액션', '/아이디어', '/공유', '/광고', '/소싱', '/CS', '/운영', '/디자인'];

function _botToken() {
  return PropertiesService.getScriptProperties().getProperty('BOT_TOKEN') || '';
}

function detectTags(text) {
  var tokens = String(text).toLowerCase().split(/\s+/);
  return TAGS.filter(function(tag) {
    var t = tag.toLowerCase();
    return tokens.some(function(tok) {
      return tok === t || tok.replace(/[^a-z0-9가-힣/]+$/, '') === t;
    });
  });
}

function normDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v);
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
  return s;
}

function normTime(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'HH:mm');
  return String(v);
}

function doGet(e) {
  return ContentService.createTextOutput('CX Bot OK');
}

// ===== Telegram Polling (1분 트리거로 호출) =====
function pollTelegramUpdates() {
  var token = _botToken();
  if (!token) return;
  // 동시 실행 방지: 1분 트리거가 겹치면 같은 미확정 업데이트를 둘이 재처리하며 offset이 안 넘어감.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var lastId = parseInt(props.getProperty('TG_LAST_UPDATE_ID') || '0');
    var url = 'https://api.telegram.org/bot' + token + '/getUpdates?timeout=0&limit=100&offset=' + (lastId + 1);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (!data.ok || !data.result || !data.result.length) return;
    var updates = data.result;
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      try {
        if (u.callback_query) {
          handleCallbackQuery(u.callback_query);
        } else {
          handleTelegramUpdate(u);
        }
      } catch (err) {
        // 업데이트 하나의 처리 실패가 폴링 전체를 막지 않도록. 에러는 은우 DM에 노출.
        try { sendTGMessage(EUNWOO_CHAT_ID, '⚠️ 처리 오류 (update ' + u.update_id + ')\n' + (err && err.stack ? err.stack : err)); } catch (e2) {}
      }
      // 업데이트마다 즉시 offset 저장: 중간에 끊겨도 처리 끝난 건 재처리 안 됨.
      if (u.update_id > lastId) { lastId = u.update_id; props.setProperty('TG_LAST_UPDATE_ID', String(lastId)); }
    }
  } finally {
    lock.releaseLock();
  }
}

function setupPollingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollTelegramUpdates') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollTelegramUpdates').timeBased().everyMinutes(1).create();
  console.log('polling trigger 등록 완료');
}

function doPost(e) {
  try {
    var contents = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var action = contents.action;
    if (action === 'add_meeting') {
      var sheet = getMeetingSheet(ss);
      sheet.appendRow([contents.date, contents.title, contents.participants,
        contents.agenda, contents.decisions, contents.actions,
        contents.assignee, contents.deadline || '',
        contents.status || '🟡 진행중', contents.notes || '']);
      return jsonOut({ok: true});
    }
    if (action === 'save_tagged') {
      getOrCreate(ss, '태그기록').appendRow([contents.date, contents.time, contents.sender, contents.tags, contents.text]);
      return jsonOut({ok: true});
    }
    if (action === 'save_daily') {
      var sheet = getOrCreate(ss, '일일대화');
      var msgs = contents.messages || [];
      var seen = {};
      if (sheet.getLastRow() > 0) {
        var ex = sheet.getDataRange().getValues();
        for (var i = 0; i < ex.length; i++) {
          seen[normDate(ex[i][0]) + '|' + ex[i][1] + '|' + ex[i][2] + '|' + ex[i][4]] = true;
        }
      }
      var rows = [];
      for (var j = 0; j < msgs.length; j++) {
        var mm = msgs[j];
        var key = mm.date + '|' + mm.time + '|' + mm.sender + '|' + mm.text;
        if (seen[key]) continue;
        seen[key] = true;
        rows.push([mm.date, mm.time, mm.sender, mm.isBot ? 'Y' : 'N', mm.text]);
      }
      if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
      return jsonOut({ok: true, added: rows.length});
    }
    if (action === 'delete_by_title') {
      var sheet = getMeetingSheet(ss);
      var data = sheet.getDataRange().getValues();
      var goodRows = [data[0]];
      var deleted = 0;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][1]) === contents.title) { deleted++; }
        else { goodRows.push(data[i]); }
      }
      sheet.clearContents();
      if (goodRows.length > 0) sheet.getRange(1, 1, goodRows.length, goodRows[0].length).setValues(goodRows);
      return jsonOut({ok: true, deleted: deleted});
    }
    if (action === 'get_daily_messages') {
      var sheet = getOrCreate(ss, '일일대화');
      if (sheet.getLastRow() < 1) return jsonOut({ok: true, messages: []});
      var data = sheet.getDataRange().getValues();
      var want = normDate(contents.date);
      var msgs = [];
      for (var i = 0; i < data.length; i++) {
        if (normDate(data[i][0]) === want) {
          msgs.push({time: normTime(data[i][1]), sender: String(data[i][2]), isBot: data[i][3] === 'Y', text: String(data[i][4])});
        }
      }
      return jsonOut({ok: true, messages: msgs});
    }
    if (action === 'get_reminders') {
      var sheet = getOrCreate(ss, '리마인드');
      if (sheet.getLastRow() < 1) return jsonOut({ok: true, reminders: []});
      var data = sheet.getDataRange().getValues();
      var reminders = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][4]) === 'active') {
          reminders.push({id: parseInt(data[i][0]), text: String(data[i][1]), addedDate: normDate(data[i][3])});
        }
      }
      return jsonOut({ok: true, reminders: reminders});
    }
    if (action === 'update_reminder_done') {
      var sheet = getOrCreate(ss, '리마인드');
      if (sheet.getLastRow() < 1) return jsonOut({ok: true, deleted: 0});
      var data = sheet.getDataRange().getValues();
      var ids = (contents.ids || []).map(String);
      var texts = contents.texts || [];
      var toDelete = [];
      for (var i = 0; i < data.length; i++) {
        var rowId = String(data[i][0]);
        var rowText = String(data[i][1]);
        var hit = ids.indexOf(rowId) >= 0 || texts.some(function(t){ return rowText.indexOf(String(t)) >= 0; });
        if (hit) toDelete.push(i + 1);
      }
      toDelete.sort(function(a,b){return b-a;});
      for (var k = 0; k < toDelete.length; k++) sheet.deleteRow(toDelete[k]);
      return jsonOut({ok: true, deleted: toDelete.length});
    }
    if (action === 'add_reminder') {
      var sheet = getOrCreate(ss, '리마인드');
      var data = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
      var maxId = 0;
      data.forEach(function(row) { var n = parseInt(row[0]); if (!isNaN(n) && n > maxId) maxId = n; });
      var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      sheet.appendRow([maxId + 1, contents.text, contents.sender || '', contents.date || today, 'active', '']);
      return jsonOut({ok: true, id: maxId + 1});
    }
    if (action === 'rebuild_daily') {
      var sheet = getOrCreate(ss, '일일대화');
      sheet.clearContents();
      var msgs = contents.messages || [];
      var rows = [];
      for (var j = 0; j < msgs.length; j++) {
        var mm = msgs[j];
        rows.push([mm.date, mm.time, mm.sender, mm.isBot ? 'Y' : 'N', mm.text]);
      }
      if (rows.length > 0) sheet.getRange(1, 1, rows.length, 5).setValues(rows);
      return jsonOut({ok: true, written: rows.length});
    }
    if (action === 'ensure_text') {
      return jsonOut(ensureTextFormat());
    }
    if (action === 'cleanup') {
      return jsonOut(cleanupSheets());
    }
    if (action === 'get_activities') {
      return jsonOut(getActivitiesData(contents.hours || 24));
    }
    if (action === 'get_memos') {
      return jsonOut(getMemosData());
    }
    if (action === 'save_weekly') {
      return jsonOut(saveWeeklySnapshot_(contents));
    }
    if (action === 'format_weekly') {
      return jsonOut(formatWeeklyTabs_());
    }
    if (action === 'get_calendar_events') {
      return jsonOut(getCalendarEvents_(contents.query || '', contents.daysAhead || 30, contents.daysBack || 7));
    }
    if (action === 'save_daily_snapshot') {
      return jsonOut(saveDailySnapshot_(contents));
    }
    if (action === 'get_daily_baseline') {
      return jsonOut(getDailyBaseline_(contents.daysBack || 7));
    }
    if (action === 'get_daily_raw_range') {
      return jsonOut(getDailyRawRange_(contents.startDate, contents.endDate));
    }
    if (action === 'dump_misu_structure') {
      return jsonOut(dumpMisuStructure_(contents.keyword || ''));
    }
    if (action === 'get_eunwoo_memo') {
      return jsonOut({ ok: true, memo: readEunwooCompassMemo_() });
    }
    if (action === 'save_levers') {
      return jsonOut(saveLevers_(contents));
    }
    if (action === 'get_levers') {
      return jsonOut(getLevers_());
    }
    if (action === 'set_eunwoo_memo') { // 정리/수정용 (덮어쓰기)
      var cell = findEunwooMemoCell_();
      if (!cell) return jsonOut({ ok: false, error: '은우 행 못 찾음' });
      cell.setValue(String(contents.value || ''));
      return jsonOut({ ok: true });
    }
    if (action === 'list_triggers') {
      return jsonOut({ ok: true, triggers: ScriptApp.getProjectTriggers().map(function (t) {
        return { fn: t.getHandlerFunction(), type: String(t.getEventType()) };
      }) });
    }
    if (action === 'ensure_polling') {
      setupPollingTrigger();
      return jsonOut({ ok: true, triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) });
    }
    if (action === 'cafe24_webhook' || (contents.resource && (contents.resource.order_id || contents.resource.order_no))) {
      return jsonOut(handleCafe24Webhook_(contents));
    }
    if (action === 'setup_ga4_mp') {
      return jsonOut({ ok: true, result: setupGA4MP() });
    }
    if (action === 'setup_ga4_secret') {
      return jsonOut({ ok: true, result: setupGA4MP_secret(contents.secret || '') });
    }
    if (action === 'check_ga4_mp') {
      var p = PropertiesService.getScriptProperties();
      return jsonOut({ ok: true, measurement_id: p.getProperty('GA4_MEASUREMENT_ID') || null, api_secret_set: !!p.getProperty('GA4_API_SECRET') });
    }
    if (action === 'push_ga4_orders') {
      return jsonOut(pushGa4Orders_(contents));
    }
    if (action === 'save_ux_draft')  return jsonOut(saveUXDraft_(contents));
    if (action === 'get_ux_history') return jsonOut(getUXHistory_());
    if (action === 'get_ux_pending') return jsonOut(getUXPending_());
    if (action === 'mark_ux_sent')   return jsonOut(markUXSent_(contents.date));
    if (action === 'mark_ux_skip')   return jsonOut(markUXSkip_(contents.date));
    if (action === 'setup_cx_triggers') { setupCXTriggers(); return jsonOut({ ok: true }); }
    if (action === 'get_ux_feedback') {
      var p = PropertiesService.getScriptProperties();
      var fb = p.getProperty('UX_REVISE_FEEDBACK') || '';
      if (fb) p.deleteProperty('UX_REVISE_FEEDBACK');
      return jsonOut({ ok: true, feedback: fb });
    }
    return jsonOut({ok: false, error: 'unknown action'});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function handleTelegramUpdate(update) {
  var msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  var chatId = String(msg.chat.id);
  if (chatId === EUNWOO_CHAT_ID) { handleEunwooDM(msg); return; }
  if (chatId !== GROUP_CHAT_ID) return;
  var text = msg.text.trim();
  var from = msg.from || {};
  var sender = (from.first_name || '') + (from.last_name ? ' ' + from.last_name : '');
  var isBot = !!from.is_bot;
  var msgTime = new Date(msg.date * 1000);
  var today = Utilities.formatDate(msgTime, 'Asia/Seoul', 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(msgTime, 'Asia/Seoul', 'HH:mm');
  // 단톡방 사람별 통합 조회 — /은우 /미주 /경태 (단축, 각 섹션 3건)
  // 미주 봇 명령어와 충돌 X (이름은 미주 봇 trigger 아님). 시트 read only.
  if (text === '/은우') { handleMisuPerson(chatId, '은우', 3); return; }
  if (text === '/미주') { handleMisuPerson(chatId, '미주', 3); return; }
  if (text === '/경태') { handleMisuPerson(chatId, '경태', 3); return; }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var addMatch = text.match(/^\/추가\s+([\s\S]+)/);
  if (addMatch) { addReminderSheet(ss, addMatch[1].trim(), sender, today); return; }
  var doneMatch = text.match(/^\/완료\s+(.+)/);
  if (doneMatch) { markDoneSheet(ss, doneMatch[1].trim().split(/\s+/)); return; }
  saveDailyMessage(ss, today, timeStr, sender, isBot, text);
  var foundTags = detectTags(text);
  if (foundTags.length > 0) saveTaggedMessage(ss, today, timeStr, sender, foundTags, text);
}

// ===== 은우 개인 DM 처리 =====
function handleEunwooDM(msg) {
  var text = msg.text.trim();
  var chatId = msg.chat.id;
  var msgTime = new Date(msg.date * 1000);
  var date = Utilities.formatDate(msgTime, 'Asia/Seoul', 'yyyy-MM-dd');
  var time = Utilities.formatDate(msgTime, 'Asia/Seoul', 'HH:mm');

  var m;
  if ((m = text.match(/^\/작업\s+([\s\S]+)/))) { addWork(m[1].trim(), chatId, date, time); return; }
  if ((m = text.match(/^\/작업완료\s+([A-Z0-9-]+)/))) { updateWorkStatus(m[1].trim(), 'GO', chatId); return; }
  if ((m = text.match(/^\/작업중단\s+([A-Z0-9-]+)/))) { updateWorkStatus(m[1].trim(), 'STOP', chatId); return; }
  if ((m = text.match(/^\/작업보류\s+([A-Z0-9-]+)/))) { updateWorkStatus(m[1].trim(), 'HOLD', chatId); return; }
  if (text === '/작업목록') { listActiveWorks(chatId); return; }
  if ((m = text.match(/^\/메모\s+([\s\S]+)/))) {
    var memoText = m[1].trim();
    var res = appendEunwooCompassMemo_(memoText);
    if (res.ok) sendTGMessage(chatId, '✅ 개인메모 저장 (전략 대시보드 COMPASS)\n• ' + memoText);
    else sendTGMessage(chatId, '⚠️ 메모 저장 실패: ' + res.error);
    return;
  }
  if (text === '/메모목록') { sendTGMessage(chatId, '📝 <b>개인메모</b> (COMPASS)\n' + readEunwooCompassMemo_()); return; }
  if (text === '/UX 발송' || text === '/UX발송') { handleUXSend(chatId); return; }
  if (text === '/UX 보류' || text === '/UX보류') { handleUXSkip(chatId, date); return; }
  if ((m = text.match(/^\/UX\s*수정\s+([\s\S]+)/))) { handleUXRevise(m[1].trim(), chatId); return; }
  if (text === '/UX 셋업' || text === '/UX셋업') {
    try { setupCXTriggers(); sendTGMessage(chatId, '✅ 트리거 등록 완료 — 월·목 8:00 KST 자동 발화. 첫 발송 5/28 (목).'); }
    catch (e) { sendTGMessage(chatId, '⚠️ 셋업 실패: ' + e.message); }
    return;
  }
  // 미주 송마망 시트 read-only query — /조회 prefix (미주 버팀이 봇 /액션 충돌 회피)
  // 시트 write X — 미주 자동화 무영향
  if ((m = text.match(/^\/조회\s+액션(?:\s+(\S+))?$/))) { handleMisuActions(chatId, m[1] || '은우'); return; }
  if (text === '/조회 결정' || text === '/조회결정') { handleMisuDecisions(chatId); return; }
  if (text === '/조회 공유' || text === '/조회공유') { handleMisuLinks(chatId); return; }
  if (text === '/조회 리마인드' || text === '/조회리마인드') { handleMisuReminders(chatId); return; }
  if (text === '/조회 멘션' || text === '/조회멘션') { handleMisuMentions(chatId); return; }
  if (text === '/내것' || text === '/조회 내것' || text === '/조회내것') { handleMisuMine(chatId); return; }
  if (text === '/은우') { handleMisuPerson(chatId, '은우', 5); return; }
  if (text === '/미주') { handleMisuPerson(chatId, '미주', 5); return; }
  if (text === '/경태') { handleMisuPerson(chatId, '경태', 5); return; }
  if ((m = text.match(/^\/완료\s+(.+)$/))) {
    var nums = (m[1].match(/\d+/g) || []);  // 숫자만 추출 — "1번 2번"·"1,2"·"1 2" 다 OK
    handleMisuComplete(chatId, nums);
    return;
  }
  if (text === '/도움' || text === '/help') {
    sendTGMessage(chatId, '<b>은우봇 명령어</b>\n<b>· 개인</b>\n/작업 [내용] — 새 작업 등록\n/작업목록 — 진행 중 작업 보기\n/메모 [내용] — 메모 추가\n/메모목록 — 메모 보기\n\n<b>· UX 사례 (월·목)</b>\n/UX 발송 · /UX 보류 · /UX 수정 [요청]\n\n<b>· 미주 송마망 시트 조회 (read-only)</b>\n/내것 (또는 /조회 내것) — 은우 언급 통합 (액션·결정·공유·리마인드·멘션)\n/조회 액션 [담당자=은우] — 미완료 액션\n/완료 [번호] — 직전 /조회 액션의 N번 시트에 완료 마킹 (예: /완료 1 3)\n/조회 결정 — 최근 결정사항\n/조회 공유 — 최근 공유링크\n/조회 리마인드 — 오늘 도래\n/조회 멘션 — 단톡방에서 은우 멘션');
    return;
  }
}

// ===== 미주 송마망 시트 read-only query 핸들러 =====
// 시트 write 0. 미주 자동화 시스템 무영향. read only.
function fetchSongmamansSheet_(tabName) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) return { headers: [], rows: [] };
    var data = sh.getDataRange().getValues();
    return { headers: data[0].map(String), rows: data.slice(1) };
  } catch (e) { return { headers: [], rows: [], err: e.message }; }
}
function colIdx_(headers, keyword) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).indexOf(keyword) >= 0) return i;
  }
  return -1;
}
// 정확 매칭(우선순위) 또는 키워드 fallback list — 시트 실제 헤더 검증 후 fix (2026-06-01)
function colIdxFirst_(headers, keywords) {
  for (var k = 0; k < keywords.length; k++) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === keywords[k]) return i;
    }
  }
  // exact 매치 X면 부분일치 fallback (첫 키워드만)
  return colIdx_(headers, keywords[0]);
}
function trunc_(v, n) { var s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n) + '…' : s; }
function ymd_(v) { var s = String(v == null ? '' : v); return s.slice(0, 10); }
// 0520(수) 한국식 포맷 — 영어 "Wed May 20" 대신
function fmtDate_(v) {
  if (v == null || v === '') return '';
  var d;
  if (v instanceof Date) d = v;
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) d = new Date(String(v));
  else return String(v).slice(0, 10);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  var wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return mm + dd + '(' + wd + ')';
}

function handleMisuActions(chatId, owner) {
  var d = fetchSongmamansSheet_('✅ 액션');
  if (d.err) { sendTGMessage(chatId, '⚠️ 시트 read 실패: ' + d.err); return; }
  if (!d.rows.length) { sendTGMessage(chatId, '액션 시트 비어있음'); return; }
  var iOwner = colIdx_(d.headers, '담당');
  var iContent = colIdx_(d.headers, '내용');
  var iDate = colIdx_(d.headers, '등록');
  var iDue = colIdx_(d.headers, '마감');
  var iStatus = colIdx_(d.headers, '상태');
  var iDone = colIdx_(d.headers, '완료');
  // row 인덱스도 같이 (캐시용 — /완료 마킹 시 정확한 시트 행)
  var indexed = d.rows.map(function (r, i) { return { r: r, sheetRow: i + 2 }; });
  var filtered = indexed.filter(function (x) {
    var r = x.r;
    var matchOwner = !owner || String(r[iOwner] || '').indexOf(owner) >= 0;
    var statusDone = iStatus >= 0 && /완료|done|✅|✓/i.test(String(r[iStatus] || ''));
    var doneFlag = iDone >= 0 && /^(Y|TRUE|✓|완료)$/i.test(String(r[iDone] || '').trim());
    return matchOwner && !statusDone && !doneFlag;
  }).slice(-15).reverse();
  if (!filtered.length) { sendTGMessage(chatId, '📋 ' + owner + ' 미완료 액션 없음'); return; }
  // 캐시 — chatId별 30분 유효. /완료 N 마킹 시 사용
  try {
    CacheService.getScriptCache().put('actions_' + chatId, JSON.stringify(filtered.map(function (x) { return x.sheetRow; })), 1800);
  } catch (e) {}
  var lines = filtered.map(function (x, i) {
    var r = x.r;
    var dt = iDate >= 0 ? fmtDate_(r[iDate]) : '';
    var due = iDue >= 0 ? fmtDate_(r[iDue]) : '';
    var c = trunc_(r[iContent], 110);
    return (i + 1) + '. [' + dt + (due ? '→' + due : '') + '] ' + c;
  });
  sendTGMessage(chatId, '📋 <b>' + owner + ' 미완료 액션 ' + filtered.length + '건</b>\n\n' + lines.join('\n') + '\n\n<i>완료 처리: /완료 [번호] (예: /완료 1 3)</i>');
}

// /완료 N1 N2 ... — 직전 /조회 액션 결과의 N번째 행을 시트에 완료 마킹
function handleMisuComplete(chatId, nums) {
  var cached = null;
  try { var v = CacheService.getScriptCache().get('actions_' + chatId); cached = v ? JSON.parse(v) : null; } catch (e) {}
  if (!cached || !cached.length) { sendTGMessage(chatId, '⚠️ /조회 액션 먼저 (캐시 만료·없음, 30분 유효)'); return; }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('✅ 액션');
  if (!sh) { sendTGMessage(chatId, '⚠️ 액션 시트 없음'); return; }
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  // 상태/완료 컬럼 찾기 (부분일치)
  var iStatus = -1;
  for (var i = 0; i < headers.length; i++) {
    if (/상태|완료|status|done|진행/i.test(headers[i])) { iStatus = i; break; }
  }
  if (iStatus < 0) {
    sendTGMessage(chatId, '⚠️ 액션 탭에 "상태"/"완료" 컬럼 못 찾음.\n현재 헤더: ' + headers.join(' | ') + '\n사용자가 어느 컬럼인지 알려주면 박을게요.');
    return;
  }
  var marked = [], skipped = [];
  nums.forEach(function (n) {
    var idx = parseInt(n, 10) - 1;
    if (idx < 0 || idx >= cached.length || isNaN(idx)) { skipped.push(n); return; }
    var rowNum = cached[idx];
    try {
      sh.getRange(rowNum, iStatus + 1).setValue('완료');
      marked.push(n);
    } catch (e) { skipped.push(n + '(' + e.message + ')'); }
  });
  var msg = '';
  if (marked.length) msg += '✅ 완료 마킹: ' + marked.join(', ') + ' (' + headers[iStatus] + ' 컬럼)';
  if (skipped.length) msg += (msg ? '\n' : '') + '⚠️ 스킵: ' + skipped.join(', ');
  if (!msg) msg = '⚠️ 마킹된 항목 없음';
  sendTGMessage(chatId, msg);
}
function handleMisuDecisions(chatId) {
  var d = fetchSongmamansSheet_('💡 의견_결정');
  if (d.err) { sendTGMessage(chatId, '⚠️ 시트 read 실패: ' + d.err); return; }
  if (!d.rows.length) { sendTGMessage(chatId, '결정 시트 비어있음'); return; }
  var iDate = colIdx_(d.headers, '날짜') >= 0 ? colIdx_(d.headers, '날짜') : colIdx_(d.headers, '등록');
  var iTopic = colIdx_(d.headers, '주제');
  var iDecision = colIdx_(d.headers, '결정');
  var iContent = colIdx_(d.headers, '내용');
  var recent = d.rows.slice(-10).reverse();
  var lines = recent.map(function (r, i) {
    var dt = iDate >= 0 ? fmtDate_(r[iDate]) : '';
    var t = iTopic >= 0 ? trunc_(r[iTopic], 40) : '';
    var dec = iDecision >= 0 ? trunc_(r[iDecision], 100) : (iContent >= 0 ? trunc_(r[iContent], 100) : '');
    return (i + 1) + '. [' + dt + '] ' + (t ? t + ' — ' : '') + dec;
  });
  sendTGMessage(chatId, '💡 <b>최근 결정 ' + recent.length + '건</b>\n\n' + lines.join('\n'));
}
function handleMisuLinks(chatId) {
  var d = fetchSongmamansSheet_('🔗 공유_링크');
  if (d.err) { sendTGMessage(chatId, '⚠️ 시트 read 실패: ' + d.err); return; }
  if (!d.rows.length) { sendTGMessage(chatId, '공유링크 시트 비어있음'); return; }
  // 실제 헤더: 등록일·카테고리·내용·URL·키워드·등록자
  var iDate = colIdxFirst_(d.headers, ['등록일', '날짜']);
  var iSender = colIdxFirst_(d.headers, ['등록자', '담당자', '발신자']);
  var iContent = colIdxFirst_(d.headers, ['내용', '링크']);
  var recent = d.rows.slice(-10).reverse();
  var lines = recent.map(function (r, i) {
    var dt = iDate >= 0 ? fmtDate_(r[iDate]) : '';
    var s = iSender >= 0 ? trunc_(r[iSender], 8) : '';
    var c = iContent >= 0 ? trunc_(r[iContent], 130) : '';
    return (i + 1) + '. [' + dt + '] ' + (s ? s + ' ' : '') + c;
  });
  sendTGMessage(chatId, '🔗 <b>최근 공유 ' + recent.length + '건</b>\n\n' + lines.join('\n'));
}
function handleMisuReminders(chatId) {
  var d = fetchSongmamansSheet_('🔔 리마인드_큐');
  if (d.err) { sendTGMessage(chatId, '⚠️ 시트 read 실패: ' + d.err); return; }
  if (!d.rows.length) { sendTGMessage(chatId, '리마인드 시트 비어있음'); return; }
  // 실제 헤더: ID·트리거 종류·항목 참조 ID·알림 일시·푸시 상태·메모
  var iDate = colIdxFirst_(d.headers, ['알림 일시', '날짜', '도래']);
  var iContent = colIdxFirst_(d.headers, ['메모', '내용']);
  var iStatus = colIdxFirst_(d.headers, ['푸시 상태', '상태']);
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var dueToday = d.rows.filter(function (r) {
    var dt = iDate >= 0 ? ymd_(r[iDate]) : '';  // 비교용 — 표시는 fmtDate_ 별도
    var done = iStatus >= 0 && /완료|done|✅|✓|pushed|sent/i.test(String(r[iStatus] || ''));
    return !done && dt && dt <= today;
  }).slice(0, 10);
  if (!dueToday.length) { sendTGMessage(chatId, '🔔 오늘 도래 리마인드 없음'); return; }
  var lines = dueToday.map(function (r, i) {
    var dt = iDate >= 0 ? fmtDate_(r[iDate]) : '';
    var c = iContent >= 0 ? trunc_(r[iContent], 130) : '';
    return (i + 1) + '. [' + dt + '] ' + c;
  });
  sendTGMessage(chatId, '🔔 <b>오늘 도래 리마인드 ' + dueToday.length + '건</b>\n\n' + lines.join('\n'));
}
function handleMisuMentions(chatId) {
  var d = fetchSongmamansSheet_('📥 RAW');
  if (d.err) { sendTGMessage(chatId, '⚠️ 시트 read 실패: ' + d.err); return; }
  if (!d.rows.length) { sendTGMessage(chatId, 'RAW 시트 비어있음'); return; }
  // 실제 헤더: 시각·발신자·본문·태그·메시지ID
  var iDate = 0, iTime = -1;  // 시각=0번 (날짜+시간 합쳐짐)
  var iSender = colIdxFirst_(d.headers, ['발신자', '발신']);
  if (iSender < 0) iSender = 1;
  var iText = colIdxFirst_(d.headers, ['본문', '내용', '메시지']);
  if (iText < 0) iText = 2;
  var mentions = d.rows.filter(function (r) {
    var s = String(r[iSender] || '');
    var t = String(r[iText] || '');
    return s.indexOf('은우') < 0 && /은우/.test(t);
  }).slice(-10).reverse();
  if (!mentions.length) { sendTGMessage(chatId, '💬 단톡방 은우 멘션 최근 없음'); return; }
  var lines = mentions.map(function (r, i) {
    // 시각 컬럼은 "2026-06-01 14:33" 형태 — fmtDate_가 날짜 부분만, 시간은 별도 추출
    var raw = String(r[iDate] || '');
    var dt = fmtDate_(r[iDate]);
    var tm = (raw.match(/\d{2}:\d{2}/) || [''])[0];
    var s = trunc_(r[iSender], 6);
    var t = trunc_(r[iText], 120);
    return (i + 1) + '. [' + dt + (tm ? ' ' + tm : '') + '] ' + s + ': ' + t;
  });
  sendTGMessage(chatId, '💬 <b>단톡방 은우 멘션 ' + mentions.length + '건</b>\n\n' + lines.join('\n'));
}

// ===== 사람별 통합 — /내것 (은우) · /경태 · /미주 · /은우 =====
// 액션·결정·공유·리마인드·멘션 5탭에서 해당 사람 언급된 항목 한 번에
function handleMisuMine(chatId) { handleMisuPerson(chatId, '은우', 5); }
function handleMisuPerson(chatId, name, limit) {
  limit = limit || 5;
  var sections = [];

  // 1. 액션 (담당자=은우, 미완료)
  var a = fetchSongmamansSheet_('✅ 액션');
  if (a.rows.length) {
    var iO = colIdx_(a.headers, '담당'), iC = colIdx_(a.headers, '내용');
    var iD = colIdx_(a.headers, '등록'), iDue = colIdx_(a.headers, '마감');
    var iS = colIdx_(a.headers, '상태'), iDn = colIdx_(a.headers, '완료');
    var rows = a.rows.filter(function (r) {
      var match = iO < 0 || String(r[iO] || '').indexOf(name) >= 0;
      var done = iS >= 0 && /완료|done|✅|✓/i.test(String(r[iS] || ''));
      var done2 = iDn >= 0 && /^(Y|TRUE|✓|완료)$/i.test(String(r[iDn] || '').trim());
      return match && !done && !done2;
    }).slice(-limit).reverse();
    if (rows.length) sections.push('📋 <b>액션 ' + rows.length + '건</b>\n' + rows.map(function (r, i) {
      var dt = iD >= 0 ? fmtDate_(r[iD]) : '';
      var due = iDue >= 0 ? fmtDate_(r[iDue]) : '';
      return (i + 1) + '. [' + dt + (due ? '→' + due : '') + '] ' + trunc_(r[iC], 90);
    }).join('\n'));
  }

  // 2. 결정 — 팀 전체 결정 (은우도 알아야 함, 필터 X). 최근 5개
  var dc = fetchSongmamansSheet_('💡 의견_결정');
  if (dc.rows.length) {
    var iD2 = colIdx_(dc.headers, '날짜') >= 0 ? colIdx_(dc.headers, '날짜') : colIdx_(dc.headers, '등록');
    var iT = colIdx_(dc.headers, '주제'), iDec = colIdx_(dc.headers, '결정'), iC2 = colIdx_(dc.headers, '내용');
    var rows2 = dc.rows.slice(-limit).reverse();
    if (rows2.length) sections.push('💡 <b>최근 결정 ' + rows2.length + '건</b>\n' + rows2.map(function (r, i) {
      var dt = iD2 >= 0 ? fmtDate_(r[iD2]) : '';
      var t = iT >= 0 ? trunc_(r[iT], 30) : '';
      var d2 = iDec >= 0 ? trunc_(r[iDec], 80) : (iC2 >= 0 ? trunc_(r[iC2], 80) : '');
      var hit = String((iT >= 0 ? r[iT] : '') + (iDec >= 0 ? r[iDec] : '') + (iC2 >= 0 ? r[iC2] : '')).indexOf(name) >= 0 ? '⭐ ' : '';
      return (i + 1) + '. ' + hit + '[' + dt + '] ' + (t ? t + ' — ' : '') + d2;
    }).join('\n'));
  }

  // 3. 공유 — 팀 전체 공유 (필터 X). 최근 5개
  var sh = fetchSongmamansSheet_('🔗 공유_링크');
  if (sh.rows.length) {
    // 실제 헤더: 등록일·카테고리·내용·URL·키워드·등록자
    var iD3 = colIdxFirst_(sh.headers, ['등록일', '날짜']);
    var iSe = colIdxFirst_(sh.headers, ['등록자', '담당자', '발신자']);
    var iC3 = colIdxFirst_(sh.headers, ['내용', '링크']);
    var rows3 = sh.rows.slice(-limit).reverse();
    if (rows3.length) sections.push('🔗 <b>최근 공유 ' + rows3.length + '건</b>\n' + rows3.map(function (r, i) {
      var dt = iD3 >= 0 ? fmtDate_(r[iD3]) : '';
      var hit = String((iSe >= 0 ? r[iSe] : '') + (iC3 >= 0 ? r[iC3] : '')).indexOf(name) >= 0 ? '⭐ ' : '';
      return (i + 1) + '. ' + hit + '[' + dt + '] ' + trunc_(r[iC3], 110);
    }).join('\n'));
  }

  // 4. 리마인드 — 오늘 도래 전체 (필터 X)
  var rm = fetchSongmamansSheet_('🔔 리마인드_큐');
  if (rm.rows.length) {
    // 실제 헤더: ID·트리거 종류·항목 참조 ID·알림 일시·푸시 상태·메모
    var iD4 = colIdxFirst_(rm.headers, ['알림 일시', '날짜', '도래']);
    var iC4 = colIdxFirst_(rm.headers, ['메모', '내용']);
    var iS4 = colIdxFirst_(rm.headers, ['푸시 상태', '상태']);
    var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    var rows4 = rm.rows.filter(function (r) {
      var dt = iD4 >= 0 ? ymd_(r[iD4]) : '';
      var done = iS4 >= 0 && /완료|done|✅|✓|pushed|sent/i.test(String(r[iS4] || ''));
      return !done && dt && dt <= today;
    }).slice(0, limit + 3);
    if (rows4.length) sections.push('🔔 <b>오늘 도래 리마인드 ' + rows4.length + '건</b>\n' + rows4.map(function (r, i) {
      var dt = iD4 >= 0 ? fmtDate_(r[iD4]) : '';
      var hit = iC4 >= 0 && String(r[iC4] || '').indexOf(name) >= 0 ? '⭐ ' : '';
      return (i + 1) + '. ' + hit + '[' + dt + '] ' + trunc_(r[iC4], 110);
    }).join('\n'));
  }

  // 5. 단톡방 멘션 (RAW에서 다른 사람이 name 언급) — 실제 헤더: 시각·발신자·본문·태그·메시지ID
  var raw = fetchSongmamansSheet_('📥 RAW');
  if (raw.rows.length) {
    var iSe2 = colIdxFirst_(raw.headers, ['발신자', '발신']);
    if (iSe2 < 0) iSe2 = 1;
    var iTx = colIdxFirst_(raw.headers, ['본문', '내용', '메시지']);
    if (iTx < 0) iTx = 2;
    var rows5 = raw.rows.filter(function (r) {
      var s = String(r[iSe2] || ''); var t = String(r[iTx] || '');
      return s.indexOf(name) < 0 && t.indexOf(name) >= 0;
    }).slice(-limit).reverse();
    if (rows5.length) sections.push('💬 <b>단톡 ' + name + ' 멘션 ' + rows5.length + '건</b>\n' + rows5.map(function (r, i) {
      var raw0 = String(r[0] || '');
      var dt = fmtDate_(r[0]);
      var tm = (raw0.match(/\d{2}:\d{2}/) || [''])[0];
      return (i + 1) + '. [' + dt + (tm ? ' ' + tm : '') + '] ' + trunc_(r[iSe2], 6) + ': ' + trunc_(r[iTx], 100);
    }).join('\n'));
  }

  if (!sections.length) { sendTGMessage(chatId, '👤 ' + name + ' 관련 항목 없음'); return; }
  sendTGMessage(chatId, '👤 <b>' + name + ' 통합</b>\n\n' + sections.join('\n\n'));
}

// ===== UX 명령어 핸들러 =====
function handleUXSend(chatId) {
  var p = getUXPending_();
  if (!p.ok || !p.draft) { sendTGMessage(chatId, '⚠️ 대기 중 UX 초안 없음.'); return; }
  var code = triggerUXSend();
  if (code === 204) sendTGMessage(chatId, '📤 단톡방 발송 중... (' + p.draft.technique + ')');
  else sendTGMessage(chatId, '⚠️ workflow trigger 실패. 코드 ' + code);
}
function handleUXSkip(chatId, date) {
  // 가장 최근 draft 찾아서 스킵
  var p = getUXPending_();
  if (!p.ok || !p.draft) { sendTGMessage(chatId, '⚠️ 대기 중 UX 초안 없음.'); return; }
  var r = markUXSkip_(p.draft.date);
  if (r.ok) sendTGMessage(chatId, '✅ UX 초안 스킵 (' + p.draft.date + ' ' + p.draft.technique + ')');
  else sendTGMessage(chatId, '⚠️ 스킵 실패: ' + (r.error || 'unknown'));
}
function handleUXRevise(feedback, chatId) {
  var p = getUXPending_();
  if (!p.ok || !p.draft) { sendTGMessage(chatId, '⚠️ 수정할 UX 초안 없음.'); return; }
  // feedback을 PropertiesService에 임시 저장 → workflow에서 read
  PropertiesService.getScriptProperties().setProperty('UX_REVISE_FEEDBACK', feedback);
  // 기존 draft 스킵 처리 (재생성을 위해)
  markUXSkip_(p.draft.date);
  var code = triggerCXWorkflow_('daily-report.yml', 'ux_draft');
  if (code === 204) sendTGMessage(chatId, '🔁 수정 요청 반영 중... feedback: ' + feedback.slice(0, 60));
  else sendTGMessage(chatId, '⚠️ workflow trigger 실패. 코드 ' + code);
}

function handleCallbackQuery(query) {
  var data = String(query.data || '');
  var parts = data.split(':');
  var chatId = query.message.chat.id;
  var label = '';
  if (parts[0] === 'work') {
    var status = parts[1]; // GO|STOP|HOLD
    updateWorkStatus(parts[2], status, chatId, query);
    label = status === 'GO' ? '완료 ✅' : status === 'STOP' ? '중단 ❌' : '보류 ⏸';
  } else if (parts[0] === 'memo') {
    var act = parts[1]; // DONE|URGENT
    updateMemoStatus(parts[2], act, chatId, query);
    label = act === 'DONE' ? '완료 ✅' : '긴급 🚨';
  } else {
    return;
  }
  // answerCallbackQuery: spinner 끔
  UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/answerCallbackQuery', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ callback_query_id: query.id, text: label }),
    muteHttpExceptions: true
  });
}

function generateWorkId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = '';
  for (var i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function addWork(content, chatId, date, time) {
  var workId = generateWorkId();
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sheet = ss.getSheetByName('활동로그') || ss.insertSheet('활동로그');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['ID', '날짜', '시간', '내용', '상태', '완료일시']);
    sheet.getRange('B:C').setNumberFormat('@');
  }
  sheet.appendRow([workId, date, time, content, '진행중', '']);
  var keyboard = { inline_keyboard: [[
    { text: '✅ 완료', callback_data: 'work:GO:' + workId },
    { text: '❌ 중단', callback_data: 'work:STOP:' + workId },
    { text: '⏸ 보류', callback_data: 'work:HOLD:' + workId }
  ]]};
  sendTGMessage(chatId, '📝 <b>작업 등록</b> (' + workId + ')\n' + content + '\n상태: 🟡 진행 중', keyboard);
}

function updateWorkStatus(workId, status, chatId, callbackQuery) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sheet = ss.getSheetByName('활동로그');
  if (!sheet || sheet.getLastRow() < 2) { sendTGMessage(chatId, '작업 ' + workId + ' 못 찾음'); return; }
  var data = sheet.getDataRange().getValues();
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === workId) {
      var label = status === 'GO' ? '✅ 완료' : status === 'STOP' ? '❌ 중단' : '⏸ 보류';
      sheet.getRange(i + 1, 5).setValue(label);
      sheet.getRange(i + 1, 6).setValue(now);
      var newText = '📝 <b>작업 ' + label + '</b> (' + workId + ')\n' + data[i][3] + '\n' + now;
      if (callbackQuery) {
        editTGMessage(chatId, callbackQuery.message.message_id, newText);
      } else {
        sendTGMessage(chatId, newText);
      }
      return;
    }
  }
  sendTGMessage(chatId, '작업 ' + workId + ' 못 찾음');
}

function listActiveWorks(chatId) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sheet = ss.getSheetByName('활동로그');
  if (!sheet || sheet.getLastRow() < 2) { sendTGMessage(chatId, '진행 중 작업 없음'); return; }
  var data = sheet.getDataRange().getValues();
  var lines = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]) === '진행중') lines.push('[' + data[i][0] + '] ' + data[i][3]);
  }
  if (!lines.length) { sendTGMessage(chatId, '진행 중 작업 없음'); return; }
  sendTGMessage(chatId, '📋 <b>진행 중 작업 ' + lines.length + '건</b>\n' + lines.join('\n'));
}

function getActivitiesData(hours) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sheet = ss.getSheetByName('활동로그');
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, activities: [] };
  var data = sheet.getDataRange().getValues();
  var cutoff = new Date(); cutoff.setHours(cutoff.getHours() - (hours || 24));
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var d = normDate(data[i][1]);
    var t = normTime(data[i][2]);
    var dt = new Date(d + 'T' + (t.length === 5 ? t : '00:00') + ':00+09:00');
    if (!isNaN(dt.getTime()) && dt >= cutoff) {
      out.push({ id: String(data[i][0]), date: d, time: t, content: String(data[i][3]), status: String(data[i][4]) });
    }
  }
  return { ok: true, activities: out };
}

// ===== 주간 스냅샷 (Looker Studio 다차원 보고서) =====
var WEEKLY_TABS = {
  summary:  { name: '주간_요약',   headers: ['주차','광고비','메타픽셀매출','메타ROAS','실제ROAS','메타주장비중','카페24매출','카페24주문','AOV'] },
  channel:  { name: '주간_채널',   headers: ['주차','채널','세션','전환','전환율'] },
  customer: { name: '주간_고객',   headers: ['주차','구분','세션','전환','전환율'] },
  campaign: { name: '주간_캠페인', headers: ['주차','캠페인','광고비','매출','ROAS','CTR','구매'] }
};

function getWeeklyTab_(key) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var cfg = WEEKLY_TABS[key];
  var sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    sh.appendRow(cfg.headers);
    sh.getRange('A:A').setNumberFormat('@'); // 주차는 텍스트(날짜 자동변환 방지)
    sh.setFrozenRows(1);
  } else {
    // 헤더 동기화(스키마 변경 시 자동 갱신)
    var cur = sh.getRange(1, 1, 1, cfg.headers.length).getValues()[0];
    var diff = cfg.headers.some(function(h, i) { return String(cur[i]) !== h; });
    if (diff) sh.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
  }
  return { sh: sh, headers: cfg.headers };
}

function saveWeeklySnapshot_(contents) {
  var week = String(contents.week || '');
  if (!week) return { ok: false, error: 'no week' };
  var counts = {};
  ['summary','channel','customer','campaign'].forEach(function(key) {
    var rows = contents[key] || [];
    var t = getWeeklyTab_(key);
    // 같은 주차 기존 행 제거(재실행 중복 방지)
    var data = t.sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === week) t.sh.deleteRow(i + 1);
    }
    // 배치 append
    if (rows.length) {
      var values = rows.map(function(obj) {
        return t.headers.map(function(h) { return obj[h] !== undefined && obj[h] !== null ? obj[h] : ''; });
      });
      t.sh.getRange(t.sh.getLastRow() + 1, 1, values.length, t.headers.length).setValues(values);
    }
    counts[key] = rows.length;
  });
  formatWeeklyTabs_();
  return { ok: true, week: week, counts: counts };
}

// 숫자가 한눈에 들어오게 서식 적용 (콤마·원·%·ROAS 색상·헤더·밴딩)
var WEEKLY_FORMATS = {
  '광고비':'#,##0"원"', '메타픽셀매출':'#,##0"원"', '카페24매출':'#,##0"원"', '매출':'#,##0"원"', 'AOV':'#,##0"원"',
  '메타ROAS':'#,##0"%"', '실제ROAS':'#,##0"%"', 'ROAS':'#,##0"%"', '메타주장비중':'#,##0"%"',
  '카페24주문':'#,##0"건"', '구매':'#,##0"건"', '세션':'#,##0', '전환':'#,##0',
  '전환율':'0.00"%"', 'CTR':'0.00"%"'
};

function formatWeeklyTabs_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var done = [];
  Object.keys(WEEKLY_TABS).forEach(function(key) {
    var cfg = WEEKLY_TABS[key];
    var sh = ss.getSheetByName(cfg.name);
    if (!sh || sh.getLastRow() < 2) return;
    var lastRow = sh.getLastRow();
    var nCols = cfg.headers.length;
    // 헤더 스타일 + 고정
    sh.getRange(1, 1, 1, nCols).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // 컬럼별 숫자서식
    cfg.headers.forEach(function(h, idx) {
      var fmt = WEEKLY_FORMATS[h];
      if (fmt) sh.getRange(2, idx + 1, lastRow - 1, 1).setNumberFormat(fmt);
    });
    // 데이터행 교차 배경(가독성)
    sh.getBandings().forEach(function(b) { b.remove(); });
    sh.getRange(2, 1, lastRow - 1, nCols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    // ROAS 컬럼 색상 스케일 (200 빨강 ~ 350 노랑 ~ 450 초록)
    var rules = [];
    cfg.headers.forEach(function(h, idx) {
      var rng = sh.getRange(2, idx + 1, lastRow - 1, 1);
      if (h.indexOf('ROAS') >= 0) {
        // ROAS: 높을수록 초록
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .setGradientMinpointWithValue('#f4b8b8', SpreadsheetApp.InterpolationType.NUMBER, '200')
          .setGradientMidpointWithValue('#ffe699', SpreadsheetApp.InterpolationType.NUMBER, '350')
          .setGradientMaxpointWithValue('#b7e1cd', SpreadsheetApp.InterpolationType.NUMBER, '450')
          .setRanges([rng]).build());
      } else if (h === '메타주장비중') {
        // 메타 과대측정: 높을수록 빨강(주의)
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .setGradientMinpointWithValue('#b7e1cd', SpreadsheetApp.InterpolationType.NUMBER, '60')
          .setGradientMidpointWithValue('#ffe699', SpreadsheetApp.InterpolationType.NUMBER, '85')
          .setGradientMaxpointWithValue('#f4b8b8', SpreadsheetApp.InterpolationType.NUMBER, '110')
          .setRanges([rng]).build());
      }
    });
    sh.setConditionalFormatRules(rules);
    sh.autoResizeColumns(1, nCols);
    done.push(cfg.name);
  });
  return { ok: true, formatted: done };
}

// ===== 일별 스냅샷 (Before/After 측정 + 7일 이동평균 폭증 감지) =====
// CX 개선 액션 전후 비교 측정 가능: 액션 날짜 메모 + 일별 데이터로 직접 비교
var DAILY_SNAPSHOT_HEADERS = ['일자', '카페24매출', '카페24주문', '광고비', '메타픽셀매출', '메타ROAS', '실제ROAS', '메타주장비중',
  '사이트_스크립트에러', '사이트_뒤로', '사이트_데드', '사이트_레이지', '사이트_인스타인앱',
  '결제_장바구니_데드', '결제_장바구니_뒤로', '결제_결제폼_데드', '결제_결제폼_뒤로', '결제_로그인_데드', '결제_로그인_뒤로',
  '제품87_스크롤', '제품87_뒤로', '제품83_스크롤', '제품83_뒤로', '제품84_스크롤', '제품84_뒤로', '제품27_스크롤', '제품27_뒤로',
  '회원_신규', '회원_재방문', '게스트_신규', '게스트_반복', '광고URL_정상', '광고URL_깨짐',
  'LTV_회원수_365d', 'LTV_재구매율', 'LTV_상위10_점유', 'LTV_휴면_91_180d', 'LTV_신규_D30_retention'];

function getDailySnapshotTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('일별_스냅샷');
  if (!sh) {
    sh = ss.insertSheet('일별_스냅샷');
    sh.appendRow(DAILY_SNAPSHOT_HEADERS);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, DAILY_SNAPSHOT_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    return sh;
  }
  // 기존 시트 — 신규 컬럼 자동 추가 (헤더 마이그레이션)
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var toAdd = DAILY_SNAPSHOT_HEADERS.filter(function (h) { return existing.indexOf(h) === -1; });
  if (toAdd.length) {
    sh.getRange(1, lastCol + 1, 1, toAdd.length).setValues([toAdd])
      .setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}

function saveDailySnapshot_(contents) {
  var date = String(contents.date || '');
  if (!date) return { ok: false, error: 'no date' };
  var sh = getDailySnapshotTab_();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === date) sh.deleteRow(i + 1);
  }
  var row = headers.map(function (h) {
    if (h === '일자') return date;
    var v = contents[h]; return v !== undefined && v !== null ? v : '';
  });
  sh.appendRow(row);
  return { ok: true, date: date };
}

// 주간 레버 스냅샷 — UI/UX 개입 전후 비교용 (CX 관리자 성과 측정의 baseline)
var LEVER_HEADERS = ['주차', '날짜', '쿠폰전환%', '골든타임_D21_35', '레시피PV', '재구매율%', '게스트%', '메모'];
function getLeverTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('주간_레버');
  if (!sh) {
    sh = ss.insertSheet('주간_레버');
    sh.appendRow(LEVER_HEADERS);
    sh.getRange(1, 1, 1, LEVER_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function saveLevers_(d) {
  try {
    var sh = getLeverTab_();
    var week = String(d.주차 || '');
    // 같은 주차 행 upsert (덮어쓰기)
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === week) sh.deleteRow(i + 1); }
    var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    sh.appendRow([week, today, d.쿠폰전환 || '', d.골든타임 || '', d.레시피PV || '', d.재구매율 || '', d.게스트 || '', d.메모 || '']);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function getLevers_() {
  try {
    var sh = getLeverTab_();
    if (sh.getLastRow() < 2) return { ok: true, rows: [] };
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var rows = data.slice(1).map(function (r) { var o = {}; headers.forEach(function (h, i) { o[h] = r[i]; }); return o; });
    return { ok: true, rows: rows };
  } catch (e) { return { ok: false, error: e.message }; }
}

// COMPASS 은우 개인메모 — /메모로 추가 (전략 대시보드, 컴퓨터 꺼져도 GAS가 처리)
// ⚠️ 은우 행(A열='은우')의 C열(개인메모)만 append. 미주·경태 행·다른 영역 절대 안 건드림.
function findEunwooMemoCell_() {
  var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
  if (!sh) return null;
  var aCol = sh.getRange('A49:A60').getValues();
  for (var i = 0; i < aCol.length; i++) {
    if (String(aCol[i][0]).trim() === '은우') return sh.getRange(49 + i, 3); // C열 = 개인메모
  }
  return null;
}
function appendEunwooCompassMemo_(text) {
  try {
    var cell = findEunwooMemoCell_();
    if (!cell) return { ok: false, error: '은우 행 못 찾음 (COMPASS A49:A60)' };
    var cur = String(cell.getValue() || '');
    var d = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd');
    var line = '• ' + d + ' ' + text;
    cell.setValue(cur ? cur + '\n' + line : line);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function readEunwooCompassMemo_() {
  try {
    var cell = findEunwooMemoCell_();
    if (!cell) return '(은우 행 못 찾음)';
    return String(cell.getValue() || '(비어있음)');
  } catch (e) { return '(읽기 오류: ' + e.message + ')'; }
}

// 미주 송마망 시트 전체 구조 dump + 키워드 매칭 (2026-06-01 — 솔라피/알림톡 데이터 위치 탐색용)
function dumpMisuStructure_(keyword) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheets = ss.getSheets();
  var tabs = [];
  var hits = [];
  sheets.forEach(function (sh) {
    var name = sh.getName();
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    var headers = (lastRow >= 1 && lastCol >= 1) ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    tabs.push({ name: name, rows: lastRow, headers: headers });
    // 키워드가 있으면 해당 탭 전체에서 매칭 행 찾기 (최근 200행만)
    if (keyword && lastRow >= 2) {
      var startRow = Math.max(2, lastRow - 200);
      var data = sh.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
      data.forEach(function (row, i) {
        var joined = row.join(' | ');
        if (joined.indexOf(keyword) >= 0) {
          hits.push({ tab: name, row: startRow + i, text: joined.slice(0, 400) });
        }
      });
    }
  });
  return { ok: true, tabs: tabs, hits: hits.slice(0, 40) };
}

// 기간 raw funnel — 도입 전후 비교용 (2026-06-01 추가)
function getDailyRawRange_(startDate, endDate) {
  var sh = getDailySnapshotTab_();
  if (sh.getLastRow() < 2) return { ok: true, rows: [] };
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1)
    .filter(function (r) {
      var d = String(r[0]).slice(0, 10);
      return d >= startDate && d <= endDate;
    })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
  return { ok: true, headers: headers, rows: rows };
}

function getDailyBaseline_(daysBack) {
  var sh = getDailySnapshotTab_();
  if (sh.getLastRow() < 2) return { ok: true, baseline: null, count: 0 };
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  // 어제 행은 제외하고 그 이전 daysBack 일의 평균 (오늘 vs 직전 7일 비교용)
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var yesterdayStr = Utilities.formatDate(new Date(Date.now() - 86400000), 'Asia/Seoul', 'yyyy-MM-dd');
  var historicalRows = rows.filter(function (r) { return String(r[0]) !== todayStr && String(r[0]) !== yesterdayStr; }).slice(-daysBack);
  var baseline = {};
  headers.forEach(function (h, idx) {
    if (idx === 0) return;
    var vals = historicalRows.map(function (r) { return parseFloat(r[idx]); }).filter(function (v) { return !isNaN(v); });
    if (vals.length) {
      var sum = vals.reduce(function (s, v) { return s + v; }, 0);
      baseline[h] = { avg: Math.round(sum / vals.length * 100) / 100, n: vals.length };
    }
  });
  return { ok: true, baseline: baseline, count: historicalRows.length };
}

// ===== GA4 MP 1회 셋업 — 편집기에서 setupGA4MP() 한 번 실행 =====
// measurement_id는 코드에 박힘. api_secret만 사용자가 GA4 admin에서 발급해 setupGA4MP_secret('xxx') 호출
function setupGA4MP() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('GA4_MEASUREMENT_ID', 'G-28L9WNSJ9J');
  var hasSecret = !!props.getProperty('GA4_API_SECRET');
  return 'GA4_MEASUREMENT_ID 저장됨 ✅. GA4_API_SECRET 상태: ' + (hasSecret ? '이미 있음 ✅ (webhook 정상 작동 가능)' : '❌ 아직 없음. GA4 관리 → 데이터 스트림 → 웹 → Measurement Protocol API 비밀번호 만든 후 setupGA4MP_secret(\'발급된값\') 실행');
}

// api_secret 발급 후 이 함수를 인자로 호출 (또는 Script Properties UI에서 직접 추가)
function setupGA4MP_secret(apiSecret) {
  if (!apiSecret) return '❌ apiSecret 인자가 비었습니다. setupGA4MP_secret(\'sk_xxx...\') 식으로 호출하세요.';
  PropertiesService.getScriptProperties().setProperty('GA4_API_SECRET', String(apiSecret));
  return 'GA4_API_SECRET 저장됨 ✅. webhook 활성화됨 (cafe24 admin에서 webhook URL만 등록하면 끝)';
}

// ===== Cafe24 외부결제 daily polling → GA4 MP (네이버페이·톡 등 외부 attribution 회복) =====
var GA4_PUSH_HEADERS = ['주문ID', '일자', '금액', '채널', '푸시일시', '상태'];
function getGa4PushTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('GA4_푸시이력');
  if (!sh) {
    sh = ss.insertSheet('GA4_푸시이력');
    sh.appendRow(GA4_PUSH_HEADERS);
    sh.getRange('A:B').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, GA4_PUSH_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}

function pushGa4Orders_(contents) {
  var props = PropertiesService.getScriptProperties();
  var mid = props.getProperty('GA4_MEASUREMENT_ID');
  var sec = props.getProperty('GA4_API_SECRET');
  if (!mid || !sec) return { ok: false, error: 'GA4_MEASUREMENT_ID/GA4_API_SECRET 누락' };
  var orders = contents.orders || [];
  var date = String(contents.date || '');
  if (!orders.length) return { ok: true, sent: 0, skipped: 0, total: 0 };
  var sh = getGa4PushTab_();
  var existing = sh.getDataRange().getValues();
  var sentSet = {};
  for (var i = 1; i < existing.length; i++) sentSet[String(existing[i][0])] = true;
  var newRows = [], sentN = 0, skipped = 0, failed = 0;
  var ga4Url = 'https://www.google-analytics.com/mp/collect?api_secret=' + encodeURIComponent(sec) + '&measurement_id=' + encodeURIComponent(mid);
  orders.forEach(function (o) {
    var id = String(o.id || '');
    if (!id || sentSet[id]) { skipped++; return; }
    var body = { client_id: 'cafe24-' + id, events: [{ name: 'purchase', params: { transaction_id: id, value: parseFloat(o.value || 0), currency: 'KRW' } }] };
    var resp = UrlFetchApp.fetch(ga4Url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    var ok = resp.getResponseCode() < 300;
    newRows.push([id, date, parseFloat(o.value || 0), o.channel || '', new Date().toISOString(), ok ? 'sent' : 'fail ' + resp.getResponseCode()]);
    if (ok) sentN++; else failed++;
  });
  if (newRows.length) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, GA4_PUSH_HEADERS.length).setValues(newRows);
  return { ok: true, sent: sentN, skipped: skipped, failed: failed, total: orders.length };
}

// ===== Cafe24 결제 webhook → GA4 Measurement Protocol (외부결제 전환 보완) =====
// 네이버페이·톡 등 외부결제는 GA4가 자체적으로 못 잡아서 ~15%만 추적되는 문제
// → cafe24 결제완료 webhook → 이 함수 → GA4 MP로 purchase 이벤트 강제 발화
function handleCafe24Webhook_(contents) {
  var props = PropertiesService.getScriptProperties();
  var mid = props.getProperty('GA4_MEASUREMENT_ID');
  var sec = props.getProperty('GA4_API_SECRET');
  if (!mid || !sec) {
    return { ok: false, error: 'GA4_MEASUREMENT_ID / GA4_API_SECRET Script Property 설정 필요' };
  }
  var resource = contents.resource || contents.order || contents;
  var orderId = String(resource.order_id || resource.order_no || resource.order_code || '');
  var amount = parseFloat(resource.payment_amount || resource.total_price || resource.order_price || 0);
  if (!orderId) return { ok: false, error: 'order_id 추출 실패', received: Object.keys(contents).join(',') };
  var clientId = 'cafe24-' + orderId;
  var body = {
    client_id: clientId,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: orderId,
        value: amount,
        currency: 'KRW',
      }
    }]
  };
  var ga4Url = 'https://www.google-analytics.com/mp/collect?api_secret=' + encodeURIComponent(sec) + '&measurement_id=' + encodeURIComponent(mid);
  var resp = UrlFetchApp.fetch(ga4Url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  return { ok: resp.getResponseCode() < 300, status: resp.getResponseCode(), transaction_id: orderId, value: amount };
}

// ===== 구글 캘린더 검색 (꿀동이 공구 일정 등 자동 조회) =====
function getCalendarEvents_(query, daysAhead, daysBack) {
  try {
    var now = new Date();
    var start = new Date(now.getTime() - daysBack * 86400000);
    var end = new Date(now.getTime() + daysAhead * 86400000);
    var cals = CalendarApp.getAllCalendars();
    var out = [];
    cals.forEach(function (cal) {
      try {
        var events = query ? cal.getEvents(start, end, { search: query }) : cal.getEvents(start, end);
        events.forEach(function (e) {
          out.push({
            cal: cal.getName(),
            title: e.getTitle(),
            start: Utilities.formatDate(e.getStartTime(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
            end: Utilities.formatDate(e.getEndTime(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
            allDay: e.isAllDayEvent(),
          });
        });
      } catch (e) { /* 캘린더 접근 권한 없으면 스킵 */ }
    });
    return { ok: true, count: out.length, events: out };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ===== 은우 메모 (개인 DM, 매일 아침 리포트에 노출) =====
function getMemoSheet() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sheet = ss.getSheetByName('메모');
  if (!sheet) {
    sheet = ss.insertSheet('메모');
    sheet.appendRow(['ID', '날짜', '내용', '긴급', '상태']);
    sheet.getRange('B:B').setNumberFormat('@');
    // 최초 생성 시 기존 memo.json 5건 시드 (유실 방지). 불필요한 건 버튼으로 완료 처리.
    var seed = [
      ['MEMO04', '2026-05-14', '여백 줄이기', 'N', '진행중'],
      ['MEMO05', '2026-05-14', 'Oracle VPS 셋업 이어서 하기 (방화벽 → Node.js → 파일 업로드 → cron) IP: 168.107.29.222', 'N', '진행중'],
      ['MEMO06', '2026-05-20', '최작가랑 촬영 일정 조율', 'N', '진행중'],
      ['MEMO07', '2026-05-21', '바질페스토 소량 소분 아이디어 패키지 구상', 'N', '진행중'],
      ['MEMO08', '2026-05-21', '택배에 들어갈 엽서 → 미주 기획 중', 'N', '진행중']
    ];
    sheet.getRange(2, 1, seed.length, 5).setValues(seed);
  }
  return sheet;
}

function addMemo(content, chatId, date) {
  var sheet = getMemoSheet();
  var memoId = generateWorkId();
  sheet.appendRow([memoId, date, content, 'N', '진행중']);
  var keyboard = { inline_keyboard: [[
    { text: '🚨 긴급', callback_data: 'memo:URGENT:' + memoId },
    { text: '✅ 완료', callback_data: 'memo:DONE:' + memoId }
  ]]};
  sendTGMessage(chatId, '📝 <b>메모 등록</b> (' + memoId + ')\n' + content, keyboard);
}

function updateMemoStatus(memoId, act, chatId, callbackQuery) {
  var sheet = getMemoSheet();
  var data = sheet.getLastRow() >= 2 ? sheet.getDataRange().getValues() : [];
  var rowIdx = -1, content = '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === memoId) { rowIdx = i + 1; content = data[i][2]; break; }
  }
  if (act === 'DONE') {
    // 중복 클릭 대비: 이미 지워졌어도 메시지는 완료 상태로 정리 (못 찾음 스팸 X).
    if (rowIdx > 0) sheet.deleteRow(rowIdx);
    var doneText = '📝 <s>' + (content || '메모') + '</s>\n✅ 완료';
    if (callbackQuery) editTGMessage(chatId, callbackQuery.message.message_id, doneText);
    else sendTGMessage(chatId, doneText);
    return;
  }
  // URGENT
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 4).setValue('Y');
    var urgentText = '📝 <b>메모 🚨 긴급</b> (' + memoId + ')\n' + content;
    var keyboard = { inline_keyboard: [[ { text: '✅ 완료', callback_data: 'memo:DONE:' + memoId } ]]};
    if (callbackQuery) editTGMessage(chatId, callbackQuery.message.message_id, urgentText, keyboard);
    else sendTGMessage(chatId, urgentText, keyboard);
  } else if (callbackQuery) {
    editTGMessage(chatId, callbackQuery.message.message_id, '📝 ✅ 완료 (이미 처리됨)');
  }
}

function listMemos(chatId) {
  var sheet = getMemoSheet();
  if (sheet.getLastRow() < 2) { sendTGMessage(chatId, '메모 없음'); return; }
  var data = sheet.getDataRange().getValues();
  var lines = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]) === '완료') continue;
    var flag = String(data[i][3]) === 'Y' ? '🚨 ' : '• ';
    lines.push(flag + data[i][2] + '  (' + data[i][0] + ')');
  }
  if (!lines.length) { sendTGMessage(chatId, '메모 없음'); return; }
  sendTGMessage(chatId, '📝 <b>메모 ' + lines.length + '건</b>\n' + lines.join('\n'));
}

function getMemosData() {
  var sheet = getMemoSheet();
  if (sheet.getLastRow() < 2) return { ok: true, memos: [] };
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][4]) === '완료') continue;
    out.push({ id: String(data[i][0]), text: String(data[i][2]), urgent: String(data[i][3]) === 'Y', done: false });
  }
  return { ok: true, memos: out };
}

function sendTGMessage(chatId, text, replyMarkup) {
  var payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
}

function editTGMessage(chatId, messageId, text, replyMarkup) {
  var payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/editMessageText', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function saveDailyMessage(ss, date, time, sender, isBot, text) {
  getOrCreate(ss, '일일대화').appendRow([date, time, sender, isBot ? 'Y' : 'N', text]);
}

function saveTaggedMessage(ss, date, time, sender, tags, text) {
  getOrCreate(ss, '태그기록').appendRow([date, time, sender, tags.join(', '), text]);
}

function addReminderSheet(ss, text, sender, date) {
  var sheet = getOrCreate(ss, '리마인드');
  var data = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  var maxId = 0;
  data.forEach(function(row) { var n = parseInt(row[0]); if (!isNaN(n) && n > maxId) maxId = n; });
  sheet.appendRow([maxId + 1, text, sender, date, 'active', '']);
}

function markDoneSheet(ss, identifiers) {
  var sheet = getOrCreate(ss, '리마인드');
  if (sheet.getLastRow() < 1) return;
  var data = sheet.getDataRange().getValues();
  var toDelete = [];
  identifiers.forEach(function(id) {
    var num = parseInt(id);
    for (var i = 0; i < data.length; i++) {
      var match = (!isNaN(num) && parseInt(data[i][0]) === num) || (isNaN(num) && String(data[i][1]).indexOf(id) >= 0);
      if (match) { if (toDelete.indexOf(i + 1) < 0) toDelete.push(i + 1); break; }
    }
  });
  toDelete.sort(function(a,b){return b-a;});
  for (var k = 0; k < toDelete.length; k++) sheet.deleteRow(toDelete[k]);
}

function cleanupSheets() {
  ensureTextFormat();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var result = {};
  var d = ss.getSheetByName('일일대화');
  if (d && d.getLastRow() > 0) {
    var dv = d.getDataRange().getValues();
    var seen = {}, keep = [];
    for (var i = 0; i < dv.length; i++) {
      var k = normDate(dv[i][0]) + '|' + dv[i][1] + '|' + dv[i][2] + '|' + dv[i][4];
      if (seen[k]) continue;
      seen[k] = true;
      keep.push([normDate(dv[i][0]), dv[i][1], dv[i][2], dv[i][3], dv[i][4]]);
    }
    d.clearContents();
    if (keep.length) d.getRange(1, 1, keep.length, 5).setValues(keep);
    result.daily = dv.length + '->' + keep.length;
  }
  var t = ss.getSheetByName('태그기록');
  if (t && t.getLastRow() > 0) {
    var tv = t.getDataRange().getValues();
    var tseen = {}, tkeep = [];
    for (var i = 0; i < tv.length; i++) {
      var realTags = detectTags(String(tv[i][4]));
      if (realTags.length === 0) continue;
      var tk = normDate(tv[i][0]) + '|' + tv[i][1] + '|' + tv[i][2] + '|' + tv[i][4];
      if (tseen[tk]) continue;
      tseen[tk] = true;
      tkeep.push([normDate(tv[i][0]), tv[i][1], tv[i][2], realTags.join(', '), tv[i][4]]);
    }
    t.clearContents();
    if (tkeep.length) t.getRange(1, 1, tkeep.length, 5).setValues(tkeep);
    result.tagged = tv.length + '->' + tkeep.length;
  }
  var r = ss.getSheetByName('리마인드');
  if (r && r.getLastRow() > 0) {
    var rv = r.getDataRange().getValues();
    var rkeep = [];
    for (var i = 0; i < rv.length; i++) {
      if (String(rv[i][4]) === 'active') rkeep.push(rv[i]);
    }
    r.clearContents();
    if (rkeep.length) r.getRange(1, 1, rkeep.length, rkeep[0].length).setValues(rkeep);
    result.reminders = rv.length + '->' + rkeep.length;
  }
  console.log('cleanup: ' + JSON.stringify(result));
  return { ok: true, result: result };
}

function getMeetingSheet(ss) {
  return ss.getSheets().find(function(s) { return s.getSheetId() === 1386173441; });
}

function getOrCreate(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureTextFormat() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var d = ss.getSheetByName('일일대화'); if (d) d.getRange('A:B').setNumberFormat('@');
  var t = ss.getSheetByName('태그기록'); if (t) t.getRange('A:B').setNumberFormat('@');
  var r = ss.getSheetByName('리마인드'); if (r) r.getRange('D:D').setNumberFormat('@');
  return { ok: true };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== UX 사례 (월·목 발송) =====
var UX_HEADERS = ['일자', '요일', '기법명', '카테고리', '본문', '상태', '발송일시'];
function getUXTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('UX_사례');
  if (!sh) {
    sh = ss.insertSheet('UX_사례');
    sh.appendRow(UX_HEADERS);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, UX_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}
function saveUXDraft_(contents) {
  var sh = getUXTab_();
  var date = String(contents.date || '');
  if (!date) return { ok: false, error: 'no date' };
  // 같은 날짜 draft 있으면 덮어씀
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === date && String(data[i][5]) === 'draft') sh.deleteRow(i + 1);
  }
  sh.appendRow([date, contents.dow || '', contents.technique || '', contents.category || '', contents.body || '', contents.status || 'draft', '']);
  return { ok: true, date: date };
}
function getUXHistory_() {
  var sh = getUXTab_();
  if (sh.getLastRow() < 2) return { ok: true, history: [] };
  var rows = sh.getDataRange().getValues().slice(1);
  var history = rows.filter(function (r) { return String(r[5]) === 'sent'; }).map(function (r) {
    return { 일자: String(r[0]), 기법명: String(r[2]), 카테고리: String(r[3]) };
  });
  return { ok: true, history: history };
}
function getUXPending_() {
  var sh = getUXTab_();
  if (sh.getLastRow() < 2) return { ok: true, draft: null };
  var rows = sh.getDataRange().getValues().slice(1);
  // 가장 최근 draft 1개
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][5]) === 'draft') {
      return { ok: true, draft: { date: String(rows[i][0]), dow: String(rows[i][1]), technique: String(rows[i][2]), body: String(rows[i][4]) } };
    }
  }
  return { ok: true, draft: null };
}
function markUXSent_(date) {
  var sh = getUXTab_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date) && String(data[i][5]) === 'draft') {
      sh.getRange(i + 1, 6).setValue('sent');
      sh.getRange(i + 1, 7).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: 'no draft for date' };
}
function markUXSkip_(date) {
  var sh = getUXTab_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date) && String(data[i][5]) === 'draft') {
      sh.getRange(i + 1, 6).setValue('skipped');
      sh.getRange(i + 1, 7).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: 'no draft for date' };
}

// ===== 외부 cron 핑거: GAS 시간 트리거 -> GitHub Actions 강제 실행 =====
function triggerCXWorkflow_(workflowFile, mode) {
  var token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) { console.log('GH_TOKEN 없음'); return -1; }
  var url = 'https://api.github.com/repos/ewjung-byte/cx-report-bot/actions/workflows/' + workflowFile + '/dispatches';
  var payload = { ref: 'main' };
  if (mode) payload.inputs = { mode: mode };
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'cx-gas-trigger' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  console.log(workflowFile + (mode ? ' (' + mode + ')' : '') + ' -> HTTP ' + code);
  return code;
}
function triggerDailyReport() { return triggerCXWorkflow_('daily-report.yml'); }
function triggerUXDraft()     { return triggerCXWorkflow_('daily-report.yml', 'ux_draft'); }
function triggerUXSend()      { return triggerCXWorkflow_('daily-report.yml', 'ux_send'); }
function triggerCollector()   { return triggerCXWorkflow_('collect-messages.yml'); }
function setupCXTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'triggerDailyReport' || f === 'triggerCollector' || f === 'triggerUXDraftMon' || f === 'triggerUXDraftThu') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('triggerDailyReport').timeBased().atHour(9).everyDays(1).create();
  ScriptApp.newTrigger('triggerCollector').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('triggerUXDraftMon').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('triggerUXDraftThu').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create();
  console.log('트리거 등록 완료');
}
function triggerUXDraftMon() { return triggerCXWorkflow_('daily-report.yml', 'ux_draft'); }
function triggerUXDraftThu() { return triggerCXWorkflow_('daily-report.yml', 'ux_draft'); }
