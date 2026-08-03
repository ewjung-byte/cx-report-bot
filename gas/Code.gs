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
  var page = (e && e.parameter && e.parameter.page) || '';
  if (page === 'uxcases') {
    return HtmlService.createHtmlOutput(buildUXCasesHtml_())
      .setTitle('이태리정미소 UI/UX 케이스북')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  // 디자인 사례 채택상태 JSON (design-casebook.vercel.app 정적페이지가 JSONP로 읽음)
  if (page === 'designjson') {
    var out = JSON.stringify({ ok: true, cases: getDesignCasesForWeb_() });
    var cb = e && e.parameter && e.parameter.callback;
    if (cb) return ContentService.createTextOutput(cb + '(' + out + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput('CX Bot OK');
}

// 📚 UX 케이스북 페이지 — UX_사례 시트 사례를 HTML로 (시트=SSOT, 추가 즉시 반영)
// D2C 케이스북(ij-d2c-cases.pages.dev) 디자인 참고: 로그인 게이트·다크헤더+통계·카드그리드·모달·필터.
// 카드 ⭐채택/패스/되돌리기 → google.script.run setUXCaseStatus 콜백으로 시트 상태칸 기록.
function buildUXCasesHtml_() {
  var sh = getUXTab_();
  var rows = sh.getLastRow() >= 2 ? sh.getDataRange().getValues().slice(1) : [];
  // 본문 있고 노출 상태(draft/skipped 제외)인 것만 → JSON으로 클라이언트에 주입, 렌더는 JS가
  var cases = rows.filter(function (r) {
    var st = String(r[5]);
    return (st === 'sent' || st === '케이스북' || st === '채택' || st === '패스') && String(r[4]).trim();
  }).map(function (r) {
    return { date: String(r[0]), dow: String(r[1]), title: String(r[2]), cat: String(r[3]), body: String(r[4]), status: String(r[5]) };
  });
  var json = JSON.stringify(cases).replace(/</g, '\\u003c'); // </script>·< 깨짐 방지
  var todos = getUXTodos_();
  var tjson = JSON.stringify(todos).replace(/</g, '\\u003c');
  var designs = getDesignCasesForWeb_();
  var djson = JSON.stringify(designs).replace(/</g, '\\u003c');

  var css =
    ':root{--cream:#f8f7f5;--gold:#D9BC82;--navy:#0d1f3c;--warm:#f0ede8;--st-pass:#9e9e9e;--border:rgba(0,0,0,.08);--shadow:0 2px 8px rgba(0,0,0,.06)}' +
    '*{box-sizing:border-box;margin:0;padding:0}html,body{font-family:-apple-system,BlinkMacSystemFont,Pretendard,"Noto Sans KR",sans-serif;background:var(--cream);color:var(--navy);line-height:1.6;-webkit-font-smoothing:antialiased}' +
    'header{background:linear-gradient(160deg,#0a0e1a,#1a2540);color:#fff;padding:32px 5vw 28px}.head-row{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;max-width:1200px;margin:0 auto}' +
    '.title h1{font-size:28px;font-weight:300;letter-spacing:2px}.title .acc{color:var(--gold);font-weight:600}.title .sub{color:rgba(255,255,255,.6);font-size:13px;margin-top:4px}' +
    '.stat{display:flex;gap:24px}.stat-item{text-align:right}.stat-item .v{color:var(--gold);font-size:20px;font-weight:600}.stat-item .l{color:rgba(255,255,255,.5);font-size:11px;letter-spacing:.5px;margin-top:2px}' +
    '.wrap{max-width:1200px;margin:0 auto;padding:24px 5vw 80px}' +
    '.filters{background:#fff;border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:14px;padding:18px 22px;margin-bottom:22px;box-shadow:0 2px 12px rgba(13,31,60,.04)}' +
    '.filter-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.filter-row:last-child{margin-bottom:0}.filter-row .label{font-size:11px;color:var(--navy);font-weight:700;min-width:54px;letter-spacing:.8px}' +
    '.chip{padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:#fff;font-size:12px;cursor:pointer;transition:.15s;color:#333;font-weight:500}.chip:hover{background:var(--warm);border-color:var(--gold)}.chip.active{background:var(--navy);color:#fff;border-color:var(--navy);font-weight:600}' +
    '#search{padding:8px 14px;border-radius:20px;border:1px solid var(--border);font-size:13px;width:200px;outline:none;font-family:inherit}#search:focus{border-color:var(--gold)}' +
    '.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}' +
    '.card{background:#fff;border-radius:14px;padding:20px;cursor:pointer;border:1px solid var(--border);box-shadow:var(--shadow);transition:.2s;position:relative;overflow:hidden;display:flex;flex-direction:column}' +
    '.card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08);border-color:var(--gold)}.card.passed{opacity:.6}.card .stripe{position:absolute;top:0;left:0;right:0;height:4px}' +
    '.card .c-meta{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px;align-items:center}.card .c-meta span{font-size:10px;background:var(--warm);padding:3px 8px;border-radius:10px;color:#444;font-weight:500}' +
    '.card .name{font-size:18px;font-weight:700;color:var(--navy);line-height:1.35;margin-bottom:8px}.card .summary{font-size:13px;color:#555;line-height:1.55;flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}' +
    '.badge{padding:3px 9px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.3px}.badge.adopt{background:#fff4d6;color:#9a7400}.badge.pass{background:#eee;color:#777}' +
    '.qa{display:flex;gap:6px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)}.qa-btn{flex:1;padding:8px 4px;font-size:12px;font-weight:700;border:1px solid var(--border);border-radius:8px;background:#fff;color:#777;cursor:pointer;transition:.12s;font-family:inherit}' +
    '.qa-btn:hover{border-color:var(--gold);color:var(--navy);background:var(--cream)}.qa-btn.adopt{color:var(--navy)}.qa-btn.on{background:var(--gold);color:#fff;border-color:var(--gold)}.qa-btn.restore{background:var(--navy);color:#fff;border-color:var(--navy)}.qa-btn:disabled{opacity:.5;cursor:default}' +
    '.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:none;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto}.modal.open{display:flex}' +
    '.modal-inner{background:var(--cream);max-width:760px;width:100%;border-radius:18px;padding:36px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3)}.modal-close{position:absolute;top:18px;right:22px;font-size:28px;color:#666;cursor:pointer;background:none;border:none;line-height:1}.modal-close:hover{color:#c0392b}' +
    '.m-head{border-bottom:2px solid var(--gold);padding-bottom:18px;margin-bottom:20px}.m-head h2{font-size:26px;font-weight:700;color:var(--navy);margin-bottom:10px}.m-meta{display:flex;gap:8px;flex-wrap:wrap}.m-meta span{font-size:11px;background:#fff;padding:4px 10px;border-radius:12px;color:#555;border:1px solid var(--border)}' +
    '.m-body{font-size:14px;color:#333;line-height:1.8;white-space:pre-wrap}.m-qa{display:flex;gap:8px;margin-top:24px}.m-qa .qa-btn{padding:10px 16px;font-size:13px}' +
    '.empty{text-align:center;padding:80px 20px;color:#999;line-height:1.7}' +
    '.tabnav{background:#fff;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.04)}.tabnav-inner{max-width:1200px;margin:0 auto;display:flex;gap:4px;padding:0 5vw}' +
    '.tab{padding:14px 20px;background:none;border:none;font-size:14px;font-weight:600;color:#666;cursor:pointer;white-space:nowrap;border-bottom:3px solid transparent;font-family:inherit}.tab:hover{color:var(--navy);background:var(--warm)}.tab.active{color:var(--navy);border-bottom-color:var(--gold)}' +
    '.tab .cnt{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:var(--gold);color:#fff;font-size:10px;font-weight:700}' +
    '.pane{display:none}.pane.active{display:block}' +
    '.qa-btn.todo-add{color:#1565c0}.qa-btn.todo-in{color:#27ae60;border-color:#cdebd6}' +
    '.todos{display:grid;grid-template-columns:1fr;gap:14px;max-width:900px}' +
    '.todo{background:#fff;border-radius:12px;padding:20px;border:1px solid var(--border);box-shadow:var(--shadow);position:relative}.todo.done{opacity:.62}' +
    '.todo .t-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center}.todo .t-meta span{font-size:10px;background:var(--warm);padding:3px 8px;border-radius:10px;color:#444;font-weight:500}' +
    '.todo .t-name{font-size:17px;font-weight:700;color:var(--navy);margin-bottom:10px}' +
    '.todo .t-action{font-size:14px;color:#333;line-height:1.65;padding:12px 14px;background:linear-gradient(135deg,#fff7e0,#fff2cc);border-radius:8px;border-left:3px solid var(--gold);white-space:pre-wrap}' +
    '.todo .t-bar{display:flex;gap:6px;align-items:center;margin-top:14px;flex-wrap:wrap}.tg-btn{padding:7px 14px;border:1.5px solid var(--border);border-radius:8px;background:#fff;font-size:12px;font-weight:700;cursor:pointer;color:#666;font-family:inherit}.tg-btn:disabled{opacity:.5}' +
    '.tg-btn.active[data-s="할일"]{background:#888;color:#fff;border-color:#888}.tg-btn.active[data-s="진행중"]{background:var(--gold);color:#fff;border-color:var(--gold)}.tg-btn.active[data-s="완료"]{background:#27ae60;color:#fff;border-color:#27ae60}' +
    '.tg-rm{margin-left:auto;color:#bbb;background:none;border:none;font-size:12px;cursor:pointer;font-family:inherit}.tg-rm:hover{color:#c0392b}' +
    '@media(max-width:640px){header{padding:20px 16px}.title h1{font-size:20px}.stat{gap:14px}.stat-item .v{font-size:16px}.wrap{padding:16px 14px 60px}.cards{grid-template-columns:1fr}.modal-inner{padding:24px 20px}.m-head h2{font-size:21px}}';

  var html =
    '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>UI/UX 케이스북 · 이태리정미소</title><style>' + css + '</style></head><body>' +
    '<header><div class="head-row"><div class="title"><h1>UX <span class="acc">CASEBOOK</span></h1>' +
    '<div class="sub">은우봇 월·목 UI/UX 사례 · 채택/패스 큐레이션</div></div>' +
    '<div class="stat"><div class="stat-item"><div class="v" id="s-total">0</div><div class="l">CASES</div></div>' +
    '<div class="stat-item"><div class="v" id="s-adopt">0</div><div class="l">채택</div></div>' +
    '<div class="stat-item"><div class="v" id="s-pass">0</div><div class="l">패스</div></div></div></div></header>' +
    '<nav class="tabnav"><div class="tabnav-inner">' +
    '<button class="tab active" data-tab="cases">📚 UX 케이스북</button>' +
    '<button class="tab" data-tab="designs">🎨 디자인 사례 <span class="cnt" id="design-cnt">0</span></button>' +
    '<button class="tab" data-tab="todos">📋 내 할일 <span class="cnt" id="todo-cnt">0</span></button>' +
    '</div></nav>' +
    '<div class="wrap">' +
    '<div class="pane active" id="pane-cases"><div class="filters">' +
    '<div class="filter-row"><span class="label">상태</span><div id="f-status"></div>' +
    '<span style="flex:1"></span><input id="search" placeholder="검색…"></div>' +
    '<div class="filter-row"><span class="label">카테고리</span><div id="f-cat"></div></div></div>' +
    '<div class="cards" id="cards"></div></div>' +
    '<div class="pane" id="pane-designs"><div class="filters">' +
    '<div class="filter-row"><span class="label">상태</span><div id="d-status"></div>' +
    '<span style="flex:1"></span><input id="dsearch" placeholder="검색…"></div>' +
    '<div class="filter-row"><span class="label">브랜드</span><div id="d-brand"></div></div></div>' +
    '<div class="cards" id="dcards"></div></div>' +
    '<div class="pane" id="pane-todos"><div class="todos" id="todos"></div></div>' +
    '</div>' +
    '<div class="modal" id="modal"><div class="modal-inner"><button class="modal-close" id="mclose">&times;</button><div id="mwrap"></div></div></div>' +
    '<script>var CASES=' + json + ';var TODOS=' + tjson + ';var DESIGNS=' + djson + ';</script>' +
    '<script>' + UX_CASES_CLIENT_JS_ + '</script></body></html>';
  return html;
}

// 케이스북 클라이언트 렌더 스크립트 (별도 상수로 분리 — 가독성)
var UX_CASES_CLIENT_JS_ = [
  'var state={status:"live",cat:"all",q:""};',
  'function adopted(s){return s==="채택"||s==="케이스북";}function passed(s){return s==="패스";}',
  'function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
  'function d10(s){return String(s).slice(0,10);}',
  'function inTodo(d){for(var i=0;i<TODOS.length;i++)if(TODOS[i].date===d)return true;return false;}',
  'function todoBtn(d){return inTodo(d)?"<button class=\\"qa-btn todo-in\\" data-todo=\\"open\\">📋 할일에 있음</button>":"<button class=\\"qa-btn todo-add\\" data-todo=\\"add\\">📋 내 할일로</button>";}',
  // 카테고리별 stripe 색 (문자열 해시 → 고정 팔레트)
  'var PAL=["#5e35b1","#283593","#2e7d32","#e65100","#1565c0","#ad1457","#00838f","#6d4c41"];',
  'function catColor(c){if(!c)return "#b0b0b0";var h=0;for(var i=0;i<c.length;i++)h=(h*31+c.charCodeAt(i))>>>0;return PAL[h%PAL.length];}',
  'function summarize(b){var t=String(b).replace(/\\n+/g," ").replace(/\\s+/g," ").trim();return t.length>140?t.slice(0,140)+"…":t;}',
  // 필터칩 렌더
  'function chips(){',
  ' var st=[["live","전체"],["채택","⭐채택"],["패스","패스"]];',
  ' document.getElementById("f-status").innerHTML=st.map(function(o){return "<button class=\\"chip"+(state.status===o[0]?" active":"")+"\\" data-fs=\\""+o[0]+"\\">"+o[1]+"</button>";}).join("");',
  ' var cats={};CASES.forEach(function(c){if(c.cat)cats[c.cat]=1;});var cl=["all"].concat(Object.keys(cats).sort());',
  ' document.getElementById("f-cat").innerHTML=cl.map(function(c){return "<button class=\\"chip"+(state.cat===c?" active":"")+"\\" data-fc=\\""+c+"\\">"+(c==="all"?"전체":esc(c))+"</button>";}).join("");',
  '}',
  // 통계
  'function stats(){var a=0,p=0,t=0;CASES.forEach(function(c){if(passed(c.status))p++;else{t++;if(adopted(c.status))a++;}});',
  ' document.getElementById("s-total").textContent=t;document.getElementById("s-adopt").textContent=a;document.getElementById("s-pass").textContent=p;}',
  // 카드 그리드
  'function render(){chips();stats();',
  ' var q=state.q.toLowerCase();',
  ' var list=CASES.filter(function(c){',
  '   if(state.status==="live"&&passed(c.status))return false;',
  '   if(state.status==="채택"&&!adopted(c.status))return false;',
  '   if(state.status==="패스"&&!passed(c.status))return false;',
  '   if(state.cat!=="all"&&c.cat!==state.cat)return false;',
  '   if(q&&(c.title+" "+c.body).toLowerCase().indexOf(q)<0)return false;return true;});',
  ' list.sort(function(a,b){var ra=adopted(a.status)?0:1,rb=adopted(b.status)?0:1;if(ra!==rb)return ra-rb;return String(b.date).localeCompare(String(a.date));});',
  ' var box=document.getElementById("cards");',
  ' if(!list.length){box.innerHTML="<div class=\\"empty\\">조건에 맞는 사례가 없어요.</div>";return;}',
  ' box.innerHTML=list.map(function(c){',
  '   var ad=adopted(c.status),ps=passed(c.status);',
  '   var badge=ad?"<span class=\\"badge adopt\\">⭐채택</span>":(ps?"<span class=\\"badge pass\\">패스</span>":"");',
  '   var meta="<span>"+esc(d10(c.date))+(c.dow?" "+esc(c.dow):"")+"</span>"+(c.cat?"<span>"+esc(c.cat)+"</span>":"")+badge;',
  '   var qa;',
  '   if(ps)qa="<button class=\\"qa-btn restore\\" data-act=\\"sent\\">↩ 되돌리기</button>";',
  '   else if(ad)qa="<button class=\\"qa-btn on\\" data-act=\\"sent\\">✓ 채택됨</button><button class=\\"qa-btn\\" data-act=\\"패스\\">패스</button>"+todoBtn(c.date);',
  '   else qa="<button class=\\"qa-btn adopt\\" data-act=\\"채택\\">⭐ 채택</button><button class=\\"qa-btn\\" data-act=\\"패스\\">패스</button>";',
  '   return "<div class=\\"card"+(ps?" passed":"")+"\\" data-date=\\""+esc(c.date)+"\\">"+',
  '     "<div class=\\"stripe\\" style=\\"background:"+catColor(c.cat)+"\\"></div>"+',
  '     "<div class=\\"c-meta\\">"+meta+"</div><div class=\\"name\\">"+esc(c.title)+"</div>"+',
  '     "<div class=\\"summary\\">"+esc(summarize(c.body))+"</div>"+',
  '     "<div class=\\"qa\\" data-date=\\""+esc(c.date)+"\\">"+qa+"</div></div>";',
  ' }).join("");}',
  // 모달
  'function findCase(d){for(var i=0;i<CASES.length;i++)if(CASES[i].date===d)return CASES[i];return null;}',
  'function openModal(d){var c=findCase(d);if(!c)return;var ad=adopted(c.status),ps=passed(c.status);',
  ' var qa=ps?"<button class=\\"qa-btn restore\\" data-act=\\"sent\\">↩ 되돌리기</button>":',
  '  (ad?"<button class=\\"qa-btn on\\" data-act=\\"sent\\">✓ 채택됨 (해제)</button><button class=\\"qa-btn\\" data-act=\\"패스\\">패스</button>"+todoBtn(c.date):',
  '   "<button class=\\"qa-btn adopt\\" data-act=\\"채택\\">⭐ 채택</button><button class=\\"qa-btn\\" data-act=\\"패스\\">패스</button>");',
  ' document.getElementById("mwrap").innerHTML="<div class=\\"m-head\\"><h2>"+esc(c.title)+"</h2><div class=\\"m-meta\\"><span>"+esc(d10(c.date))+(c.dow?" "+esc(c.dow):"")+"</span>"+(c.cat?"<span>"+esc(c.cat)+"</span>":"")+"</div></div>"+',
  '  "<div class=\\"m-body\\">"+esc(c.body)+"</div><div class=\\"m-qa qa\\" data-date=\\""+esc(c.date)+"\\">"+qa+"</div>";',
  ' document.getElementById("modal").classList.add("open");}',
  'function closeModal(){document.getElementById("modal").classList.remove("open");}',
  // 상태 변경 콜백
  'function setStatus(date,status,btn){var grp=btn.parentNode;var bs=grp.querySelectorAll("button");for(var i=0;i<bs.length;i++)bs[i].disabled=true;btn.textContent="처리중…";',
  ' google.script.run.withSuccessHandler(function(res){if(res&&res.ok){var c=findCase(date);if(c)c.status=status;if(res.todo&&!inTodo(date))TODOS.push(res.todo);closeModal();render();renderTodos();}else{alert("실패: "+((res&&res.error)||"알수없음"));render();}})',
  ' .withFailureHandler(function(e){alert("오류: "+((e&&e.message)||e));for(var i=0;i<bs.length;i++)bs[i].disabled=false;}).setUXCaseStatus(date,status);}',
  // 내 할일 탭 렌더
  'function renderTodos(){var box=document.getElementById("todos");document.getElementById("todo-cnt").textContent=TODOS.length;',
  ' if(!TODOS.length){box.innerHTML="<div class=\\"empty\\">아직 할일이 없어요.<br>케이스북에서 ⭐채택한 사례를 \\u0027📋 내 할일로\\u0027 보내면 여기 쌓여요.</div>";return;}',
  ' var ord={"할일":0,"진행중":1,"완료":2};',
  ' var list=TODOS.slice().sort(function(a,b){var d=(ord[a.status]||0)-(ord[b.status]||0);if(d)return d;return String(b.date).localeCompare(String(a.date));});',
  ' box.innerHTML=list.map(function(t){',
  '   var meta="<span>"+esc(d10(t.date))+"</span>"+(t.cat?"<span>"+esc(t.cat)+"</span>":"");',
  '   var sb=["할일","진행중","완료"].map(function(s){return "<button class=\\"tg-btn"+(t.status===s?" active":"")+"\\" data-todo=\\""+s+"\\" data-s=\\""+s+"\\">"+s+"</button>";}).join("");',
  '   return "<div class=\\"todo"+(t.status==="완료"?" done":"")+"\\"><div class=\\"t-meta\\">"+meta+"</div><div class=\\"t-name\\">"+esc(t.title)+"</div>"+',
  '     "<div class=\\"t-action\\">"+esc(t.action||"(액션 추출 안 됨 — 시트 UX_할일에서 편집)")+"</div>"+',
  '     "<div class=\\"t-bar\\" data-date=\\""+esc(t.date)+"\\">"+sb+"<button class=\\"tg-rm\\" data-todo=\\"remove\\">빼기</button></div></div>";',
  ' }).join("");}',
  // 할일 콜백 (add/remove/상태)
  'function refreshTodos(d,action,res){',
  ' if(action==="add"){if(res&&res.todo&&!inTodo(d))TODOS.push(res.todo);}',
  ' else if(action==="remove"){TODOS=TODOS.filter(function(t){return t.date!==d;});}',
  ' else{for(var i=0;i<TODOS.length;i++)if(TODOS[i].date===d)TODOS[i].status=action;}',
  ' render();renderTodos();}',
  'function todoAction(d,action,btn){if(action==="open"){activate("todos");return;}',
  ' var bar=btn.parentNode;var bs=bar.querySelectorAll("button");for(var i=0;i<bs.length;i++)bs[i].disabled=true;',
  ' var rn=google.script.run.withSuccessHandler(function(res){if(res&&res.ok){refreshTodos(d,action,res);}else{alert("실패: "+((res&&res.error)||"알수없음"));for(var i=0;i<bs.length;i++)bs[i].disabled=false;}})',
  '  .withFailureHandler(function(e){alert("오류: "+((e&&e.message)||e));for(var i=0;i<bs.length;i++)bs[i].disabled=false;});',
  ' if(action==="add")rn.addUXTodo(d);else if(action==="remove")rn.removeUXTodo(d);else rn.setUXTodoStatus(d,action);}',
  // ===== 🎨 디자인 사례 탭 =====
  'var dstate={status:"채택",brand:"all",q:""};',
  'function dadopted(s){return s==="채택";}function dpassed(s){return s==="패스";}',
  'function findDesign(id){for(var i=0;i<DESIGNS.length;i++)if(DESIGNS[i].id===id)return DESIGNS[i];return null;}',
  'function dchips(){',
  ' var st=[["all","전체"],["채택","⭐채택"],["패스","패스"]];',
  ' document.getElementById("d-status").innerHTML=st.map(function(o){return "<button class=\\"chip"+(dstate.status===o[0]?" active":"")+"\\" data-ds=\\""+o[0]+"\\">"+o[1]+"</button>";}).join("");',
  ' var bs={};DESIGNS.forEach(function(c){if(c.brand)bs[c.brand]=1;});var bl=["all"].concat(Object.keys(bs).sort());',
  ' document.getElementById("d-brand").innerHTML=bl.map(function(b){return "<button class=\\"chip"+(dstate.brand===b?" active":"")+"\\" data-db=\\""+b+"\\">"+(b==="all"?"전체":esc(b))+"</button>";}).join("");',
  '}',
  'function renderDesigns(){',
  ' document.getElementById("design-cnt").textContent=DESIGNS.filter(function(c){return dadopted(c.status);}).length;',
  ' dchips();var q=dstate.q.toLowerCase();',
  ' var list=DESIGNS.filter(function(c){',
  '   if(dstate.status==="채택"&&!dadopted(c.status))return false;',
  '   if(dstate.status==="패스"&&!dpassed(c.status))return false;',
  '   if(dstate.brand!=="all"&&c.brand!==dstate.brand)return false;',
  '   if(q&&(c.title+" "+c.sub+" "+c.point+" "+c.apply).toLowerCase().indexOf(q)<0)return false;return true;});',
  ' list.sort(function(a,b){var ra=dadopted(a.status)?0:1,rb=dadopted(b.status)?0:1;if(ra!==rb)return ra-rb;return String(b.id).localeCompare(String(a.id));});',
  ' var box=document.getElementById("dcards");',
  ' if(!list.length){box.innerHTML="<div class=\\"empty\\">조건에 맞는 디자인 사례가 없어요.<br>개인 DM으로 온 사례를 \\u2b50채택하면 여기 모여요.</div>";return;}',
  ' box.innerHTML=list.map(function(c){',
  '   var ad=dadopted(c.status),ps=dpassed(c.status);',
  '   var badge=ad?"<span class=\\"badge adopt\\">\\u2b50채택</span>":(ps?"<span class=\\"badge pass\\">패스</span>":"<span class=\\"badge\\" style=\\"background:#e3f2fd;color:#1565c0\\">발송</span>");',
  '   var meta="<span>"+esc(c.id)+"</span>"+(c.brand?"<span>"+esc(c.brand)+"</span>":"")+badge;',
  '   var qa;',
  '   if(ps)qa="<button class=\\"qa-btn restore\\" data-dact=\\"발송\\">\\u21a9 되돌리기</button>";',
  '   else if(ad)qa="<button class=\\"qa-btn on\\" data-dact=\\"발송\\">\\u2713 채택됨</button><button class=\\"qa-btn\\" data-dact=\\"패스\\">패스</button>";',
  '   else qa="<button class=\\"qa-btn adopt\\" data-dact=\\"채택\\">\\u2b50 채택</button><button class=\\"qa-btn\\" data-dact=\\"패스\\">패스</button>";',
  '   return "<div class=\\"card dcard"+(ps?" passed":"")+"\\" data-did=\\""+esc(c.id)+"\\">"+',
  '     "<div class=\\"stripe\\" style=\\"background:"+(c.brand&&c.brand.charAt(0)==="A"?"#2e7d32":"#e65100")+"\\"></div>"+',
  '     "<div class=\\"c-meta\\">"+meta+"</div><div class=\\"name\\">"+esc(c.title)+"</div>"+',
  '     "<div class=\\"summary\\">"+esc(c.sub||c.point)+"</div>"+',
  '     "<div class=\\"qa\\" data-did=\\""+esc(c.id)+"\\">"+qa+"</div></div>";',
  ' }).join("");}',
  'function openDModal(id){var c=findDesign(id);if(!c)return;var ad=dadopted(c.status),ps=dpassed(c.status);',
  ' var qa=ps?"<button class=\\"qa-btn restore\\" data-dact=\\"발송\\">\\u21a9 되돌리기</button>":',
  '  (ad?"<button class=\\"qa-btn on\\" data-dact=\\"발송\\">\\u2713 채택됨 (해제)</button><button class=\\"qa-btn\\" data-dact=\\"패스\\">패스</button>":',
  '   "<button class=\\"qa-btn adopt\\" data-dact=\\"채택\\">\\u2b50 채택</button><button class=\\"qa-btn\\" data-dact=\\"패스\\">패스</button>");',
  ' var parts=[];if(c.sub)parts.push(c.sub);if(c.point)parts.push("\\ud83d\\udca1 "+c.point);if(c.apply)parts.push("\\ud83c\\udfaf 우리 적용: "+c.apply);var body=parts.join("\\n\\n");',
  ' var srcLine=c.src?"<div style=\\"margin-top:16px\\"><a href=\\""+esc(c.src)+"\\" target=\\"_blank\\" style=\\"color:#1565c0;font-size:13px\\">\\ud83d\\udd17 "+esc(c.src)+"</a></div>":"";',
  ' document.getElementById("mwrap").innerHTML="<div class=\\"m-head\\"><h2>"+esc(c.title)+"</h2><div class=\\"m-meta\\"><span>"+esc(c.id)+"</span>"+(c.brand?"<span>"+esc(c.brand)+"</span>":"")+"</div></div>"+',
  '  "<div class=\\"m-body\\">"+esc(body)+"</div>"+srcLine+"<div class=\\"m-qa qa\\" data-did=\\""+esc(c.id)+"\\">"+qa+"</div>";',
  ' document.getElementById("modal").classList.add("open");}',
  'function setDesignStatus(id,status,btn){var grp=btn.parentNode;var bs=grp.querySelectorAll("button");for(var i=0;i<bs.length;i++)bs[i].disabled=true;btn.textContent="처리중…";',
  ' google.script.run.withSuccessHandler(function(res){if(res&&res.ok){var c=findDesign(id);if(c)c.status=status;closeModal();renderDesigns();}else{alert("실패: "+((res&&res.error)||"알수없음"));renderDesigns();}})',
  ' .withFailureHandler(function(e){alert("오류: "+((e&&e.message)||e));for(var i=0;i<bs.length;i++)bs[i].disabled=false;}).setDesignStatusWeb(id,status);}',
  // 탭 전환
  'function activate(name){var tabs=document.querySelectorAll(".tab");for(var i=0;i<tabs.length;i++)tabs[i].classList.toggle("active",tabs[i].getAttribute("data-tab")===name);',
  ' document.getElementById("pane-cases").classList.toggle("active",name==="cases");',
  ' document.getElementById("pane-designs").classList.toggle("active",name==="designs");',
  ' document.getElementById("pane-todos").classList.toggle("active",name==="todos");',
  ' if(name==="designs")renderDesigns();}',
  'document.querySelector(".tabnav").addEventListener("click",function(e){var b=e.target.closest(".tab");if(b)activate(b.getAttribute("data-tab"));});',
  // 이벤트 위임 (data-todo 우선, 없으면 data-act)
  'document.addEventListener("click",function(ev){var t=ev.target;',
  ' var dbn=t.closest?t.closest("[data-dact]"):null;',
  ' if(dbn){ev.stopPropagation();var dg=dbn.closest("[data-did]");setDesignStatus(dg?dg.getAttribute("data-did"):null,dbn.getAttribute("data-dact"),dbn);return;}',
  ' var b=t.closest?t.closest("[data-todo],[data-act]"):null;',
  ' if(b){ev.stopPropagation();var grp=b.closest("[data-date]");var d=grp?grp.getAttribute("data-date"):null;',
  '   var td=b.getAttribute("data-todo");if(td){todoAction(d,td,b);}else{setStatus(d,b.getAttribute("data-act"),b);}return;}',
  ' if(t.closest&&t.closest(".modal-close")){closeModal();return;}',
  ' if(t.id==="modal"){closeModal();return;}',
  ' var dcard=t.closest?t.closest(".dcard"):null;if(dcard){openDModal(dcard.getAttribute("data-did"));return;}',
  ' var card=t.closest?t.closest(".card"):null;if(card){openModal(card.getAttribute("data-date"));}});',
  'document.getElementById("f-status").addEventListener("click",function(e){var b=e.target.closest(".chip");if(b){state.status=b.getAttribute("data-fs");render();}});',
  'document.getElementById("f-cat").addEventListener("click",function(e){var b=e.target.closest(".chip");if(b){state.cat=b.getAttribute("data-fc");render();}});',
  'document.getElementById("search").addEventListener("input",function(e){state.q=e.target.value;render();});',
  'document.getElementById("d-status").addEventListener("click",function(e){var b=e.target.closest(".chip");if(b){dstate.status=b.getAttribute("data-ds");renderDesigns();}});',
  'document.getElementById("d-brand").addEventListener("click",function(e){var b=e.target.closest(".chip");if(b){dstate.brand=b.getAttribute("data-db");renderDesigns();}});',
  'document.getElementById("dsearch").addEventListener("input",function(e){dstate.q=e.target.value;renderDesigns();});',
  'document.addEventListener("keydown",function(e){if(e.key==="Escape")closeModal();});',
  'render();renderTodos();renderDesigns();'
].join('\n');

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
    if (action === 'record_weekly_pv') {
      return jsonOut(recordWeeklyPV_(contents));
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
    if (action === 'set_clarity_memo') { // 클러리티 자동요약 적재 (이전 [클러리티] 줄만 갈아끼움)
      var _cp = PropertiesService.getScriptProperties();
      var _curM = (_cp.getProperty('EUNWOO_MEMO') || '').split('\n');
      var _keptM = _curM.filter(function (l) { return l.trim() && l.indexOf('[클러리티') < 0; });
      var _newM = (contents.lines || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
      _cp.setProperty('EUNWOO_MEMO', _keptM.concat(_newM).join('\n'));
      refreshCockpit_();
      return jsonOut({ ok: true, added: _newM.length, kept: _keptM.length });
    }
    if (action === 'append_clarity_candidates') { // 클러리티 패턴→액션 후보 (내용만 중복방지: 진행중이면 skip, 완료재발은 재등록)
      return jsonOut(appendClarityCandidates_(contents));
    }
    if (action === 'append_clarity_daily') { // 클러리티 숫자 추세 날짜별 upsert (협상카드용)
      return jsonOut(appendClarityDaily_(contents));
    }
    if (action === 'delete_postcard_utm') { // 엽서 QR 행 삭제 (대표가 엽서 QR 제거 → 측정 무의미)
      var _us = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('🔗 UTM 링크');
      var _d = _us.getDataRange().getValues(); var _n = 0;
      for (var i = _d.length - 1; i >= 1; i--) { var ln = (_d[i] || []).join(' '); if (/엽서|pc-v1/.test(ln) && /qr/i.test(ln)) { _us.deleteRow(i + 1); _n++; } }
      return jsonOut({ ok: true, deleted: _n });
    }
    if (action === 'backfill_cx_after') { // 완료인데 Before만 있고 After 빈 항목 → 현재 전환율로 채움(협상카드 빈칸 메움)
      var _bs = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
      var _af = currentConvLabel_('(완료시점·자동backfill)');
      var _n = 0;
      [_bs.getSheetByName('🛠 개입기록'), _bs.getSheetByName('✅ 완료_아카이브')].forEach(function (sh) {
        if (!sh || sh.getLastRow() < 2) return;
        var d = sh.getDataRange().getValues();
        for (var i = 1; i < d.length; i++) {
          if (String(d[i][7]) === '완료' && String(d[i][4]).trim() && !String(d[i][5]).trim()) { sh.getRange(i + 1, 6).setValue(_af); _n++; }
        }
      });
      return jsonOut({ ok: true, filled: _n, after: _af });
    }
    if (action === 'test_ux_dates') { // UX_사례 최근행 날짜 정규화 확인용
      var _us = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('UX_사례');
      var _d = _us.getDataRange().getValues().slice(1).slice(-6).map(function (r) { return { ymd: _uxYmd_(r[0]), status: String(r[5]), title: String(r[2]).slice(0, 25) }; });
      return jsonOut({ ok: true, rows: _d });
    }
    if (action === 'setup_notset_reminder') { // 6/20 10시 은우 텔레로 GA4 (not set) 검증 리마인더(일회성)
      ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'remindNotSetCheck') ScriptApp.deleteTrigger(t); });
      ScriptApp.newTrigger('remindNotSetCheck').timeBased().at(new Date(2026, 5, 20, 10, 0, 0)).create();
      return jsonOut({ ok: true, at: '2026-06-20 10:00' });
    }
    if (action === 'run_heartbeat') { return jsonOut(cxHeartbeat(true)); } // 수동 테스트(OK여도 발송)
    if (action === 'setup_heartbeat') { // 매일 10:30 헬스체크 트리거 등록 (중복 제거 후)
      ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cxHeartbeat') ScriptApp.deleteTrigger(t); });
      ScriptApp.newTrigger('cxHeartbeat').timeBased().atHour(10).nearMinute(30).everyDays(1).create();
      return jsonOut({ ok: true, scheduled: 'daily ~10:30' });
    }
    if (action === 'get_clarity_latest') { // 📹클러리티_일별 최신행 (리포트가 API 재호출 대신 읽음 — 한도 절약)
      var _cs = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('📹 클러리티_일별');
      if (!_cs || _cs.getLastRow() < 2) return jsonOut({ ok: true, row: null });
      var _lr = _cs.getRange(_cs.getLastRow(), 1, 1, 6).getValues()[0];
      return jsonOut({ ok: true, row: { date: _lr[0], inappSessions: _lr[1], inappDeadPct: _lr[2], inappQuickbackPct: _lr[3], inappRagePct: _lr[4], inappScrollDepth: _lr[5] } });
    }
    if (action === 'set_cx_today_actions') { // 일간 DM 액션 목록 저장 (나중에 버튼 콜백이 인덱스로 조회)
      PropertiesService.getScriptProperties().setProperty('CX_TODAY_ACTIONS', JSON.stringify(contents.actions || []));
      return jsonOut({ ok: true, n: (contents.actions || []).length });
    }
    if (action === 'test_cx_buttons') { // 액션 버튼 실발송 테스트 (은우 DM)
      var acts = contents.actions || [];
      PropertiesService.getScriptProperties().setProperty('CX_TODAY_ACTIONS', JSON.stringify(acts));
      var txt = '🧪 <b>버튼 테스트</b> — 오늘 액션\n' + acts.map(function (a, i) { return (i + 1) + '. ' + a; }).join('\n') + '\n\n각 줄 버튼 눌러봐 → 콕핏 진행중/나중에 들어가는지 확인';
      var kb = { inline_keyboard: acts.map(function (a, i) { return [
        { text: (i + 1) + ' ✅오늘', callback_data: 'cxa:T:' + i },
        { text: '📋나중에', callback_data: 'cxa:L:' + i },
        { text: '✕패스', callback_data: 'cxa:P:' + i }
      ]; }) };
      sendTGMessage(EUNWOO_CHAT_ID, txt, kb);
      return jsonOut({ ok: true, sent: acts.length });
    }
    if (action === 'dm') { // 은우 개인 DM 임의 발송 (공지·안내용, 2026-07-14)
      sendTGMessage(EUNWOO_CHAT_ID, String(contents.text || '(내용 없음)'));
      return jsonOut({ ok: true });
    }
    if (action === 'get_eunwoo_row') {
      return jsonOut(getEunwooCompassRow_());
    }
    if (action === 'track_alert_ages') {
      return jsonOut(trackAlertAges_(contents));
    }
    if (action === 'save_levers') {
      return jsonOut(saveLevers_(contents));
    }
    if (action === 'get_levers') {
      return jsonOut(getLevers_());
    }
    if (action === 'setup_utm_design') {
      return jsonOut(setupUtmDesign_());
    }
    if (action === 'cleanup_utm') {
      return jsonOut(cleanupUtm_());
    }
    if (action === 'init_eunwoo_tracking') {
      return jsonOut(initEunwooTracking_(contents));
    }
    if (action === 'append_paymethod_monthly') {
      return jsonOut(appendPayMethodMonthly_(contents));
    }
    if (action === 'append_paymember_monthly') {
      return jsonOut(appendPayMemberMonthly_(contents));
    }
    if (action === 'record_pay_breakdown') {
      return jsonOut(recordPayBreakdown_(contents));
    }
    if (action === 'record_pay_method_detail') {
      return jsonOut(recordPayMethodDetail_(contents));
    }
    if (action === 'record_traffic_monthly') {
      return jsonOut(recordTrafficMonthly_(contents));
    }
    if (action === 'record_utm_weekly') {
      return jsonOut(recordUtmWeekly_(contents));
    }
    if (action === 'record_button_weekly') {
      return jsonOut(recordButtonWeekly_(contents));
    }
    if (action === 'log_tweak') { // 🎛 트윅 패널 "클로드에게 보내기" — 변경내역 시트 적재 (2026-07-10 v3)
      // 브라우저에서 text/plain no-cors로 옴(CORS 회피) — contents 파싱은 동일. 은우가 "트윅 반영해줘" 하면 클로드가 이 탭 읽어 소스 반영.
      var _tss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
      var _tt = ensureSheetWithHeaders_(_tss, '🎛 트윅_수신', ['시각', '페이지', '셀렉터', '속성', 'before', 'after', '상태']);
      var _tc = contents.changes || [];
      _tc.forEach(function (c) { _tt.appendRow([new Date(), String(contents.url || ''), String(c.sel || ''), String(c.prop || ''), String(c.from || ''), String(c.to || ''), '대기']); });
      return jsonOut({ ok: true, added: _tc.length });
    }
    if (action === 'set_cx_after') { // /실측의 doPost판 — 완료 포함 After 갱신 (개입기록+아카이브)
      return jsonOut(setCxAfterAnywhere_(String(contents.keyword || ''), String(contents.after || '')));
    }
    if (action === 'set_done_since') { // ★"한 일" 정리 — 은우가 "지워" 할 때만. date 주면 그 시점부터, 없으면 오늘(=목록 비움)
      var _ds = String(contents.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'));
      PropertiesService.getScriptProperties().setProperty('DONE_SINCE', _ds);
      refreshCockpit_();
      return jsonOut({ ok: true, since: _ds });
    }
    if (action === 'dismiss_cx') { // 키워드 매칭 행 삭제+거부기억(원자적, 완료 보호) — /삭제의 doPost판
      var _kw = String(contents.keyword || '');
      var _ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('🛠 개입기록');
      if (!_ss || !_kw) return jsonOut({ ok: false, error: 'keyword 필요' });
      var _dd = _ss.getDataRange().getValues(); var _hits = [];
      for (var _i = _dd.length - 1; _i >= 1; _i--) {
        if (/완료/.test(String(_dd[_i][7]))) continue;
        if (String(_dd[_i][2]).toLowerCase().indexOf(_kw.toLowerCase()) >= 0) { _hits.push(String(_dd[_i][2])); _ss.deleteRow(_i + 1); }
      }
      _hits.forEach(function (c) { addCxDismissed_(c); });
      if (_hits.length) refreshCockpit_();
      return jsonOut({ ok: true, deleted: _hits.length, items: _hits });
    }
    if (action === 'append_cx_candidates') {
      return jsonOut(appendCxCandidates_(contents));
    }
    if (action === 'set_compass_remarks') {
      return jsonOut(setEunwooCompassRemarks_(contents.text || ''));
    }
    if (action === 'refresh_cockpit') {
      return jsonOut(refreshCockpit_());
    }
    if (action === 'set_one_thing') { // ONE THING 설정(빈값이면 클리어)
      var ot = String(contents.text || '').trim();
      setOneThing_(ot || '');
      if (ot) PropertiesService.getScriptProperties().setProperty('EUNWOO_ONE_THING', ot);
      else PropertiesService.getScriptProperties().deleteProperty('EUNWOO_ONE_THING');
      refreshCockpit_();
      return jsonOut({ ok: true, oneThing: ot });
    }
    if (action === 'clear_memo') { // 콕핏 메모 전체 비우기
      PropertiesService.getScriptProperties().deleteProperty('EUNWOO_MEMO');
      refreshCockpit_();
      return jsonOut({ ok: true });
    }
    if (action === 'send_next_design_case') { // 디자인 사례집 — 다음 미발송 1개 개인DM 발송 (report.js 데일리가 호출)
      return jsonOut(sendNextDesignCase_());
    }
    if (action === 'track_weekly') { // 📈 개입_추적 주별 적재 — report.js 주간이 호출(시트 쓰기는 GAS만)
      return jsonOut(trackWeeklyUpsert_(contents.rows || []));
    }
    if (action === 'append_design_cases') { // 디자인 케이스북 자동보충 — report.js가 Claude로 생성한 행 적재(시트 쓰기는 GAS만)
      return jsonOut(appendDesignCases_(contents.rows || []));
    }
    if (action === 'log_click') { // 단축링크(go.italy) 클릭 기록 — CF Pages Function이 클릭마다 호출 (GA4 인앱 누락 우회·실유입)
      return jsonOut(logShortlinkClick_(contents));
    }
    if (action === 'build_monthly_summary') {
      return jsonOut(buildEunwooMonthlySummary_(contents.month || ''));
    }
    if (action === 'archive_cx') {
      return jsonOut(archiveCx_());
    }
    if (action === 'set_cx_verdict') { // 개입기록 판정 변경(키워드 부분매칭). 폐기/보류/효과없음 등. After 선택.
      var _svr = setCxVerdictByKeyword_(contents.keyword || '', contents.verdict || '보류', contents.after || '');
      if (_svr.ok) refreshCockpit_();
      return jsonOut(_svr);
    }
    if (action === 'prune_cx') {
      return jsonOut(pruneCx_(contents.weekLabel || ''));
    }
    if (action === 'fix_postcard_utm') {
      var ush = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('🔗 UTM 링크');
      var ua = ush.getRange('A1:A20').getValues();
      var urow = -1;
      for (var ui = 1; ui < ua.length; ui++) { if (/엽서/.test(String(ua[ui][0]))) { urow = ui + 1; break; } }
      if (urow < 0) return jsonOut({ ok: false, error: '엽서행 없음' });
      var orig = String(ush.getRange(urow, 6).getValue());
      var sep = orig.indexOf('?') >= 0 ? '&' : '?';
      ush.getRange(urow, 5).setValue('pc-v1'); // campaign
      ush.getRange(urow, 7).setValue(orig + sep + 'utm_source=qr&utm_medium=print&utm_campaign=pc-v1'); // 최종 UTM
      ush.getRange(urow, 8).setValue('https://ijr.pages.dev/1'); // 단축
      return jsonOut({ ok: true, row: urow });
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
    if (action === 'create_utm_sheet') {
      return jsonOut(createUtmSheet_());
    }
    if (action === 'create_eunwoo_revenue_sheet') {
      return jsonOut(createEunwooRevenueSheet_());
    }
    if (action === 'create_brandconnect_sheet') {
      return jsonOut(createBrandConnectSheet_());
    }
    if (action === 'list_sheets') {
      var lss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
      return jsonOut({ ok: true, sheets: lss.getSheets().map(function(s){ return { name: s.getName(), gid: s.getSheetId() }; }) });
    }
    if (action === 'delete_sheet') { // 탭 삭제 (정확한 이름 1개씩, 비어있을 때만 — 안전장치)
      var dss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
      var sh = dss.getSheetByName(contents.name);
      if (!sh) return jsonOut({ ok: false, error: '없는 탭: ' + contents.name });
      if (sh.getLastRow() > 1 && !contents.force) return jsonOut({ ok: false, error: '데이터 있음(force 필요): ' + contents.name + ' 행' + sh.getLastRow() });
      dss.deleteSheet(sh);
      return jsonOut({ ok: true, deleted: contents.name });
    }
    if (action === 'sheets_audit') {
      var ass = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
      return jsonOut({ ok: true, sheets: ass.getSheets().map(function (s) {
        var lr = s.getLastRow(), lc = s.getLastColumn();
        var hdr = lr >= 1 ? s.getRange(1, 1, 1, Math.min(lc, 8)).getValues()[0].join(' | ') : '';
        var last = lr >= 2 ? String(s.getRange(lr, 1).getValue()) : '';
        return { name: s.getName(), rows: lr, cols: lc, header: hdr, lastA: last };
      }) });
    }
    return jsonOut({ok: false, error: 'unknown action'});
  } catch(err) {
    return jsonOut({ok: false, error: err.message});
  }
}

function createUtmSheet_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  // 이미 있으면 삭제 후 재생성
  var existing = ss.getSheetByName('🔗 UTM 링크');
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet('🔗 UTM 링크');

  // 목표 정의 행
  sheet.getRange('A1').setValue('📌 이 시트의 목표');
  sheet.getRange('B1').setValue('GA4에서 채널별 트래픽 기여를 정확히 측정한다. 모든 외부 링크에 UTM 파라미터를 표준 규칙으로 달아 source / medium / campaign을 통일 — 그래야 "광고가 얼마나 팔았는지" "엽서 QR이 실제로 유입됐는지" "친구톡이 재구매로 이어졌는지" GA4에서 채널별로 정확히 분리해서 볼 수 있다.');
  sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#D9BC82');
  sheet.getRange('B1').setWrap(true);

  // 명명 규칙
  sheet.getRange('A3').setValue('📐 명명 규칙');
  sheet.getRange('B3').setValue('utm_source: ig(인스타) / fb(페북) / kakao(카카오채널) / qr(QR코드) / naver(네이버) / email');
  sheet.getRange('A4').setValue('');
  sheet.getRange('B4').setValue('utm_medium: paid_social(유료SNS) / cta(알림톡버튼) / print(인쇄물) / organic / email');
  sheet.getRange('A5').setValue('');
  sheet.getRange('B5').setValue('utm_campaign: 소문자+하이픈. 예: recipe-card-vol01 / welcome / restock / grade-coupon / 0312-pesto   ⚠️ 공백X 한글X 대문자X');
  sheet.getRange('A3:B5').setBackground('#f8f7f5').setFontColor('#333');
  sheet.getRange('A3').setFontWeight('bold');

  // 헤더
  var headers = ['채널명','용도','utm_source','utm_medium','utm_campaign','원본 URL','최종 UTM URL','단축 URL','담당자','생성일','상태','GA4 확인','비고'];
  sheet.getRange('A7:M7').setValues([headers])
    .setFontWeight('bold').setBackground('#2C3E2D').setFontColor('#ffffff');

  // 데이터
  var rows = [
    ['엽서 QR (Vol.01)','바질페스토 동봉 엽서 — 이달의 레시피','qr','print','recipe-card-vol01',
     'https://italy-jungmiso.com/article/%EB%A0%88%EC%8B%9C%ED%94%BC/8/793/',
     'https://italy-jungmiso.com/article/%EB%A0%88%EC%8B%9C%ED%94%BC/8/793/?utm_source=qr&utm_medium=print&utm_campaign=recipe-card-vol01',
     '','은우','2026-06-02','🟢 활성','미확인','엽서 A면 QR 코드용'],
    ['메타 광고 (표준)','인스타그램/페이스북 광고 — 바질페스토','ig','paid_social','pesto-main',
     'https://italy-jungmiso.com/surl/p/83',
     'https://italy-jungmiso.com/surl/p/83?utm_source=ig&utm_medium=paid_social&utm_campaign=pesto-main',
     '','미주','2026-06-02','🟡 미적용','미확인','광고 15개 UTM 없이 운영 중 — 미주 적용 필요'],
    ['친구톡 웰컴쿠폰','신규 가입자 첫 구매 유도 버튼','kakao','cta','welcome',
     'https://italy-jungmiso.com/',
     'https://italy-jungmiso.com/?utm_source=kakao&utm_medium=cta&utm_campaign=welcome',
     '','미주','2026-06-02','🔴 미적용','미확인','GA4서 (direct)로 묻히는 중'],
    ['친구톡 재입고알림','재입고 알림 → 상품 페이지','kakao','cta','restock',
     'https://italy-jungmiso.com/product/detail.html?product_no=17',
     'https://italy-jungmiso.com/product/detail.html?product_no=17?utm_source=kakao&utm_medium=cta&utm_campaign=restock',
     '','미주','2026-06-02','🔴 미적용','미확인','바질페스토 재입고 알림용'],
    ['친구톡 등급쿠폰','등급 쿠폰 발송 후 자사몰 유입','kakao','cta','grade-coupon',
     'https://italy-jungmiso.com/',
     'https://italy-jungmiso.com/?utm_source=kakao&utm_medium=cta&utm_campaign=grade-coupon',
     '','미주','2026-06-02','🔴 미적용','미확인','5월 등급쿠폰 사용률 0% — UTM 없어서 추적 불가'],
    ['네이버 쇼핑 (자연)','네이버 쇼핑 자연 유입 — UTM 불필요','naver','organic','',
     'https://italy-jungmiso.com/','','','은우','2026-06-02','✅ 자동추적','✓','GA4가 utm_source=naver 자동 인식']
  ];
  sheet.getRange(8, 1, rows.length, 13).setValues(rows);

  // 열 너비
  sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 90);  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 150); sheet.setColumnWidth(6, 260);
  sheet.setColumnWidth(7, 320); sheet.setColumnWidth(8, 120);
  sheet.setColumnWidth(9, 70);  sheet.setColumnWidth(10, 90);
  sheet.setColumnWidth(11, 90); sheet.setColumnWidth(12, 80);
  sheet.setColumnWidth(13, 200);
  sheet.setRowHeight(1, 80); sheet.setRowHeight(7, 30);

  return { ok: true, url: ss.getUrl(), id: ss.getId(), sheetName: '🔗 UTM 링크' };
}

