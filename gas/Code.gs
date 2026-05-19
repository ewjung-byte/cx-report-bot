var SHEET_ID = '1pBqKnyOQHwepzo65B_TCJ0dU-yjRL1aLs-TfEfBjXJI';
var GROUP_CHAT_ID = '-5227165092';
var TAGS = ['/결정', '/액션', '/아이디어', '/공유', '/광고', '/소싱', '/CS', '/운영', '/디자인'];

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

function doPost(e) {
  try {
    var contents = JSON.parse(e.postData.contents);
    if (contents.update_id !== undefined) {
      handleTelegramUpdate(contents);
      return ContentService.createTextOutput('ok');
    }
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
    return jsonOut({ok: false, error: 'unknown action'});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function handleTelegramUpdate(update) {
  var msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== GROUP_CHAT_ID) return;
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
