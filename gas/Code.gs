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
  var props = PropertiesService.getScriptProperties();
  var lastId = parseInt(props.getProperty('TG_LAST_UPDATE_ID') || '0');
  var url = 'https://api.telegram.org/bot' + token + '/getUpdates?timeout=0&limit=100&offset=' + (lastId + 1);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (!data.ok || !data.result || !data.result.length) return;
  var updates = data.result;
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    if (u.callback_query) {
      handleCallbackQuery(u.callback_query);
    } else {
      handleTelegramUpdate(u);
    }
    if (u.update_id > lastId) lastId = u.update_id;
  }
  props.setProperty('TG_LAST_UPDATE_ID', String(lastId));
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
  if (text === '/도움' || text === '/help') {
    sendTGMessage(chatId, '<b>은우봇 명령어</b>\n/작업 [내용] — 새 작업 등록\n/작업목록 — 진행 중 작업 보기\n버튼으로 완료/중단/보류 처리');
    return;
  }
}

function handleCallbackQuery(query) {
  var data = String(query.data || '');
  var parts = data.split(':');
  if (parts[0] !== 'work') return;
  var status = parts[1]; // GO|STOP|HOLD
  var workId = parts[2];
  var chatId = query.message.chat.id;
  updateWorkStatus(workId, status, chatId, query);
  // answerCallbackQuery: spinner 끔
  var label = status === 'GO' ? '완료 ✅' : status === 'STOP' ? '중단 ❌' : '보류 ⏸';
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

function sendTGMessage(chatId, text, replyMarkup) {
  var payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
}

function editTGMessage(chatId, messageId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/editMessageText', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' }),
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