function createEunwooRevenueSheet_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var existing = ss.getSheetByName('💰 은우 귀속 매출');
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet('💰 은우 귀속 매출');

  // 목표 정의
  sheet.getRange('A1').setValue('📌 이 시트의 목표');
  sheet.getRange('B1').setValue('은우가 직접 창출한 매출을 채널별로 "은우 귀속 매출"로 기록한다. 단순 회사 매출이 아니라, 카마솥 협상 카드 + 몸값 증명용. 추적 안 되면 회사 매출로 흡수돼 협상 카드 0 → 첫 컨택부터 귀속 추적 내장. 성공 기준 = 월 은우 귀속 매출 + 그 구매자 90일 재구매율.');
  sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#D9BC82');
  sheet.getRange('B1').setWrap(true);

  // 채널 전략 메모
  sheet.getRange('A3').setValue('📐 채널 전략');
  sheet.getRange('B3').setValue('자동 트랙(백그라운드): 카페24 제휴마케팅 = 무조건 먼저 깔아둠. 수동 트랙(1인 과부하라 1개만 집중): 네이버 브랜드커넥트 우선 / 인스타·유튜브 대기.');
  sheet.getRange('A4').setValue('');
  sheet.getRange('B4').setValue('귀속 방식: 브랜드커넥트=플랫폼 리포트(공구별 자동분리) / 카페24제휴=제휴링크 자동추적 / 인스타·유튜브=전용 쿠폰코드 or UTM. ⚠️ 수동 채널 동시 착수 금지.');
  sheet.getRange('A3:B4').setBackground('#f8f7f5').setFontColor('#333');
  sheet.getRange('A3').setFontWeight('bold');

  // 요약 영역
  sheet.getRange('A6').setValue('📊 월 요약');
  sheet.getRange('A6').setFontWeight('bold').setFontColor('#2C3E2D');
  sheet.getRange('A7').setValue('이번 달 귀속 매출 합계');
  sheet.getRange('B7').setFormula('=SUM(G11:G)');
  sheet.getRange('C7').setValue('평균 90일 재구매율');
  sheet.getRange('D7').setFormula('=IFERROR(AVERAGE(K11:K),"")');
  sheet.getRange('A7:D7').setBackground('#fafff8').setFontWeight('bold');
  sheet.getRange('B7').setNumberFormat('#,##0"원"');
  sheet.getRange('D7').setNumberFormat('0.0%');

  // 헤더
  var headers = ['시작일','채널','트랙','캠페인(공구·시딩명)','크리에이터/파트너','귀속 방식','매출(원)','구매자수','객단가','90일 재구매자','90일 재구매율','상태','메모'];
  sheet.getRange('A10:M10').setValues([headers])
    .setFontWeight('bold').setBackground('#2C3E2D').setFontColor('#ffffff');

  // 첫 데이터 행 (브랜드커넥트 바질 공구)
  var rows = [
    ['2026-06-05','네이버 브랜드커넥트','수동','클래식 바질페스토 공동구매 1차','(크리에이터 선정 중)','브랜드커넥트 플랫폼 리포트','','','','','','🟢 오픈','첫 공구 — 수확당일제조/바질25%/3무 소구. 매출·구매자수는 공구 종료 후 입력'],
    ['','카페24 제휴마케팅','자동','자동 시딩(상시)','파트너 모집','제휴링크 자동추적','','','','','','⏳ 셋업 예정','백그라운드 자동 트랙. 기능 활성화+파트너 모집 링크 필요'],
    ['','네이버 브랜드커넥트 외','수동','(대기)','—','—','','','','','','⚪ 대기','인스타·유튜브 = 브랜드커넥트 첫 성과 나온 뒤 재평가(1인 과부하 방지)']
  ];
  sheet.getRange(11, 1, rows.length, 13).setValues(rows);

  // 자동계산 수식 (객단가 I = 매출/구매자, 재구매율 K = 재구매자/구매자)
  for (var r = 11; r <= 40; r++) {
    sheet.getRange(r, 9).setFormula('=IF(N(H' + r + ')>0,G' + r + '/H' + r + ',"")');   // 객단가
    sheet.getRange(r, 11).setFormula('=IF(N(H' + r + ')>0,J' + r + '/H' + r + ',"")');  // 재구매율
  }
  sheet.getRange('G11:G40').setNumberFormat('#,##0');
  sheet.getRange('I11:I40').setNumberFormat('#,##0"원"');
  sheet.getRange('K11:K40').setNumberFormat('0.0%');

  // 열 너비
  sheet.setColumnWidth(1, 80);  sheet.setColumnWidth(2, 150); sheet.setColumnWidth(3, 60);
  sheet.setColumnWidth(4, 200); sheet.setColumnWidth(5, 150); sheet.setColumnWidth(6, 160);
  sheet.setColumnWidth(7, 100); sheet.setColumnWidth(8, 80);  sheet.setColumnWidth(9, 90);
  sheet.setColumnWidth(10, 100);sheet.setColumnWidth(11, 100);sheet.setColumnWidth(12, 90);
  sheet.setColumnWidth(13, 280);
  sheet.setRowHeight(1, 90); sheet.setRowHeight(10, 30);

  return { ok: true, url: ss.getUrl(), id: ss.getId(), sheetName: '💰 은우 귀속 매출' };
}

