// data.json 무결성 및 시즌 15(패치 3.3) 반영 여부 검증 테스트
// 실행: node --test tests/validate_data.test.js  (Node 24는 디렉터리 인자를 모듈로 해석하므로 파일 경로 지정)
// 외부 의존성 없이 node:test 만 사용 — 저장소가 빌드 도구 없는 바닐라 JS 이기 때문
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'data.json'), 'utf8');
const items = JSON.parse(raw).items;
const version = JSON.parse(fs.readFileSync(path.join(root, 'db_version.json'), 'utf8')).version;

const VALID_TYPES = ['rune', 'runeword', 'unique', 'set', 'quest', 'merc', 'area', 'event', 'class'];
const RUNES = ['El', 'Eld', 'Tir', 'Nef', 'Eth', 'Ith', 'Tal', 'Ral', 'Ort', 'Thul', 'Amn', 'Sol', 'Shael',
  'Dol', 'Hel', 'Io', 'Lum', 'Ko', 'Fal', 'Lem', 'Pul', 'Um', 'Mal', 'Ist', 'Gul', 'Vex', 'Ohm', 'Lo',
  'Sur', 'Ber', 'Jah', 'Cham', 'Zod'];

const byName = (needle) => items.find((i) => i.name.includes(needle));

// ── 공통 무결성 (정상/경계) ──
test('인코딩: BOM 및 깨진 문자(U+FFFD) 없음', () => {
  assert.notEqual(raw.charCodeAt(0), 0xfeff);
  assert.ok(!raw.includes('�'));
});

test('모든 항목이 필수 필드를 올바른 타입으로 가짐', () => {
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(VALID_TYPES.includes(it.type), `잘못된 type: ${it.name}`);
    assert.equal(typeof it.name, 'string');
    assert.ok(it.name.trim().length > 0);
    assert.equal(typeof it.description, 'string');
    assert.ok(it.description.trim().length > 0, `빈 설명: ${it.name}`);
    assert.ok(Array.isArray(it.tags) && it.tags.length > 0, `태그 없음: ${it.name}`);
  }
});

test('항목 이름 중복 없음', () => {
  const seen = new Set();
  for (const it of items) {
    assert.ok(!seen.has(it.name), `중복: ${it.name}`);
    seen.add(it.name);
  }
});

test('룬워드 룬 조합은 실존 룬만 사용 (1~6개)', () => {
  for (const it of items.filter((i) => i.type === 'runeword')) {
    const runes = it.meta && it.meta.runes;
    assert.ok(Array.isArray(runes) && runes.length >= 1 && runes.length <= 6, it.name);
    for (const r of runes) assert.ok(RUNES.includes(r), `${it.name}: ${r}`);
  }
});

test('DB 버전이 9로 증가', () => {
  assert.equal(version, 9);
});

// ── 시즌 15 / 패치 3.3 ──
test('래더 시즌 항목에 현재 시즌 15 및 시즌 14까지의 이력 명시', () => {
  const d = byName('Ladder Season').description;
  assert.match(d, /현재 시즌: 시즌 15/);
  for (const s of ['시즌 12', '시즌 13', '시즌 14', '시즌 15']) assert.ok(d.includes(s), s);
});

test('패치 3.3 / 시즌 15 이벤트 존재 (날짜, 유니크 리워크, 비래더 룬워드)', () => {
  const it = byName('Patch 3.3');
  assert.ok(it, '패치 3.3 항목 없음');
  assert.equal(it.type, 'event');
  assert.match(it.description, /2026-08-21/);
  for (const u of ['Bloodletter', 'Battlebranch', "Rogue's Bow", 'Pluckeye', 'Bane Ash', 'Gravenspine',
    "Blinkbat's Form", 'The Ward', 'Manald Heal', 'Angelic']) {
    assert.ok(it.description.includes(u), u);
  }
  for (const rw of ['Mania', 'Hysteria', 'Metamorphosis', 'Ground', 'Temper', 'Hearth', 'Cure', 'Bulwark']) {
    assert.ok(it.description.includes(rw), rw);
  }
});

test('패치 3.2 / 시즌 14 이벤트 존재', () => {
  const it = byName('Patch 3.2');
  assert.ok(it, '패치 3.2 항목 없음');
  assert.match(it.description, /2026-05-22/);
  assert.match(it.description, /WASD/);
});

test('누락 룬워드 4종(Ground/Temper/Hearth/Bulwark) 추가, Shael+Io+X 조합', () => {
  const expect = { Ground: 'Ort', Temper: 'Ral', Hearth: 'Thul', Bulwark: 'Sol' };
  for (const [name, third] of Object.entries(expect)) {
    const it = items.find((i) => i.type === 'runeword' && i.name.includes(`(${name})`));
    assert.ok(it, name);
    assert.deepEqual(it.meta.runes, ['Shael', 'Io', third]);
  }
});

test('Hustle 항목에 Mania/Hysteria 개명 반영', () => {
  const it = byName('Hustle');
  assert.match(it.name, /Mania/);
  assert.match(it.name, /Hysteria/);
});

// ── 기존 데이터 오류 수정 ──
test('Sling Ring → Sling 명칭 수정', () => {
  assert.ok(!items.some((i) => i.name.includes('Sling Ring')));
  assert.ok(byName('(Sling)'));
});

test('Dreadfang 은 단검이 아닌 검', () => {
  assert.ok(!byName('Dreadfang').tags.includes('단검'));
});

test("Bane's Garments 는 전 클래스용 3피스 세트", () => {
  const it = byName("Bane's Garments");
  assert.equal(it.meta.pieces, 3);
  for (const p of ['Oathmaker', 'Wraithskin', 'Authority']) assert.ok(it.description.includes(p), p);
});

test('악마술사 스킬 트리가 실제 스킬명 반영', () => {
  const all = items.filter((i) => i.type === 'class').map((i) => i.description).join('\n');
  for (const s of ['Summon Tainted', 'Summon Defiler', 'Consume', 'Hex: Bane', 'Mirrored Blades',
    'Miasma Bolt', 'Abyss', 'Sigil: Death']) {
    assert.ok(all.includes(s), s);
  }
  assert.ok(!all.includes('Summon Corrupted'));
  assert.ok(!all.includes('(Vane)'));
});
