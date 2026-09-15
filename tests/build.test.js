// build.sh 가 release/index.html 단일 파일을 올바르게 생성하는지 검증
// 실행: node --test tests/build.test.js
// 저장소 루트의 release/ 를 건드리지 않도록 임시 디렉터리에 소스를 복사해 빌드한다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const SOURCES = ['build.sh', 'index.html', 'app.js', 'data.json', 'db_version.json'];

// 소스 일부만 복사한 임시 작업 디렉터리 생성 — 누락 입력 엣지 케이스 재현용
function makeWorkdir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2r-build-'));
  for (const f of files) {
    // 원본에 없는 파일은 건너뜀 — 빌드 스크립트 부재 시에도 모듈 로드가 아닌 단언에서 실패하도록
    if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  return dir;
}

function runBuild(dir) {
  return spawnSync('bash', [path.join(dir, 'build.sh')], { cwd: dir, encoding: 'utf8' });
}

const workdir = makeWorkdir(SOURCES);
const result = runBuild(workdir);
const outPath = path.join(workdir, 'release', 'index.html');
const html = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';

const shimMatch = html.match(/<script id="release-fetch-shim">([\s\S]*?)<\/script>/);

// ── 정상 케이스 ──
test('build.sh 가 성공하고 release/ 에 index.html 한 파일만 생성', () => {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(path.join(workdir, 'release')), ['index.html']);
});

test('외부 app.js 참조가 제거되고 app.js 내용이 인라인됨', () => {
  assert.ok(!html.includes('src="app.js"'));
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.ok(html.includes(appJs), 'app.js 원문이 그대로 포함되어야 함');
});

test('fetch 가로채기 스크립트가 app.js 보다 먼저 위치', () => {
  assert.ok(shimMatch, 'shim 스크립트 존재');
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.ok(html.indexOf(shimMatch[0]) < html.indexOf(appJs));
});

// shim 을 격리된 vm 에서 실행해 실제 fetch 동작을 검증
function loadShim(originalFetch) {
  const ctx = { Response, Promise, JSON, fetch: originalFetch };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shimMatch[1], ctx);
  return ctx;
}

test('내장 db_version.json·data.json 이 원본과 동일하게 반환됨 (쿼리스트링 포함)', async () => {
  const ctx = loadShim(() => Promise.reject(new Error('원래 fetch 호출되면 안 됨')));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'db_version.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));

  const vRes = await ctx.window.fetch('./db_version.json?t=' + Date.now());
  assert.equal(vRes.ok, true);
  assert.deepEqual(await vRes.json(), version);

  const dRes = await ctx.window.fetch('./data.json');
  assert.equal(dRes.ok, true);
  assert.deepEqual(await dRes.json(), data);
});

// ── 엣지 케이스 ──
test('그 외 URL 은 원래 fetch 로 위임', async () => {
  const calls = [];
  const ctx = loadShim((url) => { calls.push(url); return Promise.resolve('passthrough'); });
  assert.equal(await ctx.window.fetch('https://example.com/data.json'), 'passthrough');
  assert.equal(await ctx.window.fetch('./other.json'), 'passthrough');
  assert.deepEqual(calls, ['https://example.com/data.json', './other.json']);
});

test('인코딩: BOM·U+FFFD 없음, 한국어 보존', () => {
  assert.notEqual(html.charCodeAt(0), 0xfeff);
  assert.ok(!html.includes('�'));
  assert.ok(html.includes('데이터 업데이트 중...'));
});

test('인라인 스크립트 안에 조기 종료되는 </script 가 없음 (<script 와 </script 짝 일치)', () => {
  const opens = (html.match(/<script\b/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  assert.equal(opens, 2);
  assert.equal(closes, 2);
});

test('재빌드 시 기존 release/ 의 잔여 파일이 제거됨', () => {
  const dir = makeWorkdir(SOURCES);
  fs.mkdirSync(path.join(dir, 'release'));
  fs.writeFileSync(path.join(dir, 'release', 'stale.txt'), 'old');
  const r = runBuild(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'release')), ['index.html']);
});

test('입력 파일(data.json) 누락 시 0 이 아닌 종료 코드, 결과물 없음', () => {
  const dir = makeWorkdir(SOURCES.filter((f) => f !== 'data.json'));
  const r = runBuild(dir);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'release', 'index.html')));
});

test('index.html 에 <script src="app.js"> 태그가 없으면 실패', () => {
  const dir = makeWorkdir(SOURCES);
  const p = path.join(dir, 'index.html');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('<script src="app.js"></script>', ''));
  const r = runBuild(dir);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'release', 'index.html')));
});