function createBrandConnectSheet_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var existing = ss.getSheetByName('🛒 브랜드커넥트 수수료');
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet('🛒 브랜드커넥트 수수료');

  // 목표
  sheet.getRange('A1').setValue('📌 이 표의 목표');
  sheet.getRange('B1').setValue('브랜드커넥트에 상품 걸 때, 모든 수수료(크리에이터+네이버연동+결제) 다 떼고 진짜 남는 실마진을 본다. 노란셀(E:크리에이터·G:연동·H:결제) 조정 → 실수령·실마진·실마진율 자동 계산. 실마진율 마이너스면 절대 걸면 안 됨.');
  sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#D9BC82');
  sheet.getRange('B1').setWrap(true);

  // 수수료 기준 메모
  sheet.getRange('A3').setValue('📐 수수료 기준');
  sheet.getRange('B3').setValue('크리에이터: ③공동구매=25%(꿀동이 실제값) / ②쇼핑커넥트=10~15%. 네이버연동=2%·결제=3.4%(노란셀 조정). 배송비=판매자 실부담: 주방기기 무료배송→4,000 전액부담 / 식품 소비자3,500부담→순부담1,400(40,000원↑ 묶음은 4,900). 쿠팡도 동일. ⚠️쿠팡 수수료는 카테고리별(식품·주방 ~11%)·정산서 확인.');
  sheet.getRange('A3:B3').setBackground('#f8f7f5').setFontColor('#333');
  sheet.getRange('A3').setFontWeight('bold').setWrap(false);
  sheet.getRange('B3').setWrap(true);
  sheet.setRowHeight(3, 50);

  // 섹션 헤더 (4행)
  sheet.getRange('D4').setValue('◀ 네이버 (브랜드커넥트 계산기준) ▶');
  sheet.getRange('D4:L4').merge().setHorizontalAlignment('center')
    .setBackground('#03c75a').setFontColor('#fff').setFontWeight('bold');
  sheet.getRange('M4').setValue('◀ 쿠팡 (참고 손익) ▶');
  sheet.getRange('M4:Q4').merge().setHorizontalAlignment('center')
    .setBackground('#e84118').setFontColor('#fff').setFontWeight('bold');

  // 헤더 (5행)
  var headers = ['상품','카테고리','원가',
    '네이버가','네이버 배송비','크리에이터 수수료율','크리에이터액','연동(2%)','결제(3.4%)','수수료+배송 합','네이버 실마진','네이버 실마진율',
    '쿠팡가','쿠팡 배송비','쿠팡 수수료율','쿠팡 실마진','쿠팡 실마진율',
    '우선순위','비고'];
  sheet.getRange('A5:S5').setValues([headers])
    .setFontWeight('bold').setBackground('#2C3E2D').setFontColor('#ffffff');
  sheet.getRange('A5:S5').setWrap(true);

  // 데이터 [상품,카테고리,원가,네이버배송비,쿠팡배송비,크리에이터율,쿠팡수수료율,네이버가(아는것만),우선순위,비고]
  // 배송비=판매자 실부담. 주방=무료배송이라 4,000 전액부담 / 식품=소비자 3,500부담→순부담 1,400(40,000+ 묶음은 4,900)
  var SHIP_KITCHEN = 4000, SHIP_FOOD = 1400;
  var data = [
    ['엘가 IH 미니양면팬 21cm','주방',9500,SHIP_KITCHEN,SHIP_KITCHEN,0.15,0.11,'','🥇','무료배송=판매자 배송 4,000 전액부담'],
    ['클래식 바질페스토 150g','식품',8648,SHIP_FOOD,SHIP_FOOD,0.15,0.11,24900,'🥇','네이버24,900. 단품 배송순부담1,400(40,000+묶음은4,900)'],
    ['퀸센스 깊은그리들팬 36cm','주방',21700,SHIP_KITCHEN,SHIP_KITCHEN,0.12,0.11,'','🥇','객단가 최고(4.78만)·무료배송'],
    ['퀸센스 안심멀티구이팬 41cm','주방',14600,SHIP_KITCHEN,SHIP_KITCHEN,0.12,0.11,'','🥈','무료배송'],
    ['퀸센스 사각그리들','주방',18300,SHIP_KITCHEN,SHIP_KITCHEN,0.08,0.11,'','🥈','무료배송'],
    ['다니엘로 파스타 500g','식품',5300,SHIP_FOOD,SHIP_FOOD,0.08,0.11,'','🥉','마진·객단가 낮음. 단품 배송순부담1,400'],
    ['오뜨 찜냄비 16cm','주방','',SHIP_KITCHEN,SHIP_KITCHEN,0.12,0.11,'','❓','원가 미입력→채우면 계산·무료배송'],
    ['오뜨 찜냄비 20cm','주방','',SHIP_KITCHEN,SHIP_KITCHEN,0.12,0.11,'','❓','원가 미입력·무료배송'],
    ['오뜨 찜냄비 24cm','주방','',SHIP_KITCHEN,SHIP_KITCHEN,0.12,0.11,'','❓','원가 미입력·객단가 최고·무료배송'],
    ['올리브오일 프루타토 750ml','식품',37800,SHIP_FOOD,SHIP_FOOD,0.10,0.11,'','❓','단품 배송순부담1,400'],
    ['올리브오일 코라티나 750ml','식품',32000,SHIP_FOOD,SHIP_FOOD,0.10,0.11,'','❓','단품 배송순부담1,400'],
    ['톤도 (냉동) 400g','식품',5100,SHIP_FOOD,SHIP_FOOD,0.10,0.11,'','❓','냉동 배송비 별도 확인 권장']
  ];
  var startRow = 6;
  for (var i = 0; i < data.length; i++) {
    var r = startRow + i;
    var d = data[i];
    sheet.getRange(r, 1).setValue(d[0]);  // A 상품
    sheet.getRange(r, 2).setValue(d[1]);  // B 카테고리
    sheet.getRange(r, 3).setValue(d[2]);  // C 원가
    // 네이버 섹션
    sheet.getRange(r, 4).setValue(d[7]);  // D 네이버가 (노란)
    sheet.getRange(r, 5).setValue(d[3]);  // E 네이버 배송비 (노란)
    sheet.getRange(r, 6).setValue(d[5]);  // F 크리에이터 수수료율 (노란)
    sheet.getRange(r, 7).setFormula('=IF(N(D'+r+')>0,D'+r+'*F'+r+',"")');                       // G 크리에이터액
    sheet.getRange(r, 8).setValue(0.02);  // H 연동 (노란)
    sheet.getRange(r, 9).setValue(0.034); // I 결제 (노란)
    sheet.getRange(r,10).setFormula('=IF(N(D'+r+')>0,G'+r+'+D'+r+'*H'+r+'+D'+r+'*I'+r+'+E'+r+',"")'); // J 수수료+배송 합
    sheet.getRange(r,11).setFormula('=IF(AND(N(D'+r+')>0,N(C'+r+')>0),D'+r+'-J'+r+'-C'+r+',"")');     // K 네이버 실마진
    sheet.getRange(r,12).setFormula('=IF(AND(N(D'+r+')>0,N(C'+r+')>0),K'+r+'/D'+r+',"")');            // L 네이버 실마진율
    // 쿠팡 섹션
    sheet.getRange(r,13).setValue('');    // M 쿠팡가 (노란, 사용자 입력)
    sheet.getRange(r,14).setValue(d[4]);  // N 쿠팡 배송비 (노란)
    sheet.getRange(r,15).setValue(d[6]);  // O 쿠팡 수수료율 (노란)
    sheet.getRange(r,16).setFormula('=IF(AND(N(M'+r+')>0,N(C'+r+')>0),M'+r+'-M'+r+'*O'+r+'-N'+r+'-C'+r+',"")'); // P 쿠팡 실마진
    sheet.getRange(r,17).setFormula('=IF(AND(N(M'+r+')>0,N(C'+r+')>0),P'+r+'/M'+r+',"")');            // Q 쿠팡 실마진율
    sheet.getRange(r,18).setValue(d[8]);  // R 우선순위
    sheet.getRange(r,19).setValue(d[9]);  // S 비고
  }

  // 노란셀(입력): D네이버가 E배송 F크리율 H연동 I결제 / M쿠팡가 N배송 O수수료
  sheet.getRange(startRow, 4, data.length, 3).setBackground('#fff2cc'); // D,E,F
  sheet.getRange(startRow, 8, data.length, 2).setBackground('#fff2cc'); // H,I
  sheet.getRange(startRow,13, data.length, 3).setBackground('#fff2cc'); // M,N,O

  // 포맷
  sheet.getRange(startRow,3,data.length,1).setNumberFormat('#,##0');    // 원가
  sheet.getRange(startRow,4,data.length,2).setNumberFormat('#,##0');    // 네이버가·배송
  sheet.getRange(startRow,6,data.length,1).setNumberFormat('0%');       // 크리에이터율
  sheet.getRange(startRow,7,data.length,1).setNumberFormat('#,##0');    // 크리에이터액
  sheet.getRange(startRow,8,data.length,2).setNumberFormat('0.0%');     // 연동·결제
  sheet.getRange(startRow,10,data.length,2).setNumberFormat('#,##0');   // 합·실마진
  sheet.getRange(startRow,12,data.length,1).setNumberFormat('0.0%');    // 네이버 실마진율
  sheet.getRange(startRow,13,data.length,2).setNumberFormat('#,##0');   // 쿠팡가·배송
  sheet.getRange(startRow,15,data.length,1).setNumberFormat('0%');      // 쿠팡 수수료율
  sheet.getRange(startRow,16,data.length,1).setNumberFormat('#,##0');   // 쿠팡 실마진
  sheet.getRange(startRow,17,data.length,1).setNumberFormat('0.0%');    // 쿠팡 실마진율

  // 실마진율 음수 빨강 (네이버 L · 쿠팡 Q)
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setBackground('#f4cccc').setFontColor('#cc0000')
    .setRanges([sheet.getRange(startRow,11,data.length,2), sheet.getRange(startRow,16,data.length,2)])
    .build();
  sheet.setConditionalFormatRules([rule]);

  // 열 너비
  sheet.setColumnWidth(1, 180); sheet.setColumnWidth(2, 50);  sheet.setColumnWidth(3, 70);
  sheet.setColumnWidth(4, 80);  sheet.setColumnWidth(5, 75);  sheet.setColumnWidth(6, 80);
  sheet.setColumnWidth(7, 80);  sheet.setColumnWidth(8, 65);  sheet.setColumnWidth(9, 70);
  sheet.setColumnWidth(10, 90); sheet.setColumnWidth(11, 85); sheet.setColumnWidth(12, 80);
  sheet.setColumnWidth(13, 80); sheet.setColumnWidth(14, 70); sheet.setColumnWidth(15, 75);
  sheet.setColumnWidth(16, 80); sheet.setColumnWidth(17, 75); sheet.setColumnWidth(18, 55);
  sheet.setColumnWidth(19, 180);
  sheet.setRowHeight(1, 80); sheet.setRowHeight(5, 45);

  return { ok: true, url: ss.getUrl(), id: ss.getId(), sheetName: '🛒 브랜드커넥트 수수료' };
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
  // 붙여넣기 다중 명령: 2줄 이상 + 모든 줄이 '/'로 시작 → 한 줄씩 처리. (단일 멀티라인 명령은 안 쪼갬)
  var _lines = text.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  if (_lines.length > 1 && _lines.every(function (s) { return s.charAt(0) === '/'; })) {
    for (var _k = 0; _k < _lines.length; _k++) handleEunwooDM({ text: _lines[_k], chat: msg.chat, date: msg.date });
    return;
  }
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
    var _p = PropertiesService.getScriptProperties();
    var _cur = _p.getProperty('EUNWOO_MEMO') || '';
    var _d = Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd');
    _p.setProperty('EUNWOO_MEMO', (_cur ? _cur + '\n' : '') + '• ' + _d + ' ' + memoText);
    refreshCockpit_();
    sendTGMessage(chatId, '✅ 메모 — 콕핏(📝메모)에 추가.\n• ' + memoText);
    return;
  }
  if (text === '/메모목록') { sendTGMessage(chatId, '📝 <b>메모</b> (콕핏)\n' + (PropertiesService.getScriptProperties().getProperty('EUNWOO_MEMO') || '(비어있음)')); return; }
  if ((m = text.match(/^\/메모삭제\s+([\s\S]+)/))) {
    var _kw = m[1].trim(), _pp = PropertiesService.getScriptProperties();
    var _lines = (_pp.getProperty('EUNWOO_MEMO') || '').split('\n').filter(function (s) { return s.trim(); });
    var _kept = _lines.filter(function (s) { return s.indexOf(_kw) < 0; });
    var _rm = _lines.length - _kept.length;
    _pp.setProperty('EUNWOO_MEMO', _kept.join('\n')); refreshCockpit_();
    sendTGMessage(chatId, _rm ? '🗑 메모 ' + _rm + '개 삭제 ("' + _kw + '") — 콕핏 갱신.' : '⚠️ "' + _kw + '" 매칭 메모 없음. /메모목록 확인');
    return;
  }
  if (text === '/메모비우기') { PropertiesService.getScriptProperties().deleteProperty('EUNWOO_MEMO'); refreshCockpit_(); sendTGMessage(chatId, '🧹 메모 전체 삭제 — 콕핏 갱신.'); return; }
  if (text === '/성과' || text === '/성과요약') {
    var sm = buildEunwooMonthlySummary_();
    sendTGMessage(chatId, sm.ok ? sm.text : '⚠️ 성과요약 실패: ' + sm.error);
    return;
  }
  if ((m = text.match(/^\/적용\s+([\s\S]+)/))) {
    var ar = addCxStart_(m[1].trim(), 'D2C마케팅(적용)'); refreshCockpit_();
    sendTGMessage(chatId, ar.ok ? '✅ [' + cxSourceTag_(ar.area) + '] 적용 착수 — 개입기록·콕핏 갱신.\n• ' + ar.content : '⚠️ 실패: ' + ar.error);
    return;
  }
  if ((m = text.match(/^\/(할거|개입)\s+([\s\S]+)/))) {  // /개입은 구버전 alias
    var gr = addCxStart_(m[2].trim(), 'CX'); refreshCockpit_();
    sendTGMessage(chatId, gr.ok ? '✅ [' + cxSourceTag_(gr.area) + '] 등록 — 개입기록·콕핏 갱신.\n• ' + gr.content : '⚠️ 실패: ' + gr.error);
    return;
  }
  if ((m = text.match(/^\/(백로그|나중에?)\s+([\s\S]+)/))) {
    var blr = addCxStart_(m[2].trim(), 'CX', '백로그'); refreshCockpit_();
    sendTGMessage(chatId, blr.ok ? '📋 [' + cxSourceTag_(blr.area) + '] 나중에 추가 — 콕핏 갱신.\n• ' + blr.content : '⚠️ 실패: ' + blr.error);
    return;
  }
  if (text === '/정리' || text === '/완료정리') {
    var pc = pruneCx_(''); refreshCockpit_();
    sendTGMessage(chatId, pc.ok ? '🧹 정리 완료 — 완료 ' + pc.pruned + '건 삭제(✅아카이브 백업됨)·콕핏 갱신.' : '⚠️ 정리 실패: ' + pc.error);
    return;
  }
  if (text === '/콕핏' || text === '/현황') {
    var rc = refreshCockpit_();
    sendTGMessage(chatId, rc.ok ? rc.text : '⚠️ 실패: ' + rc.error);  // 콕핏 내용 직접 표시 + 시트도 갱신됨
    return;
  }
  if ((m = text.match(/^\/원씽\s+([\s\S]+)/))) {
    setOneThing_(m[1].trim()); PropertiesService.getScriptProperties().setProperty('EUNWOO_ONE_THING', m[1].trim()); refreshCockpit_();
    sendTGMessage(chatId, '🥇 ONE THING 설정 — 콕핏 맨 위에 고정.\n· ' + m[1].trim());
    return;
  }
  if ((m = text.match(/^\/끝\s+([\s\S]+)/))) { handleCxDone_(chatId, m[1].trim()); return; }
  if ((m = text.match(/^\/삭제\s+([\s\S]+)/))) { handleCxDelete_(chatId, m[1].trim()); return; }
  if ((m = text.match(/^\/실측\s+([\s\S]+?)\s*=\s*(.+)$/))) { // 완료 포함 아무 항목의 After(실측값) 갱신 — 협상카드 프록시→진짜 숫자 (2026-07-02)
    var xr = setCxAfterAnywhere_(m[1].trim(), m[2].trim());
    if (xr.ok) { sendTGMessage(chatId, '📐 실측 기록 — 협상카드에 반영됨.\n· ' + xr.content + '\n· After: ' + m[2].trim()); }
    else if (xr.multi) sendTGMessage(chatId, '⚠️ 여러 개 매칭 — 더 구체적으로:\n' + xr.matches.map(function (x) { return '· ' + x; }).join('\n'));
    else sendTGMessage(chatId, '⚠️ ' + xr.error);
    return;
  }
  if ((m = text.match(/^\/진행\s+([\s\S]+)/))) { // 나중에/후보 → 진행중(착수)로 이동 (키워드 부분매칭, /보류 대칭)
    var pr = setCxVerdictByKeyword_(m[1].trim(), '착수');
    if (pr.ok) { refreshCockpit_(); sendTGMessage(chatId, '▶️ 진행중으로 — 📌진행중 이동·콕핏 갱신.\n· ' + pr.content); }
    else if (pr.multi) sendTGMessage(chatId, '⚠️ "' + m[1].trim() + '" 여러 개 매칭 — 더 구체적 키워드로:\n' + pr.matches.map(function (x) { return '· ' + x.content; }).join('\n'));
    else sendTGMessage(chatId, '⚠️ ' + pr.error);
    return;
  }
  if ((m = text.match(/^\/보류\s+([\s\S]+)/))) {
    var hr = setCxVerdictByKeyword_(m[1].trim(), '보류');
    if (hr.ok) { refreshCockpit_(); sendTGMessage(chatId, '⏸ 보류 — 📋나중에로 이동·콕핏 갱신.\n· ' + hr.content); }
    else if (hr.multi) {  // 보류는 되돌리기 쉬워 안전 → 매칭 전부 보류 (중복항목 한번에 정리)
      var _iv = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('🛠 개입기록');
      hr.matches.forEach(function (x) { _iv.getRange(x.row, 8).setValue('보류'); });
      refreshCockpit_();
      sendTGMessage(chatId, '⏸ ' + hr.matches.length + '건 보류 — 📋나중에로.\n' + hr.matches.map(function (x) { return '· ' + x.content; }).join('\n'));
    }
    else sendTGMessage(chatId, '⚠️ ' + hr.error);
    return;
  }
  if (text === '/디자인 발송' || text === '/디자인발송') {
    var dr = sendNextDesignCase_();
    if (dr.done) sendTGMessage(chatId, '🎨 디자인 사례 — 미발송 없음 (다 발송됨)');
    else if (!dr.ok) sendTGMessage(chatId, '⚠️ ' + dr.error);
    return; // 발송 성공 시 sendNextDesignCase_가 이미 카드 보냄
  }
  if (text === '/UX 발송' || text === '/UX발송') { handleUXSend(chatId); return; }
  if (text === '/UX 보류' || text === '/UX보류') { handleUXSkip(chatId, date); return; }
  if ((m = text.match(/^\/UX\s*수정\s+([\s\S]+)/))) { handleUXRevise(m[1].trim(), chatId); return; }
  if (text === '/UX 셋업' || text === '/UX셋업') {
    try { setupCXTriggers(); sendTGMessage(chatId, '✅ 트리거 등록 완료 — 일간 9시·UX 월목 9시 (±15분) KST.'); }
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
    var arg = m[1].trim();
    // 숫자만 = 미주 시트 액션 번호 / 텍스트 = 개입기록 완료(=/끝). 직관적으로 둘 다 받음.
    if (/^[\d\s,번]+$/.test(arg)) handleMisuComplete(chatId, (arg.match(/\d+/g) || []));
    else handleCxDone_(chatId, arg);
    return;
  }
  if (text === '/도움' || text === '/help') {
    sendTGMessage(chatId, '📌 <b>은우봇 명령어 (콕핏)</b>\n\n🥇 <b>이번주 정하기</b>\n/원씽 [내용]   → ONE THING (완료시 자동 사라짐)\n\n▶️ <b>시작</b>\n/할거 [내용]   → 자사몰·CX\n/적용 [내용]   → D2C·마케팅\n/백로그 [내용] → 나중에\n/진행 [키워드] → 나중에→진행중으로\n\n✅ <b>끝내기</b> (키워드 일부만)\n/끝 [키워드]          → 완료\n/끝 [키워드] = 3.2%   → 완료 + 수치 협상카드에\n/실측 [키워드] = 값   → 완료된 것도 실측 After 갱신(⭐)\n/보류 [키워드]        → 나중에로\n/삭제 [키워드]        → 필요없는 항목 삭제 (완료는 보호)\n\n📝 <b>메모</b>\n/메모 [내용]   → 콕핏 📝메모에 쌓임\n/메모목록 · /메모비우기\n\n👀 <b>보기</b>\n/콕핏  → 현황 전체 (메모 포함)\n/성과  → 월간 협상카드\n/정리  → 회의 후 완료 비우기\n\n🏷 <b>출처 직접</b> (@ 맨앞)\n/할거 @대표 상세 수정 → [대표]\n여러 줄 붙여넣기도 됨\n\n🔧 <b>그 외</b>\n/작업 · /작업목록 (개인) · /UX 발송|보류|수정 · /조회 내것|액션|결정|공유 (미주 시트)\n\nℹ️ 완료는 /완료 아님 → /끝\nℹ️ 콕핏 = COMPASS 은우 행 E열');
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
  } else if (parts[0] === 'ux') {
    // 초안 DM 인라인 버튼: ux:send(단톡방+케이스북) / ux:skip(패스)
    if (parts[1] === 'send') { handleUXSend(chatId); label = '단톡방+케이스북 📚'; }
    else if (parts[1] === 'skip') { handleUXSkip(chatId, null); label = '패스 ✕'; }
    else return;
  } else if (parts[0] === 'cxa') {
    // 일간 DM 액션 3버튼: T=오늘 액션(착수→진행중) · L=나중에(백로그) · P=패스(무시)
    // ★메시지/키보드 절대 건드리지 않음 — 한 메시지에 액션 3개 버튼이라 키보드 지우면 나머지 버튼도 사라짐("패스 누르니 꺼짐" 버그).
    //   더블탭 중복은 addCxStart_ 활성중복skip이 막아줌(dup이면 "이미 담김" 안내).
    var mode = parts[1], idx = parseInt(parts[2]);
    if (mode === 'P') {
      // ★토스트(answerCallbackQuery)는 1분 폴링 지연으로 텔레그램이 무시(안 뜸) → 확인 메시지로 (2026-07-01 "패스 눌러도 안 뜸" fix)
      label = '패스 ✕';
      var parr = [];
      try { parr = JSON.parse(PropertiesService.getScriptProperties().getProperty('CX_TODAY_ACTIONS') || '[]'); } catch (e) {}
      var pact = parr[idx] ? String(parr[idx]).replace(/^[^\w가-힣]+/, '').trim().slice(0, 40) : (idx + 1) + '번';
      sendTGMessage(chatId, '✕ 패스 — ' + pact);
    }
    else {
      var arr = [];
      try { arr = JSON.parse(PropertiesService.getScriptProperties().getProperty('CX_TODAY_ACTIONS') || '[]'); } catch (e) {}
      var act = arr[idx];
      if (act) {
        var clean = String(act).replace(/^[^\w가-힣]+/, '').trim(); // 앞 이모지 제거
        var ar = addCxStart_(clean, 'CX', mode === 'T' ? '착수' : '백로그'); refreshCockpit_();
        label = mode === 'T' ? '오늘 착수 ✅' : '나중에 📋';
        var where = mode === 'T' ? '진행중' : '나중에';
        sendTGMessage(chatId, (ar && ar.dup ? '☑️ 이미 콕핏 ' + where + '에 있음' : (mode === 'T' ? '✅ 콕핏 진행중에 담음' : '📋 콕핏 나중에에 담음')) + '\n· ' + clean);
      } else { label = '항목 만료 — 새 리포트에서 다시'; sendTGMessage(chatId, '⚠️ 항목 만료 — 새 리포트에서 다시 눌러줘'); }
    }
  } else if (parts[0] === 'uxc') {
    // 단톡방 UX 사례 큐레이션 버튼: add=채택(케이스북+콕핏 나중에+내할일) / pass=패스
    var uact = parts[1], udate = parts.slice(2).join(':');
    var ur = setUXCaseStatus(udate, uact === 'add' ? '채택' : '패스');
    if (ur && ur.ok) {
      label = uact === 'add' ? '케이스북+콕핏 ✓' : '패스 ✕';
      sendTGMessage(chatId, uact === 'add' ? '✓ 케이스북 채택 + 콕핏 나중에로 보냄' : '✕ 패스');
    } else { label = '처리 실패'; sendTGMessage(chatId, '⚠️ UX 큐레이션 실패: ' + ((ur && ur.error) || '')); }
  } else if (parts[0] === 'dzc') {
    // 디자인 사례 개인DM 버튼: add=채택(케이스북 표시만) / pass=패스. 콕핏 안 들어감.
    var dr = setDesignCaseStatus_(parts[2], parts[1] === 'add' ? '채택' : '패스');
    label = parts[1] === 'add' ? '채택 ⭐' : '패스 ✕';
    sendTGMessage(chatId, (parts[1] === 'add' ? '⭐ 채택 — 케이스북에 표시됨' : '✕ 패스') + (dr && dr.title ? '\n· ' + dr.title : ''));
  } else {
    return;
  }
  // answerCallbackQuery: spinner 끔 (순수 장식 — 실제 처리는 위에서 이미 끝남)
  // try/catch 필수: 오래된 버튼/일시 네트워크오류로 터져도 "처리 오류" 안 뜨게
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + _botToken() + '/answerCallbackQuery', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ callback_query_id: query.id, text: label }),
      muteHttpExceptions: true
    });
  } catch (e) { /* spinner 끄기 실패는 무시 — 본처리는 완료됨 */ }
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
  summary:  { name: '주간_요약',   headers: ['주차','광고비','메타픽셀매출','메타ROAS','실제ROAS','메타주장비중','카페24매출','카페24주문','AOV','세션','전환율'] },
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

