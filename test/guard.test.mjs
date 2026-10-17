import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGuard } from '../guard.mjs';

const TS = 'mac.tail0000.ts.net';
const refuse = makeGuard(4317, () => TS);
const req = (method, headers) => ({ method, headers });
const json = { 'content-type': 'application/json' };

test('this Mac: CLI (no Origin), local page, tailnet page', () => {
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', ...json })), '');
  assert.equal(refuse(req('GET', { host: 'localhost:4317' })), '');
  assert.equal(refuse(req('POST', { host: 'localhost:4317', origin: 'http://localhost:4317', 'sec-fetch-site': 'same-origin', ...json })), '');
  assert.equal(refuse(req('POST', { host: TS, origin: `https://${TS}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' })), '');
  assert.equal(refuse(req('GET', { host: '127.0.0.1:4317', 'sec-fetch-site': 'none' })), '');
});

test('cross-site simple POST (text/plain, no content type) is refused', () => {
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', origin: 'https://evil.example', 'content-type': 'text/plain' })), 'origin');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', 'content-type': 'text/plain' })), 'content-type');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317' })), 'content-type');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', origin: 'null', ...json })), 'origin');
});

test('cross-site GET (img tag) and other local ports are refused', () => {
  assert.equal(refuse(req('GET', { host: '127.0.0.1:4317', 'sec-fetch-site': 'cross-site' })), 'cross-site');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', origin: 'http://localhost:3000', ...json })), 'origin');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', origin: 'https://other.tail0000.ts.net', ...json })), 'origin');
  assert.equal(refuse(req('POST', { host: '127.0.0.1:4317', origin: `http://${TS}`, ...json })), 'origin');
});

test('DNS rebinding: any other Host is refused', () => {
  assert.equal(refuse(req('GET', { host: 'evil.example' })), 'host');
  assert.equal(refuse(req('GET', { host: 'evil.example:4317' })), 'host');
  assert.equal(refuse(req('GET', { host: '127.0.0.1:9999' })), 'host');
  assert.equal(refuse(req('GET', {})), 'host');
});

test('no tailnet name known yet: ts.net hosts refused, local still fine', () => {
  const r = makeGuard(4317, () => '');
  assert.equal(r(req('GET', { host: TS })), 'host');
  assert.equal(r(req('GET', { host: '127.0.0.1:4317' })), '');
});
