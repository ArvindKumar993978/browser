import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractHostname,
  extractOrigin,
  isAllowedWebUrl,
  isPrivateOrLocalHost,
  normalizeAddressInput
} from '../src/main/url.ts'

let passed = 0
let failed = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS: ${name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL: ${name} -> ${err.message}`)
    failed += 1
  }
}

// 1. URL & Protocol Security Tests
check('Allows http and https', () => {
  assert.equal(isAllowedWebUrl('https://example.com'), true)
  assert.equal(isAllowedWebUrl('http://localhost:3000'), true)
})

check('Blocks javascript:, file:, data:, vbscript:, electron:', () => {
  assert.equal(isAllowedWebUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedWebUrl('file:///C:/Windows/win.ini'), false)
  assert.equal(isAllowedWebUrl('data:text/html,<h1>x</h1>'), false)
  assert.equal(isAllowedWebUrl('vbscript:msgbox(1)'), false)
  assert.equal(isAllowedWebUrl('electron://settings'), false)
})

check('Converts unsafe schemes in omnibox into DuckDuckGo search', () => {
  assert.ok(normalizeAddressInput('javascript:alert(1)').startsWith('https://duckduckgo.com/?q='))
  assert.ok(normalizeAddressInput('file:///C:/secret').startsWith('https://duckduckgo.com/?q='))
})

check('Parses localhost:3000 and localhost/app as http://', () => {
  assert.equal(normalizeAddressInput('localhost:3000'), 'http://localhost:3000/')
  assert.equal(normalizeAddressInput('localhost/api'), 'http://localhost/api')
  assert.equal(normalizeAddressInput('localhost'), 'http://localhost/')
})

check('Upgrades localhost.evil.com to https:// (does not confuse with localhost)', () => {
  assert.equal(normalizeAddressInput('localhost.evil.com'), 'https://localhost.evil.com/')
})

check('Parses domain with port (example.com:8080) as https://', () => {
  assert.equal(normalizeAddressInput('example.com:8080/test'), 'https://example.com:8080/test')
})

check('Keeps RFC1918 private LAN IPs (10.x, 172.16-31.x, 192.168.x, 127.x) as http://', () => {
  assert.equal(normalizeAddressInput('http://10.0.0.1'), 'http://10.0.0.1/')
  assert.equal(normalizeAddressInput('172.16.5.4:8080'), 'http://172.16.5.4:8080/')
  assert.equal(normalizeAddressInput('192.168.1.1'), 'http://192.168.1.1/')
  assert.equal(normalizeAddressInput('127.0.0.1:5173'), 'http://127.0.0.1:5173/')
  assert.equal(isPrivateOrLocalHost('172.32.0.1'), false)
})

check('Parses IPv6 loopback [::1]:3000 as http://', () => {
  assert.equal(normalizeAddressInput('[::1]:3000'), 'http://[::1]:3000/')
})

check('Upgrades external http:// to https:// when httpsFirst=true', () => {
  assert.equal(normalizeAddressInput('http://example.com/path', true), 'https://example.com/path')
  assert.equal(normalizeAddressInput('http://example.com/path', false), 'http://example.com/path')
})

check('Extracts hostname and origin safely', () => {
  assert.equal(extractHostname('https://Sub.YouTube.com/watch?v=1'), 'sub.youtube.com')
  assert.equal(extractOrigin('https://Sub.YouTube.com/watch?v=1'), 'https://sub.youtube.com')
  assert.equal(extractOrigin('file:///C:/test.html'), '')
})

// 2. SQLite Storage Core Smoke Test (inside Electron's Node 24 runtime)
const tmp = mkdtempSync(join(tmpdir(), 'orbit-core-test-'))
try {
  const { DatabaseSync } = await import('node:sqlite')
  check('node:sqlite WAL schema, bookmarks, history, permissions', () => {
    const db = new DatabaseSync(join(tmp, 'orbit.db'))
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(`
      CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE, title TEXT);
      CREATE TABLE permissions (origin TEXT, perm TEXT, decision TEXT, PRIMARY KEY (origin, perm));
    `)
    db.prepare('INSERT INTO bookmarks (url, title) VALUES (?, ?)').run('https://example.com', 'Ex')
    db.prepare('INSERT INTO permissions (origin, perm, decision) VALUES (?, ?, ?)').run(
      'https://meet.example.com',
      'camera',
      'allow'
    )
    assert.equal(db.prepare('SELECT title FROM bookmarks').get().title, 'Ex')
    assert.equal(db.prepare('SELECT decision FROM permissions').get().decision, 'allow')
    db.close()
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`SUMMARY: passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