// 주간 페이지뷰 기록 (개인성과시트 📄 주간_페이지뷰 탭). 기간(시작~종료)로 upsert.
// payload.rows[] = {period, start, end, pv, sessions, users}. PV=실측 사람트래픽, 세션/방문자는 MP외부결제 푸시로 부풀려짐.
function recordWeeklyPV_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '📄 주간_페이지뷰', ['기간', '시작', '종료', 'PV(실측)', '세션(MP부풀림)', '방문자', '전주대비PV%', '기록일']);
  var rows = (payload.rows || []).slice().sort(function (a, b) { return String(a.start) < String(b.start) ? -1 : 1; });
  var prevPv = null, n = 0;
  rows.forEach(function (r) {
    var wow = (prevPv && prevPv > 0) ? Math.round((r.pv - prevPv) / prevPv * 100) : '';
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.period)) sh.deleteRow(i + 1); }
    sh.appendRow([r.period, r.start, r.end, r.pv, r.sessions, r.users, wow, new Date()]); n++;
    prevPv = r.pv;
  });
  return { ok: true, added: n };
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
  '사이트_메타인앱', '사이트_정상브라우저', '사이트_삼성인터넷', '사이트_크롬', '사이트_사파리', '사이트_모바일', '사이트_PC', '사이트_스크롤깊이', '사이트_체류초',
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

