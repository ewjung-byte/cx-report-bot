// 첫 인증 1회만 실행. SMS 코드 입력하면 StringSession 출력.
// 이후 그 StringSession을 GitHub Secret TELEGRAM_USER_SESSION에 박으면 끝.
//
// 사용법:
//   1. cx-data/telegram_user.json 에 {api_id, api_hash, phone} 저장
//   2. node lib/telegram_user_session_init.js
//   3. SMS 코드 입력
//   4. 출력된 StringSession 복사 → GitHub Secret 등록
//
const fs = require('fs');
const readline = require('readline');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const cfg = JSON.parse(fs.readFileSync('C:/Users/user/italy-jungmiso/cx-data/telegram_user.json', 'utf8').replace(/^﻿/, ''));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, ans => res(ans.trim())));

(async () => {
  const session = new StringSession('');
  const client = new TelegramClient(session, parseInt(cfg.api_id), cfg.api_hash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => cfg.phone,
    password: async () => await ask('2FA 비밀번호 (없으면 엔터): '),
    phoneCode: async () => await ask('SMS 인증 코드 입력: '),
    onError: (err) => console.error('인증 오류:', err.message),
  });

  console.log('\n');
  console.log('========================================');
  console.log('  StringSession (아래 한 줄 복사):');
  console.log('========================================');
  console.log(client.session.save());
  console.log('========================================');
  console.log('\n다음 단계:');
  console.log('  1. 위 한 줄을 GitHub Secret TELEGRAM_USER_SESSION 에 등록');
  console.log('  2. cx-data/telegram_user.json 에 session 필드로도 추가 (로컬 테스트용)');
  console.log('  3. node lib/telegram_user_test.js 로 단톡방 메시지 fetch 검증');

  rl.close();
  await client.disconnect();
  process.exit(0);
})();
