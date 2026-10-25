// A call the server refuses with `unlock`: the user's terminal types the passcode, gets a one-shot session,
// retries once with it, then locks that session again. Squiggles have no terminal; the server also refuses their unlock.
export async function callWithUnlock(base, path, body, ask) {
  const send = (cookie) => fetch(base + path, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
  }).then((r) => r.json());
  let v = await send();
  if (v?.error && v.unlock && ask) {
    const code = await ask(), r = await fetch(base + '/passcode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'unlock', code }) });
    const u = await r.json(); if (u?.error) throw new Error(u.error);
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    try { v = await send(cookie); }
    finally { await fetch(base + '/passcode', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ op: 'lock' }) }).catch(() => {}); }
  }
  if (v && v.error) throw new Error(v.error);
  return v;
}