// UTM 시트 정리 — 측정 안 되는 채널(메타·네이버) 행 삭제 + 엽서 placeholder 정리
function cleanupUtm_() {
  try {
    var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
    var sh = ss.getSheetByName('🔗 UTM 링크');
    if (!sh) return { ok: false, error: 'UTM 링크 탭 없음' };
    // 메타 광고·네이버 쇼핑 행 삭제 (아래부터 — 행 밀림 방지)
    var data = sh.getDataRange().getValues();
    var removed = [];
    for (var i = data.length - 1; i >= 1; i--) {
      var name = String(data[i][0] || '');
      if (/메타 광고|네이버 쇼핑/.test(name)) { sh.deleteRow(i + 1); removed.push(name); }
    }
    // 엽서 재고 placeholder 행(#NAME? 수식) 삭제 — 헤더만 남기고 사용자가 실제 입력
    var pc = ss.getSheetByName('📮 엽서 재고');
    if (pc && pc.getLastRow() >= 2) pc.deleteRow(2);
    return { ok: true, removed: removed };
  } catch (e) { return { ok: false, error: e.message }; }
}

// UTM 측정 설계 시트 반영 (2026-06-02) — 측정시점·지표·성과·★얻는것 + 엽서 재고탭 + 재입고 URL 버그수정
function setupUtmDesign_() {
  try {
    var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
    var sh = ss.getSheetByName('🔗 UTM 링크');
    if (!sh) return { ok: false, error: 'UTM 링크 탭 없음' };
    // 측정 설계 헤더 (I7:L7) — 기존 H열까지 뒤에 추가
    sh.getRange('I7:L7').setValues([['측정 시점', '측정 지표', '성과 정의', '★ 실행 후 얻는 것 (의사결정)']]);
    // 채널별 (행 8=엽서QR, 9=메타, 10=웰컴, 11=재입고, 12=등급쿠폰, 13=네이버)
    sh.getRange('I8:L13').setValues([
      ['상시(지연·소비자 간직 후 스캔)', 'GA4 utm=qr 유입 + 엽서재고탭', '스캔율·주문·ROI', '엽서를 간직→스캔하나(스캔율). 인쇄비 값하나(ROI) → 엽서 계속/디자인개선/중단'],
      ['—', '메타 픽셀이 이미 측정(송마망봇 ROAS)', 'UTM 불필요(중복)', '메타 자체 어트리뷰션이 더 정확 → UTM 안 붙임'],
      ['발송+7일(즉시 반응)', 'GA4 utm=kakao 유입→cafe24 주문', '신규의 첫 구매 전환', '웰컴 친구톡이 신규 첫구매를 만드나 → 웰컴쿠폰 효율'],
      ['발송+7일', 'GA4 utm=kakao→cafe24 주문', '재입고 알림→실제 구매', '재입고 알림이 구매로 이어지나 → 알림 발송 가치'],
      ['발송+30일(쿠폰 사용기간)', 'GA4 utm=kakao + cafe24 쿠폰 사용', '등급쿠폰→재구매', '쿠폰이 재구매 만드나(현재 사용 0%) → 쿠폰 유지/타이밍변경/중단 결정'],
      ['—', '네이버가 검색링크 통제', 'UTM 불가', '네이버 자연유입은 링크 못 박음 → 측정 대상 아님']
    ]);
    // 재입고 URL 버그 수정 (G11): ?product_no=17? → &
    sh.getRange('G11').setValue('https://italy-jungmiso.com/product/detail.html?product_no=17&utm_source=kakao&utm_medium=cta&utm_campaign=restock');
    // 📮 엽서 재고 탭 생성
    var pc = ss.getSheetByName('📮 엽서 재고');
    if (!pc) {
      pc = ss.insertSheet('📮 엽서 재고');
      pc.appendRow(['발행일', '발행수', '누적 배포(택배당 1)', '잔여', '스캔수(GA4 qr)', '스캔율%', '스캔→주문', '주문매출', '장당 인쇄비', 'ROI', '비고']);
      pc.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
      pc.setFrozenRows(1);
      pc.appendRow(['(인쇄일 입력)', '(예: 1000)', '=출고택배수(누적)', '=발행수-누적배포', '(GA4 utm=qr)', '=스캔/배포', '(GA4 qr→주문)', '', '(인쇄비/발행수)', '=주문매출/(장당비용*배포)', 'Vol.01 그라냐노 레시피']);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message, stack: String(e.stack || '').slice(0, 300) }; }
}

// 주간 레버 스냅샷 — UI/UX 개입 전후 비교용 (CX 관리자 성과 측정의 baseline)
// ★드라마 협찬 5칸 추가 (2026-07-27, KBS2 '사랑이 온다' 효과 추적). 기존 시트엔 ensureLeverHeaders_가 자동 증설.
var LEVER_HEADERS = ['주차', '날짜', '쿠폰전환%', '골든타임_D21_35', '레시피PV', '재구매율%', '게스트%', '메모',
  '드라마_방영시간대배수', '드라마_브랜드검색배수', '드라마_브랜드검색', '드라마_신규비율%', '드라마_판정', '자연검색_네이버', '자연검색_구글'];
function getLeverTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('주간_레버');
  if (!sh) {
    sh = ss.insertSheet('주간_레버');
    sh.appendRow(LEVER_HEADERS);
    sh.getRange(1, 1, 1, LEVER_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  // ★기존 시트에 새 칼럼(드라마 5칸) 자동 증설 — 헤더가 짧으면 뒤에 붙임 (2026-07-27)
  var hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (hdr.length < LEVER_HEADERS.length) {
    sh.getRange(1, 1, 1, LEVER_HEADERS.length).setValues([LEVER_HEADERS]);
    sh.getRange(1, 1, 1, LEVER_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
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
    sh.appendRow([week, today, d.쿠폰전환 || '', d.골든타임 || '', d.레시피PV || '', d.재구매율 || '', d.게스트 || '', d.메모 || '',
      d.드라마_방영시간대배수 || '', d.드라마_브랜드검색배수 || '', d.드라마_브랜드검색 || '', d.드라마_신규비율 || '', d.드라마_판정 || '', d.자연검색_네이버 || '', d.자연검색_구글 || '']);
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
// 은우 COMPASS 행 전체 읽기 (B포커스·C메모·D실무·E콕핏) — 진단/정리용
function getEunwooCompassRow_() {
  try {
    var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
    if (!sh) return { ok: false, error: 'COMPASS 없음' };
    var aCol = sh.getRange('A49:A60').getValues();
    for (var i = 0; i < aCol.length; i++) {
      if (String(aCol[i][0]).trim() === '은우') {
        var row = 49 + i, v = sh.getRange(row, 1, 1, 5).getValues()[0];
        return { ok: true, row: row, focus: String(v[1] || ''), memo: String(v[2] || ''), work: String(v[3] || ''), cockpit: String(v[4] || '') };
      }
    }
    return { ok: false, error: '은우 행 못 찾음' };
  } catch (e) { return { ok: false, error: e.message }; }
}
// 은우 COMPASS 비고(E열)에 봇 측정 할일 갱신(replace). 매주 데이터→액션을 "월요일 첫 화면"에 일원화.
// ── ONE THING = COMPASS 은우 행 B열 (미주·경태와 같은 칸). B열이 원본 (2026-07-14) ──
function getOneThing_() {
  try {
    var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
    if (!sh) return '';
    var aCol = sh.getRange('A49:A60').getValues();
    for (var i = 0; i < aCol.length; i++) {
      if (String(aCol[i][0]).trim() === '은우') {
        return String(sh.getRange(49 + i, 2).getValue() || '').replace(/^[·\s]+/, '').trim();
      }
    }
  } catch (e) {}
  return '';
}
function setOneThing_(v) {
  try {
    var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
    if (!sh) return { ok: false, error: 'COMPASS 없음' };
    var aCol = sh.getRange('A49:A60').getValues();
    for (var i = 0; i < aCol.length; i++) {
      if (String(aCol[i][0]).trim() === '은우') {
        sh.getRange(49 + i, 2).setValue(v ? '· ' + v : '').setWrap(true).setVerticalAlignment('top');
        SpreadsheetApp.flush();
        return { ok: true, row: 49 + i };
      }
    }
    return { ok: false, error: '은우 행 못 찾음' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── 메모 = COMPASS 은우 행 E열(비고). 업무는 D열, 메모는 E열로 분리 (2026-07-14) ──
function renderMemoCell_() {
  try {
    var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
    if (!sh) return { ok: false };
    var aCol = sh.getRange('A49:A60').getValues();
    for (var i = 0; i < aCol.length; i++) {
      if (String(aCol[i][0]).trim() === '은우') {
        var memo = PropertiesService.getScriptProperties().getProperty('EUNWOO_MEMO') || '';
        var lines = memo.split('\n').filter(function (s) { return s.trim(); });
        var txt = '📝 메모 (' + lines.length + ')\n\n' + (lines.length ? lines.join('\n') : '· (비어있음 — 봇에 /메모 [내용])');
        var cell = sh.getRange(49 + i, 5); // E열=비고
        cell.setValue(txt);
        cell.setWrap(true).setVerticalAlignment('top').setFontSize(11);
        SpreadsheetApp.flush();
        try {
          var b = SpreadsheetApp.newRichTextValue().setText(txt);
          b.setTextStyle(0, txt.indexOf('\n') > 0 ? txt.indexOf('\n') : txt.length,
            SpreadsheetApp.newTextStyle().setBold(true).setFontSize(13).setForegroundColor('#cc0000').build());
          cell.setRichTextValue(b.build());
          SpreadsheetApp.flush();
        } catch (e) {}
        return { ok: true, row: 49 + i, count: lines.length };
      }
    }
  } catch (e) { return { ok: false, error: e.message }; }
  return { ok: false };
}

function setEunwooCompassRemarks_(text) {
  try {
    var sh = SpreadsheetApp.openById(STRATEGY_SHEET_ID).getSheetByName('🧭 COMPASS');
    if (!sh) return { ok: false, error: 'COMPASS 없음' };
    var aCol = sh.getRange('A49:A60').getValues();
    for (var i = 0; i < aCol.length; i++) {
      if (String(aCol[i][0]).trim() === '은우') {
        var cell = sh.getRange(49 + i, 4); // ★D열=서브(잊지 말 것) — 다른 직원(미주·경태)과 통일 (2026-07-14, 이전 E열)
        // ★2026-06-23 신뢰성 재설계: RichText 단독 쓰기가 간헐적 미커밋(ok뜨는데 셀 안바뀜) →
        //   ① 평문 setValue로 내용 먼저 확실히 박고 ② 굵게는 best-effort ③ 읽기검증 안되면 재시도.
        cell.setValue(text);
        cell.setWrap(true).setVerticalAlignment('top').setFontSize(11); // 회의 보고용 — 가독성 (2026-07-14)
        SpreadsheetApp.flush();
        try { // 섹션 헤더 굵게 (실패해도 내용은 이미 박힘)
          var b = SpreadsheetApp.newRichTextValue().setText(text);
          var headStyle = SpreadsheetApp.newTextStyle().setBold(true).setFontSize(13).setForegroundColor('#1155cc').build();
          var strikeStyle = SpreadsheetApp.newTextStyle().setStrikethrough(true).setForegroundColor('#888888').build();
          // 오프셋 = UTF-16 (setTextStyle 기준). ↳ 현재상황 빨강 (은우 2026-07-16). ★이모지 오프셋 이슈 겪었으나 setTextStyle=UTF-16 확인, .length 그대로가 맞음
          var lines = text.split('\n'), pos = 0, inDone = false;
          for (var L = 0; L < lines.length; L++) {
            var ln = lines[L];
            if (ln.length > 0 && /^(📍|🎯|📌|📋|✅|🥇|📥|📝)/.test(ln)) {
              b.setTextStyle(pos, pos + ln.length, headStyle);
              inDone = ln.indexOf('이번주 한 일') >= 0; // 이 섹션 안의 항목만 취소선
            }
            // 이번주 한 일 = 취소선 (월요일 보고 후 눈으로 바로 구분)
            else if (/^▸/.test(ln)) b.setTextStyle(pos, pos + ln.length, SpreadsheetApp.newTextStyle().setBold(true).setItalic(true).setFontSize(12).setForegroundColor('#1155cc').build()); // 영역 헤더 = 파랑·기울임 (은우 요청 2026-07-16, 빨강→파랑 가독성)
            else if (inDone && ln.length > 0 && ln.indexOf('· ') >= 0) b.setTextStyle(pos, pos + ln.length, strikeStyle);
            else if (ln.indexOf('↳') >= 0) { // 진행 상황(↳)의 현재값 = 빨강 강조: "A → B → C"면 마지막 C만, 화살표 없으면 ↳ 이후 전체
              var _ai = ln.lastIndexOf('→');
              var _st = _ai >= 0 ? _ai + 1 : ln.indexOf('↳') + 1;
              while (_st < ln.length && ln.charAt(_st) === ' ') _st++;
              if (_st < ln.length) b.setTextStyle(pos + _st, pos + ln.length, SpreadsheetApp.newTextStyle().setForegroundColor('#1155cc').setBold(true).build());
            }
            pos += ln.length + 1;
          }
          cell.setRichTextValue(b.build());
          SpreadsheetApp.flush();
        } catch (e) {}
        // 검증: 셀 내용이 새 텍스트로 안 바뀌었으면 평문으로 한 번 더 강제
        if (String(sh.getRange(49 + i, 4).getValue()).indexOf(text.slice(0, 18)) < 0) {
          sh.getRange(49 + i, 4).setValue(text);
          SpreadsheetApp.flush();
        }
        return { ok: true, row: 49 + i };
      }
    }
    return { ok: false, error: '은우 행 못 찾음 (COMPASS A49:A60)' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 📍 콕핏 = COMPASS E55 = 개입기록 라이브 뷰. 🥇ONE THING(이번주 1개)+📌진행중+📥들어온것(CX후보·UX채택 카운트, D2C는 /적용)+📋나중에+✅완료수. 명령/주간마다 갱신 → "보는 1곳".
function refreshCockpit_() {
  // 직전 setValue(판정 변경 등)가 시트에 확정된 뒤 읽도록 강제 flush.
  // (2026-06-23 버그: /끝→완료 표시 직후 콕핏이 옛 데이터 읽어 완료항목이 안 사라짐)
  try { SpreadsheetApp.flush(); } catch (e) {}
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var iv = ss.getSheetByName('🛠 개입기록');
  var month = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMM');
  var cand = [], wip = [], backlog = [], doneWeek = [], doneN = 0;
  // ★"한 일" 기준 = 마지막 정리시점(DONE_SINCE, 은우가 "지워" 할 때만 갱신). 2026-07-20 변경:
  //   기존 "이번 주 월요일" 자동기준은 월요일 아침(보고 직전)에 지난주 완료가 통째로 사라져 보고자료 유실 → 수동 정리로 전환.
  var weekMon = 0;
  var _sinceProp = PropertiesService.getScriptProperties().getProperty('DONE_SINCE');
  if (_sinceProp) {
    var _sd = new Date(String(_sinceProp).replace(/[-.]/g, '/') + ' 00:00:00');
    if (!isNaN(_sd.getTime())) weekMon = _sd.getTime();
  }
  if (!weekMon) { // 미설정 시에만 이번 주 월요일로 폴백
    var _mo = new Date(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy/MM/dd'));
    _mo.setDate(_mo.getDate() - ((_mo.getDay() + 6) % 7)); // 월요일로 되감기 (일요일=0 보정)
    weekMon = _mo.getTime();
  }
  var doneThisWeek = function (d) {
    var x = (Object.prototype.toString.call(d) === '[object Date]') ? d : new Date(String(d).replace(/[.]/g, '/'));
    return !isNaN(x.getTime()) && x.getTime() >= weekMon;
  };
  var inM = function (dt) { if (Object.prototype.toString.call(dt) === '[object Date]') dt = Utilities.formatDate(dt, 'Asia/Seoul', 'yyyy-MM-dd'); return String(dt).replace(/[-.]/g, '').indexOf(month) >= 0; };
  if (iv && iv.getLastRow() > 1) {
    var ageD = function (d) { var t = (Object.prototype.toString.call(d) === '[object Date]') ? d : new Date(String(d)); return isNaN(t.getTime()) ? 0 : Math.floor((Date.now() - t.getTime()) / 86400000); };
    var stale = function (r, s) { var a = ageD(r[0]); return '· [' + cxSourceTag_(r[1]) + '] ' + String(r[2]) + (a >= 14 ? ' ⏳' + a + '일(묵음)' : ''); };
    iv.getDataRange().getValues().slice(1).forEach(function (r) {
      var v = String(r[7]);
      // 진행중 = 영역별 그룹 + 맥락 하위줄 (2026-07-14: 회의 보고용이 되어 가독성 개선. D55 이중관리 폐지)
      if (v === '착수' || v === '진행중') wip.push({ tag: cxSourceTag_(r[1]), name: String(r[2]), ctx: String(r[3] || '').trim() });
      else if (v === '후보') cand.push(stale(r));
      else if (v === '백로그' || v === '보류') backlog.push(stale(r));
      // ✅ 이번주 한 일 = 최근 7일 완료분. 월요일 보고용으로 취소선 표시 후, 7일 지나면 자동으로 빠짐 (2026-07-14)
      else if (v === '완료' && doneThisWeek(r[0])) doneWeek.push({ tag: cxSourceTag_(r[1]), name: String(r[2]) });
    });
  }
  // UX 케이스북 채택(UX_할일 '할일'=아직 손 안 댄 것) 개수 — 같은 시트라 직접 카운트
  var uxN = 0;
  var ut = ss.getSheetByName('UX_할일');
  if (ut && ut.getLastRow() > 1) ut.getDataRange().getValues().slice(1).forEach(function (r) { if (String(r[4]) === '할일') uxN++; });
  var seenD = {}, seenP = {}, donePrev = 0;
  // 지난달 키 (월초 "완료 0건"으로 성과가 증발해 보이는 것 방지 — 2026-07-01)
  var pd = new Date(); pd.setMonth(pd.getMonth() - 1);
  var prevMonth = Utilities.formatDate(pd, 'Asia/Seoul', 'yyyyMM');
  var inPrev = function (dt) { if (Object.prototype.toString.call(dt) === '[object Date]') dt = Utilities.formatDate(dt, 'Asia/Seoul', 'yyyy-MM-dd'); return String(dt).replace(/[-.]/g, '').indexOf(prevMonth) >= 0; };
  [iv, ss.getSheetByName('✅ 완료_아카이브')].forEach(function (sh) {
    if (!sh || sh.getLastRow() < 2) return;
    sh.getDataRange().getValues().slice(1).forEach(function (r) {
      if (String(r[7]) !== '완료') return;
      var k = String(r[2]);
      if (inM(r[0])) { if (!seenD[k]) { seenD[k] = true; doneN++; } }
      else if (inPrev(r[0])) { if (!seenP[k]) { seenP[k] = true; donePrev++; } }
    });
  });
  var props0 = PropertiesService.getScriptProperties();
  var oneThing = getOneThing_() || props0.getProperty('EUNWOO_ONE_THING') || ''; // ★B열(다른 직원과 동일 칸)이 원본
  var memoStr = props0.getProperty('EUNWOO_MEMO') || '';
  var memoLines = memoStr ? memoStr.split('\n').filter(function (s) { return s.trim(); }) : [];
  // 표시: lim까지 보여주고 넘치면 "…외 N건" (count와 보이는 줄 불일치 방지)
  var fmt = function (arr, lim) { if (!arr.length) return '· 없음'; var s = arr.slice(0, lim).join('\n'); return arr.length > lim ? s + '\n· …외 ' + (arr.length - lim) + '건' : s; };
  // 진행중 = 영역별 묶어서 출력 (회의 보고 가독성). 회의 흐름 순서: 인쇄 → 플랫폼 → 자사몰 → 디자인 → CX
  var AREA_ORDER = ['인쇄', '플랫폼', '디자인', 'CX 관리자', 'CX', 'CX주간', 'UX', 'UTM']; // 창 번호 분류 폐지 — 은우 업무 축(인쇄/플랫폼)으로 (2026-07-14)
  var groupTxt = function (arr, striked) {
    var g = {};
    arr.forEach(function (w) { (g[w.tag] = g[w.tag] || []).push(w); });
    return Object.keys(g).sort(function (a, b) {
      var ia = AREA_ORDER.indexOf(a), ib = AREA_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map(function (k) {
      return '▸ ' + k + ' (' + g[k].length + ')\n' + g[k].map(function (w) {
        return '   · ' + w.name + (!striked && w.ctx ? '\n      ↳ ' + w.ctx : '');
      }).join('\n');
    }).join('\n\n');
  };
  var wipTxt = wip.length ? groupTxt(wip, false) : '· 없음';
  var doneWeekTxt = doneWeek.length ? '✅ 이번주 한 일 (' + doneWeek.length + ' · 월요일 보고용)\n\n' + groupTxt(doneWeek, true) + '\n\n' : '';
  var txt = '📍 이번주 콕핏 (' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd') + ')\n\n'
    + '🥇 CX 관리자 ONE THING\n' + (oneThing ? '· ' + oneThing : '· (미설정 — /원씽 [내용])') + '\n\n'
    + '📌 진행중 (' + wip.length + ')\n\n' + wipTxt + '\n\n'
    + '📥 들어온 것 (' + cand.length + ' · 확인→/할거)\n' + fmt(cand, 100) + '\n\n'
    + doneWeekTxt
    + '📋 나중에 (' + backlog.length + ')\n' + fmt(backlog, 100) + '\n\n'
    // 📝 메모는 E열(비고)로 분리 — 콕핏(D열)은 업무만 (2026-07-14)
    + '✅ 이번달 완료 ' + doneN + '건' + (donePrev > 0 ? ' (지난달 ' + donePrev + '건)' : '');
  var res = setEunwooCompassRemarks_(txt);
  renderMemoCell_(); // 비고(E열) = 메모창
  return { ok: res.ok, row: res.row, error: res.error, text: txt }; // text=콕핏 내용(텔레그램 표시용)
}

// 🥇 은우 월간 성과 요약 자동초안 (연봉협상 카드). 개입기록(완료 Before/After)+주간_요약(전환율·매출 변화)+귀속매출 → 📊 월간_성과요약 탭 upsert.
function buildEunwooMonthlySummary_(month) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  if (!month) month = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM');
  var mKey = month.replace(/[-.]/g, '');
  var inMonth = function (s) {
    if (Object.prototype.toString.call(s) === '[object Date]') s = Utilities.formatDate(s, 'Asia/Seoul', 'yyyy-MM-dd');
    return String(s).replace(/[-.]/g, '').indexOf(mKey) >= 0;
  };
  // 완료/착수 날짜 → "M/d" (Date·일련번호·"2026. 6. 8"·"2026-06-19" 다 처리)
  var mdDate = function (v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'M/d');
    if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Seoul', 'M/d'); }
    var m = String(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? (Number(m[2]) + '/' + Number(m[3])) : '';
  };
  var done = [], wip = [], seenDone = {}, doneReal = 0;
  var iv = ss.getSheetByName('🛠 개입기록');
  // 진행/착수 = 개입기록(working)에서
  if (iv && iv.getLastRow() > 1) {
    iv.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!inMonth(r[0])) return;
      var v = String(r[7]);
      if (v === '착수' || v === '진행중') wip.push('- ' + String(r[2]));
    });
  }
  // 완료 = 개입기록 + ✅완료_아카이브(영구) 둘 다, 중복제거 — 월요일 정리로 옮겨가도 협상기록 안 사라짐
  [iv, ss.getSheetByName('✅ 완료_아카이브')].forEach(function (sh) {
    if (!sh || sh.getLastRow() < 2) return;
    sh.getDataRange().getValues().slice(1).forEach(function (r) {
      if (!inMonth(r[0]) || String(r[7]) !== '완료') return;
      var k = String(r[2]); if (seenDone[k]) return; seenDone[k] = true;
      var ba = (r[4] ? 'Before ' + r[4] : '') + (r[5] ? ' → After ' + r[5] : '');
      var dt = mdDate(r[0]);
      // ⭐=진짜 실측 After(자동 프록시 아님) — 협상 때 바로 보이게 (2026-07-02). /실측으로 채움.
      var isReal = String(r[5] || '').trim() && !/자동|착수시점|backfill|정확지표|권장/.test(String(r[5]));
      done.push('- ' + (isReal ? '⭐' : '') + (dt ? '[' + dt + '] ' : '') + k + (ba ? ' (' + ba + ')' : ''));
      if (isReal) doneReal++;
    });
  });
  var convLine = '';
  var ws = ss.getSheetByName('주간_요약');
  if (ws && ws.getLastRow() > 1) {
    var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var ci = hdr.indexOf('전환율'), si = hdr.indexOf('카페24매출');
    var rows = ws.getDataRange().getValues().slice(1).filter(function (r) { return inMonth(r[0]); });
    if (rows.length && ci >= 0) {
      var f = rows[0], l = rows[rows.length - 1];
      convLine = '전환율 ' + f[ci] + '% → ' + l[ci] + '%';
      if (si >= 0 && f[si] && l[si]) convLine += ' · 매출 ' + Math.round(f[si] / 10000) + '만→' + Math.round(l[si] / 10000) + '만(주)';
    }
  }
  // 💰 은우 귀속매출 = 스마트스토어 월매출(은우 직접운영·수동입력). G열 매출 합산. 다른 채널(UTM/공구=영업아님)은 귀속 X.
  var attrLine = '';
  var am = ss.getSheetByName('💰 은우 귀속 매출');
  if (am && am.getLastRow() > 1) {
    var amData = am.getDataRange().getValues();
    var ymM = function (v) { if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM'); } if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM'); return String(v).slice(0, 7); };
    var ssRev = 0, hit = false;
    for (var ai = 1; ai < amData.length; ai++) {
      if (String(amData[ai][1] || '').indexOf('스마트스토어') < 0) continue;
      if (ymM(amData[ai][0]) !== month) continue;
      hit = true;
      ssRev += Number(String(amData[ai][6]).replace(/[^\d.-]/g, '')) || 0;
    }
    attrLine = ssRev > 0 ? '💰 은우 귀속매출(스마트스토어): ' + ssRev.toLocaleString() + '원'
      : '💰 은우 귀속매출(스마트스토어): 미입력' + (hit ? ' (💰시트 G열에 월매출 숫자 입력)' : '');
  }
  var txt = '📊 은우 월간 성과 — ' + month + '\n━━━━━━━━━━\n'
    + '📈 수치개선(완료 ' + done.length + '건 · 실측 ⭐' + doneReal + '건):\n' + (done.length ? done.join('\n') : '- (완료 개입 없음)') + '\n\n'
    + '🔧 진행/착수:\n' + (wip.length ? wip.join('\n') : '- 없음') + '\n\n'
    + '📊 지표변화:\n' + (convLine || '- 데이터 부족') + '\n'
    + (attrLine ? '\n' + attrLine + '\n' : '')
    + '\n※협상 초안 — 맥락(공구·휴무·광고) 감안해 다듬어 사용. 실무완료=COMPASS D열 참조';
  var sh = ensureSheetWithHeaders_(ss, '📊 월간_성과요약', ['월', '요약', '생성일시']);
  var data = sh.getDataRange().getValues();
  // ★월=텍스트 저장 안 하면 "2026-06"이 날짜 일련번호(46174)로 자동변환돼 upsert 비교 깨짐(15중복 원인, 2026-06-24 fix).
  var ym = function (v) {
    if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM'); }
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM');
    return String(v).slice(0, 7);
  };
  for (var i = data.length - 1; i >= 1; i--) { if (ym(data[i][0]) === month) sh.deleteRow(i + 1); }   // serial/Date/문자 다 매칭
  sh.appendRow(["'" + month, txt, new Date()]);   // 월=텍스트(앞 따옴표)로 저장 → 날짜변환 방지
  return { ok: true, month: month, text: txt, done: done.length, wip: wip.length };
}

// 내용 키워드로 창 자동 분류 (1창 두뇌·전략 / 2창 자사몰 메인 / 3창 데이터·측정 / 4창 상세·이미지). 못 정하면 CX.
// ★규칙 기반이라 완벽치 않음 — 답장에 [N창] 표시되니 틀리면 /삭제 후 재등록하거나 영역 직접수정.
// ★영역 = 인쇄 / 플랫폼 / CX 관리자 3분류 (2026-07-21, 은우 "1창~4창 창 번호 쓰지마"). 창 번호 폐지.
function cxAutoArea_(s) {
  var t = String(s).toLowerCase();
  // CX 관리자 = 측정·데이터·UTM (은우 본업) — 우선 체크(측정이 다른 키워드보다 앞)
  if (/측정|추적|전환율|리포트|ga4|클러리티|clarity|데이터|효과\s*측정|광고.*효과|퍼널|지표|\butm\b|재구매율|골든타임|유입.*분석/.test(t)) return 'CX 관리자';
  // 인쇄 = 물리 제작·패키징·소싱
  if (/단박스|박스|엽서|인쇄|패키지|패키징|보냉|뚝배기|코브랜딩|굿즈|홀더|목업|소싱|스티커|에코백|테이프|부자재/.test(t)) return '인쇄';
  // 플랫폼 = 온라인 채널·자사몰·상세페이지·사이트·마켓
  if (/상세\s*페이지|상세페이지|상페|디자인|썸네일|이미지|사진|비주얼|로고|인스타|영상|쿠팡|스마트?\s*스토어|스마스토어|29cm|배너|클릭|버튼|바텀시트|결제|발행|재고|구매영역|네이버페이|카카오페이|스크롤|깨짐|옵션|\bui\b|화면|팝업|카마솥|가마솥|상품마스터|카페24|cafe24|메인|홈페이지|피드|캐러셀|케러셀/.test(t)) return '플랫폼';
  // 그 외(전략·기획·브랜딩 등) = CX 관리자 기본값
  return 'CX 관리자';
}
// 텔레그램 한 줄로 개입기록에 추가 (Before=최신 주간_요약 전환율 자동). /적용·/개입·/백로그 공용. verdict 기본 착수.
function addCxStart_(content, area, verdict) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var t = ensureSheetWithHeaders_(ss, '🛠 개입기록', ['날짜', '영역', '개입내용', '맥락(휴무/공구/광고)', 'Before(지표)', 'After(지표)', '측정단위', '판정']);
  // @출처 인라인 지정: "@대표 레시피 수정" → 출처(영역)=대표, 내용=레시피 수정. 있으면 기본 영역 덮어씀.
  var sm = String(content).match(/^@(\S+)\s+([\s\S]+)/);
  var finalArea = sm ? sm[1] : (area || 'CX');
  var finalContent = sm ? sm[2].trim() : String(content).trim();
  // 영역 자동분류: @출처 없고 기본값(CX)일 때만 내용 보고 창 태그 부여 (D2C/UX 등 명시영역은 유지)
  if (!sm && (!area || area === 'CX')) finalArea = cxAutoArea_(finalContent);
  // 중복 방지(2026-06-23): 같은 개입내용이 이미 활성(완료/폐기/종료/효과없음 아님)이면 새 줄 안 만들고 dup 반환.
  // 버튼 더블탭·폴링 재처리로 같은 항목 2줄 들어가던 문제.
  var ex = t.getDataRange().getValues();
  for (var ri = 1; ri < ex.length; ri++) {
    if (String(ex[ri][2]).trim() !== finalContent) continue;
    if (/완료|폐기|종료|효과없음/.test(String(ex[ri][7]))) continue;
    return { ok: true, dup: true, content: finalContent, area: String(ex[ri][1]) };
  }
  var before = '';
  var ws = ss.getSheetByName('주간_요약');
  if (ws && ws.getLastRow() > 1) {
    var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
    var ci = hdr.indexOf('전환율');
    if (ci >= 0) { var last = ws.getRange(ws.getLastRow(), 1, 1, ws.getLastColumn()).getValues()[0]; before = '전환율 ' + last[ci] + '% (착수시점)'; }
  }
  var d = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  t.appendRow([d, finalArea, finalContent, '', before, '', '-', verdict || '착수']);
  SpreadsheetApp.flush(); // 추가 직후 refreshCockpit이 이 줄을 바로 읽도록 커밋 (안 하면 옛 목록으로 콕핏 그림)
  return { ok: true, content: finalContent, area: finalArea };
}

// ⏳ 반복 경고/액션 에이징 — 같은 알림이 며칠째인지 추적 (무뎌짐 방지). 키가 안 오면 해소로 보고 🔔 경고_해소로그에 기록(지속일 = 은우가 닫은 증거).
function trackAlertAges_(payload) {
  var keys = (payload.keys || []).map(String);
  var props = PropertiesService.getScriptProperties();
  var map = {};
  try { map = JSON.parse(props.getProperty('CX_ALERT_AGES') || '{}'); } catch (e) { map = {}; }
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var dayDiff = function (a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000) + 1; };
  var ages = {};
  keys.forEach(function (k) {
    if (!map[k]) map[k] = today;
    ages[k] = dayDiff(map[k], today);
  });
  var resolved = [];
  Object.keys(map).forEach(function (k) {
    if (keys.indexOf(k) < 0) { resolved.push([k, map[k], today, dayDiff(map[k], today)]); delete map[k]; }
  });
  if (resolved.length) {
    var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
    var sh = ensureSheetWithHeaders_(ss, '🔔 경고_해소로그', ['경고', '최초발생', '해소일', '지속일']);
    resolved.forEach(function (r) { sh.appendRow(r); });
  }
  props.setProperty('CX_ALERT_AGES', JSON.stringify(map));
  return { ok: true, ages: ages, resolved: resolved.length };
}

// 영역 → 콕핏 출처 태그 (은우가 진행중 항목 출처 한눈에 — D2C=미주봇 케이스북·UX=UX사례 채택·CX=직접개입).
function cxSourceTag_(area) {
  var a = String(area);
  if (a.indexOf('D2C') >= 0) return 'D2C';      // /적용 = D2C 케이스북(미주봇) 인풋
  if (a.indexOf('UX') >= 0) return 'UX';        // UX 사례 채택
  if (a.indexOf('CX주간') >= 0) return 'CX주간'; // 주간 리포트 자동 후보
  if (a.indexOf('CX 관리자') >= 0) return 'CX 관리자'; // 은우 본업(측정·UTM 등) — 창번호 대신
  if (a.indexOf('CX') >= 0) return 'CX';        // /할거 = 자사몰·CX 직접
  return a || '직접';
}

// 개입기록 항목 판정 변경 (키워드 부분매칭). /끝(완료)·/보류 공용. 완료된 건 제외하고 검색.
// 1개 매칭 → 변경, 여러 개 → multi:true로 후보 반환(사용자가 더 구체적으로), 0개 → error.
// 현재(최신 주간) 전환율 라벨 — Before/After 자동 채움 공용
function currentConvLabel_(suffix) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var ws = ss.getSheetByName('주간_요약');
  if (!ws || ws.getLastRow() < 2) return '';
  var hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var ci = hdr.indexOf('전환율');
  if (ci < 0) return '';
  var last = ws.getRange(ws.getLastRow(), 1, 1, ws.getLastColumn()).getValues()[0];
  return '전환율 ' + last[ci] + '% ' + (suffix || '');
}
// 콕핏 줄 복붙 대응: 앞 불릿(·)·[창태그]·⏳묵음 떼고 매칭. ("[1창] 매출 41%" → "매출 41%")
function cxKwNorm_(s) {
  return String(s).replace(/^[·•\s]+/, '').replace(/\[[^\]]*\]/g, '').replace(/⏳\s*\d+일\(묵음\)/g, '').trim();
}
function setCxVerdictByKeyword_(keyword, verdict, after) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var iv = ss.getSheetByName('🛠 개입기록');
  if (!iv || iv.getLastRow() < 2) return { ok: false, error: '개입기록이 비어있음' };
  var data = iv.getDataRange().getValues();
  var kw = cxKwNorm_(keyword).toLowerCase();
  var matches = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][7]) === '완료') continue; // 이미 완료는 스킵
    if (String(data[i][2]).toLowerCase().indexOf(kw) >= 0) matches.push({ row: i + 1, content: String(data[i][2]) });
  }
  if (matches.length === 0) return { ok: false, error: '"' + keyword + '" 매칭 없음 — /콕핏 으로 항목 확인' };
  if (matches.length > 1) return { ok: false, multi: true, matches: matches };
  iv.getRange(matches[0].row, 8).setValue(verdict);
  // ★완료 시 A열에 완료일 스탬프 (2026-07-14) — 이전엔 '등록일'만 있어 "이번주 한 일" 판정이 틀렸음
  if (String(verdict) === '완료') iv.getRange(matches[0].row, 1).setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'));
  var af = after;
  if (verdict === '완료') {
    // After 미입력 → 완료시점 전환율 자동(Before와 동일 지표로 쌍 완성, 협상카드 빈칸 방지)
    if (!af) af = currentConvLabel_('(완료시점·자동, 정확지표 권장)');
    if (af) iv.getRange(matches[0].row, 6).setValue(af);
  } else if (after) {
    iv.getRange(matches[0].row, 6).setValue(after);
  }
  return { ok: true, content: matches[0].content, after: af, autoAfter: !after && !!af };
}

