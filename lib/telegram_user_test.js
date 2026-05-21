// session 인증 후 단톡방 메시지 fetch 검증용. 한 번 실행해서 어제~지금 메시지 잡히는지 확인.
const { fetchSongmamansChat } = require('./telegram_user');

(async () => {
  console.log('=== 송마망 단톡방 어제~지금 메시지 fetch ===');
  const r = await fetchSongmamansChat(1);
  if (!r) { console.log('FAIL'); return; }
  console.log('총 메시지:', r.total);
  console.log('발신자별:', JSON.stringify(r.bySender, null, 2));
  console.log('\n=== 최근 10건 ===');
  r.messages.slice(-10).forEach(m => {
    const tag = m.isBot ? '🤖' : '👤';
    console.log(tag, m.date.slice(11, 19), m.senderName + ':', (m.text || '(' + m.mediaType + ')').slice(0, 80));
  });
})();
