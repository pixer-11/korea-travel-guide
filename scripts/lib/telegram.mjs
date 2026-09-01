// ─────────────────────────────────────────────────────────────
//  TELEGRAM SEND — one implementation, and it reads the answer.
//
//  Thirteen scripts each rolled their own fetch to api.telegram.org and not
//  one of them looked at the response. A refused send — bad token, empty body,
//  chat not found, message past Telegram's 4096 characters — resolved exactly
//  like a delivered one: the script exited 0, the workflow showed a green
//  tick, and the owner simply never received the report. Found 2026-09-01 in
//  marketing-review.mjs, where the AI answer came back empty, Telegram refused
//  the empty body, and the job still reported success.
//
//  The rule here: a send Telegram refused THROWS, with the status and the body
//  quoted, so the job that depended on it fails loudly. Missing credentials are
//  not a failure — local runs and the bootstrap window have no secrets and fall
//  back to printing on purpose. Those return false, so a caller can tell "not
//  configured" apart from "delivered".
// ─────────────────────────────────────────────────────────────

const API = 'https://api.telegram.org';

/** Both secrets or nothing — a half-configured send has no chat to land in. */
export function telegramCreds() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId } : null;
}

async function call(token, method, init) {
  const res = await fetch(`${API}/bot${token}/${method}`, init);
  // Status only: Telegram answers a rejection with 4xx/5xx, and reading the
  // body first would swallow the reason on a response that is not JSON at all
  // (a proxy error page, a rate-limit HTML page).
  if (!res.ok) {
    throw new Error(`telegram ${method} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return true;
}

/**
 * Send a text message. `opts` are Telegram's own sendMessage fields
 * (parse_mode, disable_web_page_preview, reply_markup, …) and are merged into
 * the payload verbatim — callers keep the exact message they were sending
 * rather than translating it through a second vocabulary.
 *
 * Returns true when delivered, false when the secrets are unset. Throws when
 * Telegram refused it. Note that nothing here truncates: a message over the
 * 4096-character limit is a refusal the caller should see, not something to
 * silently cut in half. Callers that want a cap slice before they call.
 */
export async function sendTelegram(text, opts = {}) {
  const creds = telegramCreds();
  if (!creds) return false;
  return call(creds.token, 'sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: creds.chatId, text, ...opts }),
  });
}

/**
 * Same contract for the multipart endpoints (sendPhoto, sendMediaGroup,
 * sendDocument). chat_id is appended here; `fill` adds the rest so each caller
 * keeps its own attachment shape.
 */
export async function sendTelegramForm(method, fill) {
  const creds = telegramCreds();
  if (!creds) return false;
  const form = new FormData();
  form.append('chat_id', creds.chatId);
  fill(form);
  return call(creds.token, method, { method: 'POST', body: form });
}