// /끝·/완료(텍스트) 공용 완료 처리. "앵커 = 3.2%" → 키워드=앵커, After=3.2%. ONE THING이면 자동 클리어.
function handleCxDone_(chatId, arg) {
  var after = '', kw = String(arg).trim();
  var mm = kw.match(/^([\s\S]+?)\s*=\s*(.+)$/);
  if (mm) { kw = mm[1].trim(); after = mm[2].trim(); }
  var er = setCxVerdictByKeyword_(kw, '완료', after);
  if (er.ok) {
    var props = PropertiesService.getScriptProperties();
    var ot = props.getProperty('EUNWOO_ONE_THING') || '';
    if (ot && (ot.indexOf(kw) >= 0 || (er.content && (er.content.indexOf(ot) >= 0 || ot.indexOf(er.content) >= 0)))) props.deleteProperty('EUNWOO_ONE_THING'); // 완료한 게 ONE THING이면 비움
    refreshCockpit_();
    sendTGMessage(chatId, '✅ 완료 — 콕핏 갱신.\n· ' + er.content + (er.after ? '\n· After: ' + er.after + (er.autoAfter ? '\n💡 자동(전환율 proxy) — 정확한 지표 있으면 「/끝 ' + kw + ' = 값」으로 다시' : ' (협상카드 반영)') : ''));
  } else if (er.multi) sendTGMessage(chatId, '⚠️ 여러 개 매칭 — 더 구체적으로:\n' + er.matches.map(function (x) { return '· ' + x.content; }).join('\n'));
  else sendTGMessage(chatId, '⚠️ ' + er.error);
}

// /삭제 — 필요없어진 항목을 개입기록에서 행 삭제. /끝과 같은 키워드 매칭(1개=삭제, 여러개=후보 나열).
// ★완료(협상카드 증거)는 삭제 대상서 제외 — 실수로 성과기록 날리는 것 방지.
function handleCxDelete_(chatId, kw) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var iv = ss.getSheetByName('🛠 개입기록');
  if (!iv || iv.getLastRow() < 2) { sendTGMessage(chatId, '⚠️ 개입기록이 비어있음'); return; }
  var data = iv.getDataRange().getValues();
  var k = cxKwNorm_(kw).toLowerCase();
  var matches = [];
  for (var i = 1; i < data.length; i++) {
    if (/완료/.test(String(data[i][7]))) continue; // 완료=협상카드 증거, 삭제 제외
    if (String(data[i][2]).toLowerCase().indexOf(k) >= 0) matches.push({ row: i + 1, content: String(data[i][2]) });
  }
  if (matches.length === 0) { sendTGMessage(chatId, '⚠️ "' + kw + '" 매칭 없음 (완료된 건 /삭제 대상 아님) — /콕핏 확인'); return; }
  if (matches.length > 1) { sendTGMessage(chatId, '⚠️ 여러 개 매칭 — 더 구체적으로:\n' + matches.map(function (x) { return '· ' + x.content; }).join('\n')); return; }
  var deleted = matches[0].content;
  iv.deleteRow(matches[0].row);
  addCxDismissed_(deleted); // ★거부 기억 — 주간 후보가 같은 걸 재등록 못 하게 (2026-07-01 좀비 fix)
  refreshCockpit_();
  sendTGMessage(chatId, '🗑️ 삭제 — 콕핏 갱신 (재추천 안 함).\n· ' + deleted);
}

// ── /실측: 완료 포함 아무 항목의 After 갱신 (개입기록+아카이브 양쪽) — setCxVerdictByKeyword_는 완료를 skip해서 별도 ──
function setCxAfterAnywhere_(keyword, after) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var kw = cxKwNorm_(keyword).toLowerCase();
  var hits = [];
  ['🛠 개입기록', '✅ 완료_아카이브'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][2]).toLowerCase().indexOf(kw) >= 0) hits.push({ sh: sh, row: i + 1, content: String(d[i][2]), tab: name });
    }
  });
  // 같은 내용이 개입기록+아카이브 양쪽에 있으면 둘 다 갱신(중복 아님) — 내용 기준 유니크로 multi 판단
  var uniq = {}; hits.forEach(function (h) { uniq[h.content] = true; });
  if (hits.length === 0) return { ok: false, error: '"' + keyword + '" 매칭 없음' };
  if (Object.keys(uniq).length > 1) return { ok: false, multi: true, matches: Object.keys(uniq) };
  hits.forEach(function (h) { h.sh.getRange(h.row, 6).setValue(after); });
  SpreadsheetApp.flush();
  return { ok: true, content: hits[0].content, updated: hits.length };
}

// ── 거부(삭제) 이력 tombstone — /삭제한 항목을 주간 후보가 부활시키던 좀비 방지 ──
// 키 = appendCxCandidates_와 같은 정규화(숫자/화살표 제거) → "골든타임 370명"과 "521명"도 같은 거부로 침.
function cxDismissNorm_(s) { return String(s).replace(/[\d,]+\s*(명|%|건|원)?/g, '').replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim(); }
function addCxDismissed_(content) {
  var props = PropertiesService.getScriptProperties();
  var list = [];
  try { list = JSON.parse(props.getProperty('CX_DISMISSED') || '[]'); } catch (e) { list = []; }
  var k = cxDismissNorm_(content);
  if (k && list.indexOf(k) < 0) { list.push(k); if (list.length > 80) list = list.slice(-80); props.setProperty('CX_DISMISSED', JSON.stringify(list)); }
}
function getCxDismissed_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CX_DISMISSED') || '[]'); } catch (e) { return []; }
}

// ① 백업(비파괴, 회의 전 9시): 개입기록 완료 → ✅완료_아카이브 복사. 중복(날짜+내용)은 skip. 삭제 안 함.
function archiveCx_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var iv = ss.getSheetByName('🛠 개입기록');
  if (!iv || iv.getLastRow() < 2) return { ok: true, archived: 0 };
  var arch = ensureSheetWithHeaders_(ss, '✅ 완료_아카이브', ['날짜', '영역', '개입내용', '맥락', 'Before', 'After', '측정단위', '판정', '아카이브일']);
  var seen = {};
  if (arch.getLastRow() > 1) arch.getDataRange().getValues().slice(1).forEach(function (r) { seen[String(r[0]) + '|' + String(r[2])] = true; });
  var n = 0;
  iv.getDataRange().getValues().slice(1).forEach(function (r) {
    if (String(r[7]) !== '완료') return;
    var k = String(r[0]) + '|' + String(r[2]); if (seen[k]) return; seen[k] = true;
    arch.appendRow([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], new Date()]); n++;
  });
  return { ok: true, archived: n };
}
// ② 정리(삭제, 회의 후): 백업 먼저 보장 후 개입기록 완료 삭제 + (weekLabel 주면) 지난주 미소화 후보 삭제.
function pruneCx_(weekLabel) {
  archiveCx_(); // 삭제 전 백업 보장
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var iv = ss.getSheetByName('🛠 개입기록');
  if (!iv || iv.getLastRow() < 2) return { ok: true, pruned: 0 };
  var data = iv.getDataRange().getValues(); var del = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var v = String(data[i][7]);
    if (v === '완료' || (v === '후보' && weekLabel && String(data[i][0]) !== String(weekLabel))) { iv.deleteRow(i + 1); del++; }
  }
  return { ok: true, pruned: del };
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
  // ★sent만이 아니라 생성된 건 다(sent·채택·패스·draft) — 패스한 것도 반복 안 하게 (2026-06-30 낙관적UI 3연속 fix)
  var history = rows.filter(function (r) { return String(r[2]).trim(); }).map(function (r) {
    return { 일자: String(r[0]), 기법명: String(r[2]), 카테고리: String(r[3]), 상태: String(r[5]) };
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

// ===== 🎨 디자인 사례집 (매일 1개 개인 DM, 채택=시트표시만) =====
// 시트 🎨디자인_사례 [ID,추가일,브랜드,제목,부제,핵심,적용,출처,상태,발송일시]. 상태=미발송→발송→채택/패스.
function getDesignTab_() { return SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID).getSheetByName('🎨 디자인_사례'); }
// 📈 개입_추적 (2026-08-03) — 개입 효과를 주별로 쌓는다. 키 = 주차|지표|대상 upsert.
//   한 주 Before/After로는 그 주의 흔들림(광고비·유입량)에 속는다. 바페 상단 측정에서 실제로 겪음:
//   11.1→17.5%를 "개선"으로 읽었으나 8주로 보니 원래 14~17%대였고 11.1%가 예외적 저점이었다.
//   행 = [주차, 시작, 종료, 지표, 대상, 값, 분모, 비고, 갱신]
function trackWeeklyUpsert_(rows) {
  try {
    if (!rows || !rows.length) return { ok: true, added: 0, updated: 0 };
    var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
    var sh = ensureSheetWithHeaders_(ss, '📈 개입_추적',
      ['주차', '시작', '종료', '지표', '대상', '값', '분모', '비고', '갱신']);
    var data = sh.getDataRange().getValues();
    var idx = {};
    for (var i = 1; i < data.length; i++) idx[data[i][0] + '|' + data[i][3] + '|' + data[i][4]] = i + 1;
    var added = 0, updated = 0, now = new Date();
    rows.forEach(function (r) {
      r[8] = now;
      var k = r[0] + '|' + r[3] + '|' + r[4];
      if (idx[k]) { sh.getRange(idx[k], 1, 1, 9).setValues([r]); updated++; }
      else { sh.appendRow(r); added++; }
    });
    SpreadsheetApp.flush();
    return { ok: true, added: added, updated: updated };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 자동보충 적재 — report.js가 Claude로 생성한 행([ID..발송일시] 10칸) append, 제목 중복 skip
function appendDesignCases_(rows) {
  try {
    var sh = getDesignTab_();
    if (!sh) return { ok: false, error: '시트 없음' };
    var data = sh.getDataRange().getValues();
    var titles = {}; for (var i = 1; i < data.length; i++) titles[String(data[i][3] || '').trim()] = true;
    var added = [];
    (rows || []).forEach(function (r) {
      var t = String(r[3] || '').trim();
      if (!t || titles[t]) return;
      sh.appendRow(r); titles[t] = true; added.push(r[0] + ' ' + t);
    });
    SpreadsheetApp.flush();
    return { ok: true, added: added.length, items: added };
  } catch (e) { return { ok: false, error: e.message }; }
}
// 브랜드 prefix('A'/'B')의 다음 미발송 1개 발송. 발송하면 {id,title}, 없으면 null.
function sendOneDesignByBrand_(sh, data, prefix) {
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).charAt(0) === prefix && String(data[i][8]).trim() === '미발송') {
      var r = data[i];
      var msg = '🎨 <b>디자인 사례</b> [' + r[0] + '] · ' + r[2]
        + '\n\n<b>' + r[3] + '</b>' + (r[4] ? '\n<i>' + r[4] + '</i>' : '')
        + (r[5] ? '\n\n💡 ' + r[5] : '')
        + (r[6] ? '\n\n🎯 <b>우리 적용:</b> ' + r[6] : '')
        + (r[7] ? '\n\n🔗 ' + r[7] : '');
      var kb = { inline_keyboard: [[
        { text: '⭐ 채택', callback_data: 'dzc:add:' + r[0] },
        { text: '✕ 패스', callback_data: 'dzc:pass:' + r[0] }
      ]] };
      sendTGMessage(EUNWOO_CHAT_ID, msg, kb);
      sh.getRange(i + 1, 9).setValue('발송');
      sh.getRange(i + 1, 10).setValue(new Date());
      return { id: r[0], title: r[3] };
    }
  }
  return null;
}
// 매일 A(식품)+B(주방기기)+D(홈페이지 UI/UX) 각 1개 = 3개 발송. 은우 2026-06-24 / D 추가 2026-08-01.
function sendNextDesignCase_() {
  var sh = getDesignTab_();
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: '디자인_사례 시트 없음/빔' };
  var data = sh.getDataRange().getValues();
  var a = sendOneDesignByBrand_(sh, data, 'A');
  var b = sendOneDesignByBrand_(sh, data, 'B');
  // D 홈페이지 = 2026-08-01 신설(은우 '개쩌는 홈 1페이지 UI/UX 모을 것'). 업종 무관.
  // C 상세페이지는 은우가 수동으로 참고하는 칸이라 발송 대상 아님.
  var d = sendOneDesignByBrand_(sh, data, 'D');
  SpreadsheetApp.flush();
  // ★큐 헬스 경고 (2026-07-23 은우 요청) — 조용한 실패 방지. 예전엔 큐 비면 console.warn만 하고 DM 안 나가
  //   2주 발송 끊겨도 아무도 몰랐음. 이제 브랜드 큐 비거나(❌) ≤1개(⚠️)면 은우 DM으로 알림.
  var cnt = function (pre) { var n = 0; for (var i = 1; i < data.length; i++) { if (String(data[i][0]).charAt(0) === pre && String(data[i][8]).trim() === '미발송') n++; } return n; };
  var warn = [];
  [['A', '식품', a], ['B', '주방기기', b], ['D', '홈페이지', d]].forEach(function (x) {
    if (!x[2]) warn.push('❌ ' + x[1] + ' — 큐가 비어 오늘 발송 못함');
    else {
      // ★data는 발송 전 스냅샷(위 getDataRange)이라 오늘 나간 1건이 아직 '미발송'으로 잡힘 → -1이 실제 잔여
      var rem = cnt(x[0]) - 1;
      if (rem <= 0) warn.push('❌ ' + x[1] + ' — 오늘이 마지막. 내일 발송분 없음');
      else if (rem <= 2) warn.push('⚠️ ' + x[1] + ' — ' + rem + '일치 남음');
    }
  });
  if (warn.length) sendTGMessage(EUNWOO_CHAT_ID, '🎨 <b>디자인 케이스북 큐 경고</b>\n' + warn.join('\n') + '\n→ 클로드한테 "디자인 사례 큐 보충해줘"');
  if (!a && !b && !d) return { ok: true, done: true }; // 셋 다 미발송 없음
  return { ok: true, sent: [a, b, d].filter(Boolean) };
}
function setDesignCaseStatus_(id, status) {
  var sh = getDesignTab_();
  if (!sh) return { ok: false, error: '시트 없음' };
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) { sh.getRange(i + 1, 9).setValue(status); SpreadsheetApp.flush(); return { ok: true, title: String(data[i][3]) }; }
  }
  return { ok: false, error: 'ID 없음: ' + id };
}
// 케이스북 웹용: 발송된(발송/채택/패스) 디자인 사례 목록. 미발송은 제외.
function getDesignCasesForWeb_() {
  var sh = getDesignTab_();
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues().slice(1);
  return data.filter(function (r) {
    var st = String(r[8]).trim();
    if (!String(r[3]).trim()) return false;
    // ★C 상세페이지 / D 홈페이지(2026-08-01)는 "쌓아두고 꺼내 보는" 칸이라 발송 여부와 무관하게
    //   전부 웹에 보여야 한다. 특히 C는 봇 DM 대상이 아니라 상태가 계속 '미발송'이라
    //   기존 조건대로면 영영 안 떴음.
    if ('CD'.indexOf(String(r[0]).charAt(0)) >= 0) return true;
    return (st === '발송' || st === '채택' || st === '패스');
  }).map(function (r) {
    return {
      id: String(r[0]), brand: String(r[2]), title: String(r[3]), sub: String(r[4]),
      point: String(r[5]), apply: String(r[6]), src: String(r[7]), status: String(r[8]).trim(),
      date: (Object.prototype.toString.call(r[9]) === '[object Date]') ? Utilities.formatDate(r[9], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[9]).slice(0, 10)
    };
  });
}
// 케이스북 카드에서 디자인 사례 채택/패스 토글 (google.script.run 호출용 — 언더스코어 없는 공개함수)
function setDesignStatusWeb(id, status) { return setDesignCaseStatus_(id, status); }

