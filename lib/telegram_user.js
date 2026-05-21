// 일상 사용 — StringSession으로 인증, 단톡방 메시지 fetch
//
// env 또는 cx-data/telegram_user.json 에서 credentials 읽음.
// daysBack 기본 1 = 어제~지금 메시지 모두 fetch (봇 메시지 포함).

const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync('C:/Users/user/italy-jungmiso/cx-data/telegram_user.json', 'utf8').replace(/^﻿/, ''));
    return {
      api_id: parseInt(process.env.TELEGRAM_API_ID || j.api_id),
      api_hash: process.env.TELEGRAM_API_HASH || j.api_hash,
      session: process.env.TELEGRAM_USER_SESSION || j.session || '',
    };
  } catch (e) {
    return {
      api_id: parseInt(process.env.TELEGRAM_API_ID || 0),
      api_hash: process.env.TELEGRAM_API_HASH || '',
      session: process.env.TELEGRAM_USER_SESSION || '',
    };
  }
}

const SONGMAMANS_CHAT_ID = -1005227165092; // 송마망 단톡방 (-100 prefix는 supergroup, 또는 원래 -5227165092)
// gramjs는 -100 prefix 또는 그냥 정수형 chat_id 둘 다 처리 가능. 우선 메모리 값 사용.

async function fetchSongmamansChat(daysBack = 1, options = {}) {
  const cfg = loadConfig();
  if (!cfg.session) {
    console.error('[telegram_user] session 없음 — telegram_user_session_init.js 먼저 실행');
    return null;
  }

  const session = new StringSession(cfg.session);
  const client = new TelegramClient(session, cfg.api_id, cfg.api_hash, { connectionRetries: 3 });
  try {
    await client.connect();
    const sinceTs = Math.floor(Date.now() / 1000) - daysBack * 86400;

    const chatId = options.chatId || -5227165092;
    const limit = options.limit || 200;

    const messages = [];
    for await (const msg of client.iterMessages(chatId, { limit })) {
      if (msg.date < sinceTs) break;
      const sender = msg.sender || {};
      messages.push({
        date: new Date(msg.date * 1000).toISOString(),
        senderId: sender.id ? sender.id.toString() : null,
        senderName: sender.firstName || sender.username || sender.title || 'unknown',
        isBot: sender.bot || false,
        text: msg.message || '',
        mediaType: msg.media ? (msg.media.className || 'media') : null,
      });
    }

    // 발신자별 분류
    const bySender = {};
    messages.forEach(m => {
      const key = m.senderName + (m.isBot ? ' (bot)' : '');
      bySender[key] = (bySender[key] || 0) + 1;
    });

    return {
      total: messages.length,
      daysBack,
      bySender,
      messages: messages.reverse(), // 시간순 정렬 (오래된 → 최신)
    };
  } catch (e) {
    console.error('[telegram_user] fetch 오류:', e.message);
    return null;
  } finally {
    await client.disconnect();
  }
}

module.exports = { fetchSongmamansChat };
