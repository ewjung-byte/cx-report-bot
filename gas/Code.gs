var SHEET_ID = '1pBqKnyOQHwepzo65B_TCJ0dU-yjRL1aLs-TfEfBjXJI';
var GROUP_CHAT_ID = '-5227165092';
var EUNWOO_CHAT_ID = '8139301716';
var PERSONAL_METRICS_SHEET_ID = '1nxnsbqQSxv-lRcCDsUh6r16qoyeywVRJhPScd2N21bA';
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
  if ((m = text.match(/^\/메모\s+([\s\S]+)/))) { addMemo(m[1].trim(), chatId, date); return; }
  if (text === '/메모목록') { listMemos(chatId); return; }
  if (text === '/도움' || text === '/help') {
    sendTGMessage(chatId, '<b>은우봇 명령어</b>\n/작업 [내용] — 새 작업 등록\n/작업목록 — 진행 중 작업 보기\n/메모 [내용] — 메모 추가 (매일 아침 DM에 표시)\n/메모목록 — 메모 전체 보기\n버튼으로 완료/중단/보류 처리');
    return;
  }
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
  '회원_신규', '회원_재방문', '게스트_신규', '게스트_반복', '광고URL_정상', '광고URL_깨짐'];

function getDailySnapshotTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('일별_스냅샷');
  if (!sh) {
    sh = ss.insertSheet('일별_스냅샷');
    sh.appendRow(DAILY_SNAPSHOT_HEADERS);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, DAILY_SNAPSHOT_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}

function saveDailySnapshot_(contents) {
  var date = String(contents.date || '');
  if (!date) return { ok: false, error: 'no date' };
  var sh = getDailySnapshotTab_();
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === date) sh.deleteRow(i + 1);
  }
  var row = DAILY_SNAPSHOT_HEADERS.map(function (h) {
    var v = contents[h]; return v !== undefined && v !== null ? v : '';
  });
  sh.appendRow(row);
  return { ok: true, date: date };
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

// ===== 외부 cron 핑거: GAS 시간 트리거 -> GitHub Actions 강제 실행 =====
function triggerCXWorkflow_(workflowFile) {
  var token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!token) { console.log('GH_TOKEN 없음'); return -1; }
  var url = 'https://api.github.com/repos/ewjung-byte/cx-report-bot/actions/workflows/' + workflowFile + '/dispatches';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'cx-gas-trigger' },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  console.log(workflowFile + ' -> HTTP ' + code);
  return code;
}
function triggerDailyReport() { return triggerCXWorkflow_('daily-report.yml'); }
function triggerCollector()   { return triggerCXWorkflow_('collect-messages.yml'); }
function setupCXTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'triggerDailyReport' || f === 'triggerCollector') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('triggerDailyReport').timeBased().atHour(9).everyDays(1).create();
  ScriptApp.newTrigger('triggerCollector').timeBased().everyHours(2).create();
  console.log('트리거 등록 완료');
}