// ===== 단축링크 클릭 기록 (go.italy CF Function이 클릭마다 호출) =====
// GA4가 인스타 인앱 유입을 놓치는 걸 우회 — 리다이렉트 서버에서 클릭 자체를 셈 = 실유입.
function getClickLogTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('📊 단축링크_클릭');
  if (!sh) { sh = ss.insertSheet('📊 단축링크_클릭'); sh.appendRow(['시각', '슬러그', 'referer', 'ua']); sh.setFrozenRows(1); }
  return sh;
}
function logShortlinkClick_(c) {
  try {
    var slug = String((c && c.slug) || '').replace(/^\/+/, '').slice(0, 60);
    if (!slug) return { ok: false, error: 'no slug' };
    getClickLogTab_().appendRow([new Date(), slug, String((c && c.ref) || '').slice(0, 200), String((c && c.ua) || '').slice(0, 200)]);
    return { ok: true, slug: slug };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 케이스북 페이지 ⭐채택/패스/되돌리기 버튼 콜백 (google.script.run 호출 — 언더바 X 필수)
// 일자(A열)로 노출 사례 1건 찾아 상태칸(F)만 갱신. draft/skipped는 안 건드림.
// UX 날짜 정규화 — 시트는 날짜를 직렬번호/Date로 저장, 텔레그램 콜백은 "yyyy-MM-dd" 문자열 → 매칭 깨짐 방지(양쪽 yyyy-MM-dd로)
function _uxYmd_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) { var d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000)); return isNaN(d.getTime()) ? s : Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'); }
  var dd = new Date(s); return isNaN(dd.getTime()) ? s : Utilities.formatDate(dd, 'Asia/Seoul', 'yyyy-MM-dd');
}
function setUXCaseStatus(date, status) {
  if (['채택', '패스', 'sent'].indexOf(status) < 0) return { ok: false, error: 'bad status' };
  var sh = getUXTab_();
  var data = sh.getDataRange().getValues();
  var dkey = _uxYmd_(date);
  for (var i = 1; i < data.length; i++) {
    var st = String(data[i][5]);
    var shown = (st === 'sent' || st === '케이스북' || st === '채택' || st === '패스');
    if (_uxYmd_(data[i][0]) === dkey && shown) {
      sh.getRange(i + 1, 6).setValue(status);
      var todoObj = null;
      if (status === '채택') {
        try { var r = addUXTodo(date); if (r && r.todo) todoObj = r.todo; } catch (e) {} // 케이스북 내 할일
        try { addCxStart_('[UX사례] ' + String(data[i][2]).slice(0, 80), 'UX', '백로그'); refreshCockpit_(); } catch (e) {} // 콕핏 나중에에도 ([UX] 태그)
      }
      return { ok: true, date: String(date), status: status, todo: todoObj };
    }
  }
  return { ok: false, error: 'no case for date' };
}

// ===== UX 할일 (채택 사례 → 내 UI/UX 액션) =====
var UX_TODO_HEADERS = ['원본일자', '기법명', '카테고리', '액션', '상태', '메모', '생성일시'];
function getUXTodoTab_() {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ss.getSheetByName('UX_할일');
  if (!sh) {
    sh = ss.insertSheet('UX_할일');
    sh.appendRow(UX_TODO_HEADERS);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, UX_TODO_HEADERS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}
// 사례 본문에서 "[이태리정미소 ... 적용]" 섹션(실행안)을 한 덩어리로 추출 → 액션
function extractUXAction_(body) {
  var s = String(body);
  var m = s.match(/\[이태리정미소[^\]]*\]\s*([\s\S]*?)(?:\n\s*━|\[예상|$)/);
  var t = (m ? m[1] : s).replace(/\s+/g, ' ').trim();
  return t.length > 600 ? t.slice(0, 600) + '…' : t;
}
function getUXTodos_() {
  var td = getUXTodoTab_();
  if (td.getLastRow() < 2) return [];
  return td.getDataRange().getValues().slice(1).map(function (r) {
    return { date: String(r[0]), title: String(r[1]), cat: String(r[2]), action: String(r[3]), status: String(r[4]), memo: String(r[5]) };
  });
}
// 채택 사례 → 할일로 옮김 (중복이면 그대로). google.script.run 호출 — 언더바 X.
function addUXTodo(date) {
  var ux = getUXTab_();
  var data = ux.getDataRange().getValues();
  var dkey = _uxYmd_(date);
  var c = null;
  for (var i = 1; i < data.length; i++) { if (_uxYmd_(data[i][0]) === dkey) { c = data[i]; break; } }
  if (!c) return { ok: false, error: 'no case' };
  var td = getUXTodoTab_();
  var rows = td.getDataRange().getValues();
  for (var j = 1; j < rows.length; j++) { if (_uxYmd_(rows[j][0]) === dkey) return { ok: true, exists: true }; }
  var action = extractUXAction_(c[4]);
  td.appendRow([dkey, String(c[2]), String(c[3]), action, '할일', '', new Date()]);
  return { ok: true, todo: { date: String(date), title: String(c[2]), cat: String(c[3]), action: action, status: '할일', memo: '' } };
}
function setUXTodoStatus(date, status) {
  if (['할일', '진행중', '완료'].indexOf(status) < 0) return { ok: false, error: 'bad status' };
  var td = getUXTodoTab_();
  var data = td.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date)) { td.getRange(i + 1, 5).setValue(status); return { ok: true }; }
  }
  return { ok: false, error: 'no todo' };
}
function removeUXTodo(date) {
  var td = getUXTodoTab_();
  var data = td.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(date)) { td.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, error: 'no todo' };
}

// ===== 은우 성과 추적 (월간 baseline + 개입기록) — 한 시트에 모음 =====
function ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
  }
  return sh;
}
// payload.monthly[] = {month,revenue,orders,aov,skuShare,dailyAvg,note}
// payload.interventions[] = {date,area,action,context,before,after,unit,verdict}
function initEunwooTracking_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var added = { monthly: 0, interventions: 0 };
  var b = ensureSheetWithHeaders_(ss, '📊 월간지표', ['월', '매출', '주문수', 'AOV', '핵심SKU 비중', '일평균매출', '메모']);
  (payload.monthly || []).forEach(function (r) {
    b.appendRow([r.month, r.revenue, r.orders, r.aov, r.skuShare, r.dailyAvg, r.note || '']); added.monthly++;
  });
  var t = ensureSheetWithHeaders_(ss, '🛠 개입기록', ['날짜', '영역', '개입내용', '맥락(휴무/공구/광고)', 'Before(지표)', 'After(지표)', '측정단위', '판정']);
  (payload.interventions || []).forEach(function (r) {
    t.appendRow([r.date, r.area, r.action, r.context || '', r.before || '', r.after || '', r.unit || '', r.verdict || '']); added.interventions++;
  });
  return { ok: true, added: added };
}

// 월별 결제수단 비율 (자체결제=결제창 / 네이버·카카오=외부 비회원). payload.rows[]={month,total,self,naver,kakao,etc,selfPct,extPct}
function appendPayMethodMonthly_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '💳 월별_결제수단', ['월', '총주문', '자체결제(결제창)', '네이버페이', '카카오페이', '기타', '자체결제비율', '외부(네이버+카카오)비율']);
  (payload.rows || []).forEach(function (r) {
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.month)) sh.deleteRow(i + 1); }
    sh.appendRow([r.month, r.total, r.self, r.naver, r.kakao, r.etc, r.selfPct, r.extPct]);
  });
  return { ok: true, added: (payload.rows || []).length };
}

// 월별 결제수단 × 회원/비회원 교차. payload.rows[]={month,tot,self_m,self_g,naver_m,naver_g,kakao_m,kakao_g,guestPct}
function appendPayMemberMonthly_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '💳 결제수단×회원', ['월', '총', '자체_회원', '자체_비회원', '네이버_회원', '네이버_비회원', '카카오_회원', '카카오_비회원', '비회원비율']);
  (payload.rows || []).forEach(function (r) {
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.month)) sh.deleteRow(i + 1); }
    sh.appendRow([r.month, r.tot, r.self_m, r.self_g, r.naver_m, r.naver_g, r.kakao_m, r.kakao_g, r.guestPct]);
  });
  return { ok: true, added: (payload.rows || []).length };
}

// ★올바른 결제구분 (order_place_name 기준: 결제창=모바일웹/PC, 외부=네이버주문형/톡체크아웃) × 회원
// 기존 gateway 기준 잘못된 탭 2개 삭제 후 정확본 1개로 통합.
// payload.rows[]={month,tot,store,store_m,store_g,naver,talk,storePct,extPct,guestPct}
function recordPayBreakdown_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '💳 월별_결제구분',
    ['월', '총주문', '결제창:자체(카드·계좌)', '결제창:네이버페이', '결제창:카카오페이', '외부:네이버페이(주문형)', '외부:톡체크아웃', '회원', '비회원', '결제창%', '외부%']);
  (payload.rows || []).forEach(function (r) {
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.month)) sh.deleteRow(i + 1); }
    sh.appendRow([r.month, r.tot, r.cc_self, r.cc_naver, r.cc_kakao, r.ext_naver, r.ext_talk, r.mem, r.guest, r.storePct, r.extPct]);
  });
  return { ok: true, added: (payload.rows || []).length };
}

// 월별 결제수단(payment_method 코드) 분포. ⚠️cafe24 'card'=신용+체크 통합(분리불가). payload.rows[]={month,tot,card,prepaid,transfer,cell,cardPct,prepaidPct,transferPct}
function recordPayMethodDetail_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '💳 월별_결제수단상세',
    ['월', '총주문', '카드(신용+체크)', '예치금/선결제', '송금(계좌이체)', '휴대폰', '카드%', '예치금%', '송금%']);
  (payload.rows || []).forEach(function (r) {
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.month)) sh.deleteRow(i + 1); }
    sh.appendRow([r.month, r.tot, r.card, r.prepaid, r.transfer, r.cell, r.cardPct, r.prepaidPct, r.transferPct]);
  });
  return { ok: true, added: (payload.rows || []).length };
}

// 월별 유입 채널 (GA4 sessionDefaultChannelGroup). 결제수단≠유입경로 — 유입의 진실. payload.rows[]={month,tot,paidSocial,youtube,direct,search,navershop,etc,psPct}
function recordTrafficMonthly_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '📥 월별_유입',
    ['월', '총세션', '메타·인스타(광고)', '유튜브', 'Direct', '검색(구글·네이버)', '네이버쇼핑', '기타', '메타광고비중%']);
  (payload.rows || []).forEach(function (r) {
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === String(r.month)) sh.deleteRow(i + 1); }
    sh.appendRow([r.month, r.tot, r.paidSocial, r.youtube, r.direct, r.search, r.navershop, r.etc, r.psPct]);
  });
  return { ok: true, added: (payload.rows || []).length };
}

// 주간 UTM 캠페인별 유입→전환 적재 (📲 주간_UTM성과). 같은 주차 upsert(재실행 중복방지).
function recordUtmWeekly_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '📲 주간_UTM성과', ['주차', '구분', '캠페인', '유입', '구매', '매출(GA4최소치)', '기록일']);
  var week = String(payload.week || '');
  var ymd = function (v) { return (Object.prototype.toString.call(v) === '[object Date]') ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).slice(0, 10); };
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) { if (ymd(data[i][0]) === week) sh.deleteRow(i + 1); }   // 날짜/문자 둘 다 매칭(upsert)
  (payload.rows || []).forEach(function (r) {
    sh.appendRow(["'" + r.week, r.group, r.campaign, r.sessions, r.purchases, r.revenue, r.recordedAt]);   // 주차=텍스트 저장(날짜변환 방지)
  });
  return { ok: true, week: week, added: (payload.rows || []).length };
}

// 주간 버튼클릭(상페 선물/구매/장바구니/공유/리뷰) 위치×버튼별 적재 (📊 주간_버튼클릭). 같은 주차 upsert.
function recordButtonWeekly_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var sh = ensureSheetWithHeaders_(ss, '📊 주간_버튼클릭', ['주차', '위치', '버튼', '클릭수', '기록일']);
  var week = String(payload.week || '');
  var ymd = function (v) { return (Object.prototype.toString.call(v) === '[object Date]') ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).slice(0, 10); };
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) { if (ymd(data[i][0]) === week) sh.deleteRow(i + 1); }
  (payload.rows || []).forEach(function (r) {
    sh.appendRow(["'" + r.week, r.zone, r.label, r.clicks, r.recordedAt]);
  });
  return { ok: true, week: week, added: (payload.rows || []).length };
}

// 주간 분석→액션을 개입기록(🛠)에 "후보"로 자동 적재 + Before 스냅샷. 중복방지(날짜+개입내용). 은우가 착수/완료로 바꿈.
function appendCxCandidates_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var t = ensureSheetWithHeaders_(ss, '🛠 개입기록', ['날짜', '영역', '개입내용', '맥락(휴무/공구/광고)', 'Before(지표)', 'After(지표)', '측정단위', '판정']);
  var data = t.getDataRange().getValues();
  // 중복방지(2026-06-23 강화): 날짜무관 같은 개입내용이 이미 활성(완료/폐기 아님)이면 skip.
  //   기존 날짜|내용 키는 매주 날짜가 달라 같은 추천이 매주 쌓였음(등급쿠폰·레시피PV 누적). 내용 기준으로 변경.
  // 숫자/퍼센트 제거 정규화 키 — "골든타임 521명"·"384명", "레시피 PV ↓29%"·"↓34%"는 같은 추천이므로 묶음.
  var norm = function (s) { return String(s).replace(/[\d,]+\s*(명|%|건|원)?/g, '').replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim(); };
  var active = {};
  for (var i = 1; i < data.length; i++) {
    if (/완료|폐기|종료|효과없음/.test(String(data[i][7]))) continue;
    active[norm(data[i][2])] = true;
  }
  // ★거부 이력(은우가 /삭제한 것) — 재등록 금지 (2026-07-01 좀비 fix: 6/25 삭제한 등급쿠폰·골든타임·레시피PV가 6/29 주간에 부활했음)
  var dismissed = {};
  getCxDismissed_().forEach(function (k) { dismissed[k] = true; });
  var added = 0;
  (payload.rows || []).forEach(function (r) {
    var act = String(r.action).trim();
    if (active[norm(act)] || dismissed[norm(act)]) return;
    t.appendRow([r.date, r.area || 'CX주간', r.action, r.context || '', r.before || '', '', '주간', '후보']);
    active[act] = true; added++;
  });
  return { ok: true, added: added };
}

// 클러리티 패턴→액션 후보 적재. 중복방지=개입내용 텍스트(날짜 무시). 진행 중(후보/착수/진행중/보류/백로그)이면 skip,
// 완료(✅)된 액션이 재발하면 다시 후보로 올림(회귀 신호). area='클러리티' → 콕핏 [클러리티] 태그.
function appendClarityCandidates_(payload) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var t = ensureSheetWithHeaders_(ss, '🛠 개입기록', ['날짜', '영역', '개입내용', '맥락(휴무/공구/광고)', 'Before(지표)', 'After(지표)', '측정단위', '판정']);
  var data = t.getDataRange().getValues();
  var active = {};
  for (var i = 1; i < data.length; i++) {
    var st = String(data[i][7] || '');
    if (st.indexOf('완료') < 0 && st.indexOf('✅') < 0) active[String(data[i][2]).trim()] = true;
  }
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d');
  var added = 0, skipped = 0;
  (payload.rows || []).forEach(function (r) {
    var act = String(r.action || '').trim();
    if (!act) return;
    if (active[act]) { skipped++; return; }
    t.appendRow([today, '클러리티', act, String(r.context || ''), '', '', '', '후보']);
    active[act] = true; added++;
  });
  if (added) refreshCockpit_();
  return { ok: true, added: added, skipped: skipped };
}

// 클러리티 인앱 막힘신호 날짜별 upsert. 인스타 인앱(광고유입 78%) 결제막힘 추세 = 개입 전후 효과 = 협상카드.
function appendClarityDaily_(c) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var t = ss.getSheetByName('📹 클러리티_일별') || ss.insertSheet('📹 클러리티_일별');
  var hdr = ['날짜', '인앱_세션', '인앱_데드클릭%', '인앱_빠른뒤로%', '인앱_분노클릭%', '인앱_스크롤깊이'];
  t.getRange(1, 1, 1, hdr.length).setValues([hdr]);
  var n = function (v) { return v === 0 ? 0 : (v || ''); };
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d');
  var vals = [today, n(c.inappSessions), n(c.inappDeadPct), n(c.inappQuickbackPct), n(c.inappRagePct), n(c.inappScrollDepth)];
  var data = t.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === today) { t.getRange(i + 1, 1, 1, vals.length).setValues([vals]); return { ok: true, upserted: today }; }
  }
  t.appendRow(vals);
  return { ok: true, appended: today };
}

// 6/20 GA4 (not set) 검증 리마인더 (GTM 인앱 page_view 고친 효과 확인)
function remindNotSetCheck() {
  sendTGMessage(EUNWOO_CHAT_ID, '🔍 <b>오늘 GA4 인앱 추적 검증일</b>\nGTM에서 page_view 초기화 트리거로 고친 거(6/17) 효과 확인할 때.\n→ 클로드한테 "GA4 (not set) % 뽑아줘" 하면 55%에서 떨어졌는지 봐줌.\n떨어졌으면 성공, 별로면 스킨 인앱 fallback 추가.');
}

// ===== 🩺 헬스체크 (무인 침묵실패 감지) — report.js(Actions)와 독립된 GAS 트리거 =====
// 시트 최신행 날짜를 yyyy-MM-dd 문자열로 (Date·"M/d"·"yyyy-MM-dd~" 모두 처리). TZ 안전 위해 문자열 비교.
function lastRowDateStr_(sheet, col) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var v = sheet.getRange(sheet.getLastRow(), col + 1).getValue();
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v).split('~')[0].trim().replace(/\./g, '-');
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) { var p = s.split('/'); return (new Date()).getFullYear() + '-' + ('0' + p[0]).slice(-2) + '-' + ('0' + p[1]).slice(-2); }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}
// force=true면 OK여도 결과 발송(수동 테스트). 스케줄(force=false)은 문제 있을 때만 발송(노이즈 X).
function cxHeartbeat(force) {
  var ss = SpreadsheetApp.openById(PERSONAL_METRICS_SHEET_ID);
  var ymd = function (off) { return Utilities.formatDate(new Date(Date.now() - off * 86400000), 'Asia/Seoul', 'yyyy-MM-dd'); };
  var yday = ymd(1);
  var issues = [];
  var snapStr = lastRowDateStr_(ss.getSheetByName('일별_스냅샷'), 0);   // 리포트 성공 시 어제 날짜
  if (!snapStr || snapStr < yday) issues.push('일간 리포트 미갱신 (일별_스냅샷 최근 ' + (snapStr || '없음') + ') → report.js GitHub Actions 점검');
  var clrStr = lastRowDateStr_(ss.getSheetByName('📹 클러리티_일별'), 0); // 루틴 성공 시 오늘 날짜
  if (!clrStr || clrStr < yday) issues.push('클러리티 자동수집 미갱신 (📹클러리티_일별 최근 ' + (clrStr || '없음') + ') → 데스크탑 스케줄러/Clarity토큰 점검');
  if (issues.length) sendTGMessage(EUNWOO_CHAT_ID, '🩺 <b>봇 헬스체크 경고</b>\n' + issues.map(function (x) { return '⚠️ ' + x; }).join('\n'));
  else if (force) sendTGMessage(EUNWOO_CHAT_ID, '🩺 헬스체크 OK\n· 리포트 최근 ' + snapStr + '\n· 클러리티 최근 ' + clrStr);
  return { ok: true, issues: issues, snap: snapStr, clr: clrStr };
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
  // nearMinute(0): atHour만 쓰면 9~10시 1시간 윈도우라 늦게 옴 → 9시 ±15분으로 좁힘
  ScriptApp.newTrigger('triggerDailyReport').timeBased().atHour(9).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('triggerCollector').timeBased().everyHours(2).create();
  ScriptApp.newTrigger('triggerUXDraftMon').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(0).create();
  ScriptApp.newTrigger('triggerUXDraftThu').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(9).nearMinute(0).create();
  console.log('트리거 등록 완료');
}
function triggerUXDraftMon() { return triggerCXWorkflow_('daily-report.yml', 'ux_draft'); }
function triggerUXDraftThu() { return triggerCXWorkflow_('daily-report.yml', 'ux_draft'); }
