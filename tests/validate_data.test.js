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

test('DB 버전이 13으로 증가 (v12 캐시 사용자에게 앤야 보상 정정 반영)', () => {
  assert.equal(version, 13);
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

test("Horazon's Splendor 5피스 실제 구성 (단검/벨트 없음)", () => {
  const it = byName("Horazon's Splendor");
  assert.equal(it.meta.pieces, 5);
  for (const p of ['Countenance', 'Dominion', 'Hold', 'Legacy', 'Secrets',
    'Demonhead', 'Russet Armor', 'Demonhide Gloves', 'Mirrored Boots', 'Occult Codex']) {
    assert.ok(it.description.includes(p), p);
  }
  assert.ok(!it.description.includes('(단검)'));
  assert.ok(!it.description.includes('(벨트)'));
});

test('Metamorphosis 룬 표기(이오)와 실제 효과(마크 오브 울프/베어) 반영', () => {
  const it = byName('(Metamorphosis)');
  assert.deepEqual(it.meta.runes, ['Io', 'Cham', 'Fal']);
  assert.match(it.description, /조합: 이오 \+ 참 \+ 팔/);
  assert.match(it.description, /Mark of the Wolf/);
  assert.match(it.description, /Mark of the Bear/);
  assert.ok(!it.description.includes('변신 지속시간 무한'));
});

// ── 성기사(Paladin) 클래스 추가 ──
// 스킬 트리 설명의 "• 한글명 (English, 요구레벨)" 줄에서 영문 스킬명·레벨을 추출해 검증한다
const PALADIN_TREES = {
  'Combat Skills': ['Sacrifice', 'Smite', 'Holy Bolt', 'Zeal', 'Charge', 'Vengeance', 'Blessed Hammer',
    'Conversion', 'Holy Shield', 'Fist of the Heavens'],
  'Offensive Auras': ['Might', 'Holy Fire', 'Thorns', 'Blessed Aim', 'Concentration', 'Holy Freeze',
    'Holy Shock', 'Sanctuary', 'Fanaticism', 'Conviction'],
  'Defensive Auras': ['Prayer', 'Resist Fire', 'Defiance', 'Resist Cold', 'Cleansing', 'Resist Lightning',
    'Vigor', 'Meditation', 'Redemption', 'Salvation'],
};
const skillLines = (desc) => [...desc.matchAll(/^• .+? \(([A-Za-z' ]+), (\d+)\)/gm)]
  .map((m) => ({ name: m[1], level: Number(m[2]) }));
const paladinItems = () => items.filter((i) => i.type === 'class' && i.tags.includes('성기사'));

test('성기사 클래스 개요 항목 존재 (기본 스탯 포함)', () => {
  const it = items.find((i) => i.type === 'class' && i.name.includes('(Paladin)'));
  assert.ok(it, '성기사 개요 없음');
  assert.equal(it.meta.type, '클래스');
  assert.match(it.description, /힘 25 \/ 민첩 20 \/ 활력 25 \/ 에너지 15/);
});

test('성기사 스킬 트리 3개가 각각 정확히 10개 스킬을 올바른 순서로 가짐', () => {
  for (const [tree, skills] of Object.entries(PALADIN_TREES)) {
    const it = paladinItems().find((i) => i.name.includes(`(${tree})`));
    assert.ok(it, `트리 없음: ${tree}`);
    assert.equal(it.meta.type, '스킬트리');
    assert.deepEqual(skillLines(it.description).map((s) => s.name), skills, tree);
  }
});

test('성기사 스킬 요구 레벨은 1/6/12/18/24/30 경계값만 사용, 트리별 레벨 비내림차순', () => {
  const allowed = [1, 6, 12, 18, 24, 30];
  for (const it of paladinItems().filter((i) => i.meta.type === '스킬트리')) {
    const levels = skillLines(it.description).map((s) => s.level);
    for (const lv of levels) assert.ok(allowed.includes(lv), `${it.name}: ${lv}`);
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b), it.name);
    assert.equal(levels[0], 1);
    assert.equal(levels[levels.length - 1], 30);
  }
});

test('성기사 스킬 30종 트리 간 중복 없음, 대표 스킬 레벨 정확', () => {
  const all = paladinItems().flatMap((i) => skillLines(i.description));
  assert.equal(all.length, 30);
  assert.equal(new Set(all.map((s) => s.name)).size, 30);
  const lv = Object.fromEntries(all.map((s) => [s.name, s.level]));
  assert.equal(lv['Blessed Hammer'], 18);
  assert.equal(lv['Fist of the Heavens'], 30);
  assert.equal(lv['Concentration'], 18);
  assert.equal(lv['Salvation'], 30);
});

test('악마술사 항목은 성기사 추가 후에도 4개 유지', () => {
  assert.equal(items.filter((i) => i.type === 'class' && i.tags.includes('악마술사')).length, 4);
  assert.equal(paladinItems().length, 4);
});

test("UI: class 타입 라벨이 '악마술사'가 아닌 '클래스'로 통합", () => {
  const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(appJs, /class: \{ label: '클래스', cls: 'type-class' \}/);
  assert.match(appJs, /event: '이벤트', class: '클래스'/);
  assert.match(html, /data-cat="class">클래스</);
  assert.match(html, /<option value="class">클래스</);
  assert.ok(!/>악마술사</.test(html));
  assert.ok(!/label: '악마술사'|class: '악마술사'/.test(appJs));
});

// ── 퀘스트 전체 27종 (기드빈 등 누락분 보강) ──
// 원작 기준 막별 퀘스트 수: 1·2·3·5막 6개, 4막 3개
const quests = () => items.filter((i) => i.type === 'quest');
const questByEn = (en) => quests().find((i) => i.name.includes(`(${en})`));

test('퀘스트는 총 27개, 막별 6/6/6/3/6개', () => {
  assert.equal(quests().length, 27);
  const count = {};
  for (const q of quests()) count[q.meta.act] = (count[q.meta.act] || 0) + 1;
  assert.deepEqual(count, { 1: 6, 2: 6, 3: 6, 4: 3, 5: 6 });
});

test('퀘스트 act 값은 1~5 정수 (0·6·문자열 불가)', () => {
  for (const q of quests()) {
    assert.ok(Number.isInteger(q.meta.act) && q.meta.act >= 1 && q.meta.act <= 5, q.name);
    assert.ok(q.tags.includes(`act${q.meta.act}`), `act 태그 불일치: ${q.name}`);
  }
});

test('누락 퀘스트 9종이 올바른 막에 추가됨', () => {
  const expect = {
    'Tools of the Trade': 1, 'The Tainted Sun': 2, 'The Arcane Sanctuary': 2, 'The Summoner': 2,
    'The Blade of the Old Religion': 3, "Khalim's Will": 3, 'The Blackened Temple': 3,
    'Rescue on Mount Arreat': 5, 'Betrayal of Harrogath': 5,
  };
  for (const [en, act] of Object.entries(expect)) {
    const q = questByEn(en);
    assert.ok(q, `퀘스트 없음: ${en}`);
    assert.equal(q.meta.act, act, en);
  }
});

test("'기드빈' 검색 시 3막 옛 종교의 칼날 퀘스트가 걸림", () => {
  const hits = quests().filter((q) => q.tags.includes('기드빈') && q.description.includes('기드빈'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].meta.act, 3);
  assert.match(hits[0].name, /Blade of the Old Religion/);
});

test('주요 보상 정확: 임뷰, 칼림 부위 4종, 아리앗 룬, 안야 개인화', () => {
  assert.match(questByEn('Tools of the Trade').description, /찰시/);
  const khalim = questByEn("Khalim's Will").description;
  for (const p of ['눈', '뇌', '심장', '도리깨']) assert.ok(khalim.includes(p), p);
  const arreat = questByEn('Rescue on Mount Arreat').description;
  for (const r of ['Ral', 'Ort', 'Tal', 'Amn', 'Shael', 'Hel', 'Ko', 'Fal']) assert.ok(arreat.includes(r), r);
  assert.match(questByEn('Betrayal of Harrogath').description, /개인화/);
});

test('퀘스트 영문명 중복 없음', () => {
  const en = quests().map((q) => (q.name.match(/\(([^)]+)\)$/) || [])[1]);
  assert.ok(en.every(Boolean), '영문명 표기 누락');
  assert.equal(new Set(en).size, en.length);
});

// ── 5막 앤야 관련 보상 정정 ──
test('얼음 감옥 보상에 개인화 없음, 붉은 포탈·상점 개방 명시', () => {
  const it = questByEn('Prison of Ice');
  assert.ok(!it.description.includes('개인화'), '개인화는 하로가스의 배신 보상');
  assert.match(it.description, /저항력\(올레지\) \+10/);
  assert.match(it.description, /붉은 포탈/);
});

test("앤야 표기 통일 및 '안야' 검색 호환", () => {
  for (const en of ['Prison of Ice', 'Betrayal of Harrogath']) {
    const it = questByEn(en);
    assert.ok(!it.description.includes('안야'), `표기 불일치: ${en}`);
    assert.ok(it.tags.includes('앤야') && it.tags.includes('안야'), `태그 누락: ${en}`);
  }
});
