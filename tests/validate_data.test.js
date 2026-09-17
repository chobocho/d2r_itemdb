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

test('DB 버전이 24로 증가 (v23 캐시 사용자에게 룬 정정 반영)', () => {
  assert.equal(version, 24);
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

// ── 이벤트/시스템 탭 보강: 도박·제작·MF·플레이어 수 ──
const events = () => items.filter((i) => i.type === 'event');
const eventByEn = (en) => events().find((i) => i.name.includes(en));

// v20: 패치 이력 8종(1.0~3.0) 추가로 16 → 24
test('이벤트 항목 24개, 신규 4종 존재 및 meta.type 보유', () => {
  assert.equal(events().length, 24);
  for (const en of ['Gambling', 'Crafted Items', 'Magic Find', 'Players Setting']) {
    const it = eventByEn(en);
    assert.ok(it, `항목 없음: ${en}`);
    assert.equal(typeof it.meta.type, 'string');
    assert.ok(it.tags.includes('event'), en);
  }
});

test('도박: 등급 확률과 아이템 레벨 범위 명시', () => {
  const d = eventByEn('Gambling').description;
  for (const s of ['1/2000', '2/2000', '10%', '캐릭터 레벨 -5', '+4']) assert.ok(d.includes(s), s);
});

test('제작 아이템: 4계열과 전용 완전 보석 매칭', () => {
  const d = eventByEn('Crafted Items').description;
  for (const [type, gem] of [['혈흔', '루비'], ['시전', '자수정'], ['타격', '사파이어'], ['안전', '에메랄드']]) {
    assert.match(d, new RegExp(`${type}[^\\n]*${gem}`), `${type}-${gem}`);
  }
  assert.match(d, /주얼/);
  assert.match(d, /매직/);
});

test('매직 파인드: 수확 체감 계수 250/500/600', () => {
  const d = eventByEn('Magic Find').description;
  for (const s of ['250', '500', '600']) assert.ok(d.includes(s), s);
});

test('플레이어 수 설정: /players 1~8 범위와 체력 증가', () => {
  const d = eventByEn('Players Setting').description;
  assert.match(d, /\/players/);
  for (const s of ['1', '8', '체력']) assert.ok(d.includes(s), s);
});

test('큐브 레시피 보강: 젖소 포탈, 참회의 징표 4종 에센스, 보석 업그레이드', () => {
  const d = byName('Horadric Cube Recipes').description;
  assert.match(d, /위르투의 다리/);
  assert.match(d, /참회의 징표/);
  for (const e of ['고통', '증오', '공포', '파괴']) assert.ok(d.includes(e), `에센스: ${e}`);
  assert.match(d, /완전하지 않은 보석 3개|같은 등급 보석 3개/);
});

// ── 세트 전체 34종 (오리지널 16 + 확장팩 16 + DLC 2, 사곤/시곤 등 누락분 보강) ──
// 구성 줄 형식: "• 한글명 (English) — 베이스 한글 (Base, 부위), 요구 레벨 N"
const sets = () => items.filter((i) => i.type === 'set');
const setByEn = (en) => sets().find((i) => i.name.includes(`(${en})`));
const pieceLines = (desc) => [...desc.matchAll(/^• .+? \(([^)]+)\) — .+? \(([A-Za-z' -]+), [^)]+\), 요구 레벨 (\d+)$/gm)]
  .map((m) => ({ name: m[1], base: m[2], level: Number(m[3]) }));

// 신규 25세트: 영문 세트명 → 구성 수
const NEW_SETS = {
  "Angelic Raiment": 4, "Arcanna's Tricks": 4, 'Arctic Gear': 4, "Berserker's Arsenal": 3,
  "Cathan's Traps": 5, "Civerb's Vestments": 3, "Cleglaw's Brace": 3, "Death's Disguise": 3,
  "Hsarus' Defense": 3, 'Infernal Tools': 3, "Iratha's Finery": 4, "Isenhart's Armory": 4,
  "Milabrega's Regalia": 4, "Sigon's Complete Steel": 6, "Tancred's Battlegear": 5, "Vidala's Rig": 4,
  "Bul-Kathos' Children": 2, "Cow King's Leathers": 3, "Heaven's Brethren": 4, "Hwanin's Majesty": 4,
  "Naj's Ancient Vestige": 3, "Orphan's Call": 4, "Sander's Folly": 4, "Sazabi's Grand Tribute": 3,
  'The Disciple': 5,
};

test('세트는 총 34개 (기존 9 + 신규 25)', () => {
  assert.equal(sets().length, 34);
});

test('신규 25세트 존재, 구성 줄 수 = meta.pieces = 원작 구성 수', () => {
  for (const [en, pieces] of Object.entries(NEW_SETS)) {
    const it = setByEn(en);
    assert.ok(it, `세트 없음: ${en}`);
    assert.equal(it.meta.pieces, pieces, en);
    assert.equal(pieceLines(it.description).length, pieces, `구성 줄 수: ${en}`);
    assert.ok(it.tags.includes('set') && it.tags.includes('세트'), `태그: ${en}`);
    assert.match(it.description, /풀세트:/, `풀세트 보너스 누락: ${en}`);
  }
});

test('신규 세트 pieces 는 2~6 정수, 요구 레벨은 1~99 정수 (0·100 불가)', () => {
  for (const en of Object.keys(NEW_SETS)) {
    const it = setByEn(en);
    assert.ok(Number.isInteger(it.meta.pieces) && it.meta.pieces >= 2 && it.meta.pieces <= 6, en);
    for (const p of pieceLines(it.description)) {
      assert.ok(Number.isInteger(p.level) && p.level >= 1 && p.level <= 99, `${en}: ${p.name}`);
    }
  }
});

test('세트 영문명 및 세트 아이템 영문명 전체 중복 없음', () => {
  const en = sets().map((s) => (s.name.match(/\(([^)]+)\)$/) || [])[1]);
  assert.ok(en.every(Boolean), '영문명 표기 누락');
  assert.equal(new Set(en).size, en.length);
  const pieces = Object.keys(NEW_SETS).flatMap((n) => pieceLines(setByEn(n).description).map((p) => p.name));
  assert.equal(new Set(pieces).size, pieces.length);
});

test("시곤의 강철: 6피스 구성·베이스·요구 레벨 6, '사곤'/'시곤' 검색 가능", () => {
  const it = setByEn("Sigon's Complete Steel");
  assert.ok(it.tags.includes('사곤') && it.tags.includes('시곤'));
  const expect = {
    "Sigon's Visor": 'Great Helm', "Sigon's Shelter": 'Gothic Plate', "Sigon's Guard": 'Tower Shield',
    "Sigon's Gage": 'Gauntlets', "Sigon's Sabot": 'Greaves', "Sigon's Wrap": 'Plated Belt',
  };
  const lines = pieceLines(it.description);
  assert.deepEqual(Object.fromEntries(lines.map((p) => [p.name, p.base])), expect);
  for (const p of lines) assert.equal(p.level, 6, p.name);
});

test('확장팩 고레벨 세트 대표 구성·요구 레벨 정확', () => {
  const lv = (en) => Object.fromEntries(pieceLines(setByEn(en).description).map((p) => [p.name, [p.base, p.level]]));
  assert.deepEqual(lv("Bul-Kathos' Children"), {
    "Bul-Kathos' Sacred Charge": ['Colossus Blade', 63], "Bul-Kathos' Tribal Guardian": ['Mythical Sword', 66],
  });
  assert.deepEqual(lv("Heaven's Brethren")["Taebaek's Glory"], ['Ward', 81]);
  assert.deepEqual(lv("Naj's Ancient Vestige")["Naj's Puzzler"], ['Elder Staff', 78]);
  assert.deepEqual(lv('The Disciple').Credendum, ['Mithril Coil', 65]);
  assert.deepEqual(lv("Orphan's Call")["Magnus' Skin"], ['Sharkskin Gloves', 37]);
  assert.deepEqual(lv("Cow King's Leathers")["Cow King's Hooves"], ['Heavy Boots', 13]);
});

test('기존 세트 9종은 신규 추가 후에도 유지', () => {
  for (const en of ["Tal Rasha's Wrappings", 'Immortal King', "Trang-Oul's Avatar", "Griswold's Legacy",
    "Aldur's Watchtower", "Natalya's Odium", "M'avina's Battle Hymn", "Bane's Garments", "Horazon's Splendor"]) {
    assert.ok(setByEn(en), en);
  }
});

// ── 기존 세트 7종 수치 정정 (출처: Arreat Summit) ──
// 원작 기준 구성: 영문 아이템명 → [베이스, 요구 레벨]
const LEGACY_SETS = {
  "Tal Rasha's Wrappings": {
    "Tal Rasha's Lidless Eye": ['Swirling Crystal', 65], "Tal Rasha's Horadric Crest": ['Death Mask', 66],
    "Tal Rasha's Guardianship": ['Lacquered Plate', 71], "Tal Rasha's Fine-Spun Cloth": ['Mesh Belt', 53],
    "Tal Rasha's Adjudication": ['Amulet', 67],
  },
  'Immortal King': {
    "Immortal King's Will": ['Avenger Guard', 47], "Immortal King's Stone Crusher": ['Ogre Maul', 76],
    "Immortal King's Soul Cage": ['Sacred Armor', 76], "Immortal King's Detail": ['War Belt', 29],
    "Immortal King's Forge": ['War Gauntlets', 30], "Immortal King's Pillar": ['War Boots', 31],
  },
  "Trang-Oul's Avatar": {
    "Trang-Oul's Guise": ['Bone Visage', 65], "Trang-Oul's Scales": ['Chaos Armor', 49],
    "Trang-Oul's Wing": ['Cantor Trophy', 54], "Trang-Oul's Girth": ['Troll Belt', 62],
    "Trang-Oul's Claws": ['Heavy Bracers', 45],
  },
  "Griswold's Legacy": {
    "Griswold's Heart": ['Ornate Plate', 45], "Griswold's Valor": ['Corona', 69],
    "Griswold's Redemption": ['Caduceus', 66], "Griswold's Honor": ['Vortex Shield', 68],
  },
  "Aldur's Watchtower": {
    "Aldur's Stony Gaze": ["Hunter's Guise", 36], "Aldur's Advance": ['Battle Boots', 45],
    "Aldur's Deception": ['Shadow Plate', 76], "Aldur's Rhythm": ['Jagged Star', 42],
  },
  "Natalya's Odium": {
    "Natalya's Totem": ['Grim Helm', 59], "Natalya's Mark": ['Scissors Suwayyah', 79],
    "Natalya's Shadow": ['Loricated Mail', 73], "Natalya's Soul": ['Mesh Boots', 25],
  },
  "M'avina's Battle Hymn": {
    "M'avina's True Sight": ['Diadem', 64], "M'avina's Caster": ['Grand Matron Bow', 70],
    "M'avina's Embrace": ['Kraken Shell', 70], "M'avina's Icy Clutch": ['Battle Gauntlets', 32],
    "M'avina's Tenet": ['Sharkskin Belt', 45],
  },
};
// 설명에서 "• 풀세트: ..." 줄만 추출
const fullBonus = (desc) => (desc.match(/^• 풀세트: (.+)$/m) || [])[1] || '';

test('기존 세트 7종: 구성 아이템·베이스·요구 레벨이 원작과 일치, pieces 일치', () => {
  for (const [en, expect] of Object.entries(LEGACY_SETS)) {
    const it = setByEn(en);
    assert.ok(it, `세트 없음: ${en}`);
    const got = Object.fromEntries(pieceLines(it.description).map((p) => [p.name, [p.base, p.level]]));
    assert.deepEqual(got, expect, en);
    assert.equal(it.meta.pieces, Object.keys(expect).length, en);
    assert.match(it.description, /출처: D2R 게임 데이터 테이블/, en);
  }
});

test("이모탈 킹 정식 세트명 'Immortal King' 사용, 오기 'Immortal King's Call' 제거", () => {
  assert.ok(!items.some((i) => i.name.includes("Immortal King's Call")));
  assert.ok(setByEn('Immortal King').tags.includes('ik'));
});

test('탈 라샤 풀세트: +3 소서리스 스킬·MF 65%·모든 저항 50, 오기 수치(매파 150%) 제거', () => {
  const d = setByEn("Tal Rasha's Wrappings").description;
  const full = fullBonus(d);
  for (const s of ['+3 소서리스 스킬', '매직 아이템 발견 +65%', '모든 저항 +50', '생명력 +150']) assert.ok(full.includes(s), s);
  assert.ok(!d.includes('매파 +150%'));
  assert.match(d, /Tal Rasha's Guardianship[^\n]*\n {2}[^\n]*매직 아이템 발견 \+88%/);
});

test('세트별 핵심 수치 정정 (IK 강타·트랑 뱀파이어·나탈야 피해 감소·그리스월드·알드르·마비나)', () => {
  assert.match(setByEn('Immortal King').description, /Stone Crusher[^\n]*\n {2}[^\n]*강타 확률 35-40%/);
  assert.ok(fullBonus(setByEn('Immortal King').description).includes('+3 야만용사 스킬'));
  assert.ok(fullBonus(setByEn("Trang-Oul's Avatar").description).includes('뱀파이어'));
  assert.ok(fullBonus(setByEn("Natalya's Odium").description).includes('받는 피해 감소 30%'));
  assert.ok(fullBonus(setByEn("Griswold's Legacy").description).includes('+3 팔라딘 스킬'));
  assert.ok(fullBonus(setByEn("Aldur's Watchtower").description).includes('+3 드루이드 스킬'));
  assert.ok(fullBonus(setByEn("M'avina's Battle Hymn").description).includes('매직 아이템 발견 +100%'));
});

test('부분 세트 보너스(2세트 등) 표기, 한글명 오역 정정 및 옛 이름 검색 호환', () => {
  for (const en of ["Tal Rasha's Wrappings", 'Immortal King', "Trang-Oul's Avatar", "Griswold's Legacy",
    "Aldur's Watchtower", "Natalya's Odium", "M'avina's Battle Hymn"]) {
    assert.match(setByEn(en).description, /^• 2세트: /m, en);
  }
  const aldur = setByEn("Aldur's Watchtower");
  assert.match(aldur.name, /^알드르의 감시탑 /);
  assert.ok(aldur.tags.includes('결의'));
  const nat = setByEn("Natalya's Odium");
  assert.match(nat.name, /^나탈야의 증오 /);
  assert.ok(nat.tags.includes('쟁취'));
});

// ── 신규 세트 25종 수치 정정 (v15 기억 기반 수치 → Arreat Summit 원문) ──
const pieceBlock = (en, piece) => {
  const d = setByEn(en).description;
  const m = d.match(new RegExp(`^• [^\n]*\\(${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)[^\n]*\n((?: {2}[^\n]*\n?)*)`, 'm'));
  return m ? m[1] : '';
};

test('신규 25세트 모두 출처 명시 및 부분/풀세트 보너스 형식', () => {
  for (const en of Object.keys(NEW_SETS)) {
    const d = setByEn(en).description;
    assert.match(d, /출처: D2R 게임 데이터 테이블/, en);
    assert.ok(!d.includes('세부 옵션 수치는 게임 내 확인 필요'), `미검증 문구 잔존: ${en}`);
  }
});

test("사도 세트 갑옷은 'Dark Adherent'(더스크 쉬라우드, 요구 레벨 49), 없는 이름 제거", () => {
  const lines = pieceLines(setByEn('The Disciple').description);
  const armor = lines.find((p) => p.base === 'Dusk Shroud');
  assert.deepEqual([armor.name, armor.level], ['Dark Adherent', 49]);
  assert.ok(!items.some((i) => i.description.includes('Spiritual Custodian')));
});

test('샌더·사자비·카우 킹·시곤 풀세트 및 아이템 수치 정정', () => {
  const sander = fullBonus(setByEn("Sander's Folly").description);
  for (const x of ['+1 모든 스킬', '생명력 흡수 4%', '매직 아이템 발견 +50%', '마나 +50']) assert.ok(sander.includes(x), x);
  assert.match(pieceBlock("Sazabi's Grand Tribute", "Sazabi's Cobalt Redeemer"), /공격 속도 \+40%/);
  assert.ok(fullBonus(setByEn("Sazabi's Grand Tribute").description).includes('최대 생명력 +27%'));
  const cow = fullBonus(setByEn("Cow King's Leathers").description);
  for (const x of ['매직 아이템 발견 +100%', '골드 획득 +100%', '공격 속도 +30%']) assert.ok(cow.includes(x), x);
  const sigon = fullBonus(setByEn("Sigon's Complete Steel").description);
  for (const x of ['생명력 흡수 10%', '방어력 +100', '피해 감소 7']) assert.ok(sigon.includes(x), x);
  assert.match(pieceBlock("Sigon's Complete Steel", "Sigon's Guard"), /\+1 모든 스킬/);
});

test('경계: 부분 세트 효과 개수는 구성 수 미만 (2세트 ~ N-1세트)', () => {
  for (const en of Object.keys(NEW_SETS)) {
    const d = setByEn(en).description;
    for (const m of d.matchAll(/^• (\d)세트: /gm)) {
      const n = Number(m[1]);
      assert.ok(n >= 2 && n < NEW_SETS[en], `${en}: ${n}세트`);
    }
  }
});

test('천사의 예복: 패치 3.3 변경 안내 유지', () => {
  assert.match(setByEn('Angelic Raiment').description, /패치 3\.3/);
});

// ── 유니크 전체 (D2R 게임 데이터 패치 3.3 기준, 공식 한글명) ──
const uniques = () => items.filter((i) => i.type === 'unique');
const uniqueByEn = (en) => uniques().find((i) => i.name.endsWith(`(${en})`));
const GAMEDATA_NOTE = 'D2R 게임 데이터 테이블 (패치 3.3';
const optLines = (desc) => desc.split('\n').filter((l) => l.startsWith('• '));
// 항목 부재 시 TypeError 대신 명확한 단언 실패가 나도록 설명을 꺼내는 헬퍼
const uDesc = (en) => {
  const u = uniqueByEn(en);
  assert.ok(u, `유니크 없음: ${en}`);
  return u.description;
};

test('유니크: 게임 데이터 기반 384종 + DLC 3.0 기존 항목 유지', () => {
  assert.equal(uniques().filter((u) => u.description.includes(GAMEDATA_NOTE)).length, 384);
  for (const en of ['Dreadfang', 'Wraithstep', 'Bloodpact Shard', 'Opalvein', 'Entropy Locket', "Gheed's Wager"]) {
    assert.ok(uniqueByEn(en), `DLC 유니크 유실: ${en}`);
  }
});

test('유니크: 영문명 중복 없음, 게임 데이터 항목은 meta.level 1~99 정수·meta.base 보유', () => {
  const en = uniques().map((u) => (u.name.match(/\(([^()]*)\)$/) || [])[1]);
  assert.ok(en.every(Boolean));
  assert.equal(new Set(en).size, en.length, '유니크 영문명 중복');
  for (const u of uniques().filter((x) => x.description.includes(GAMEDATA_NOTE))) {
    assert.ok(Number.isInteger(u.meta.level) && u.meta.level >= 1 && u.meta.level <= 99, u.name);
    assert.equal(typeof u.meta.base, 'string');
    assert.ok(optLines(u.description).length >= 1, `옵션 없음: ${u.name}`);
  }
});

test('유니크: 렌더링 오류 문자열 없음 (None, 음수 범위 --, 빈 괄호)', () => {
  for (const u of uniques()) {
    assert.ok(!/None|--|\(\)/.test(u.description), u.name);
  }
});

test('대표 유니크 수치·공식 한글명: 샤코, 소조, 애니, 토치, 블랙텅', () => {
  const shako = uniqueByEn('Harlequin Crest');
  assert.ok(shako, '샤코 없음');
  assert.match(shako.name, /^할리퀸 크레스트 /);
  assert.equal(shako.meta.base, 'Shako');
  assert.equal(shako.meta.level, 62);
  for (const o of ['+2 모든 스킬', '매직 아이템 발견 +50%', '받는 피해 감소 10%', '모든 능력치 +2']) assert.ok(shako.description.includes(o), o);
  assert.ok(shako.tags.includes('shako') && shako.tags.includes('샤코'), '기존 검색 태그 보존');
  const soj = uDesc('The Stone of Jordan');
  assert.ok(soj.includes('번개 피해 +1-12') && soj.includes('최대 마나 +25%'));
  assert.ok(uDesc('Annihilus').includes('경험치 획득 +5-10%'));
  assert.ok(uDesc('Hellfire Torch').includes('+3 무작위 클래스 스킬'));
  assert.ok(uDesc('Blacktongue').includes('독 피해 +113 (6초)'));
});

test('스킬 트리·오라·충전 옵션 렌더링: 아리앗의 페이스, 울프하울, 에이져래쓰', () => {
  assert.ok(uDesc("Arreat's Face").includes('+2 전투 스킬 (야만용사 전용)'));
  assert.ok(uDesc('Wolfhowl').includes('+2-3 함성 (야만용사 전용)'));
  assert.ok(uDesc('Azurewrath').includes('장착 시 레벨 10-13 생츄어리(Sanctuary) 오라'));
});

test('선더 참 6종·레인보우 패시트 8변형·패치 3.3 로그스 보우', () => {
  for (const en of ['Cold Rupture', 'Flame Rift', 'Crack of the Heavens', 'Rotting Fissure', 'Bone Break', 'Black Cleft']) {
    const u = uniqueByEn(en);
    assert.ok(u, en);
    assert.match(u.description, /면역 파괴/, en);
    assert.ok(u.tags.includes('선더참'), en);
  }
  assert.match(uDesc('Cold Rupture'), /냉기 저항 -70~-90%/);
  assert.equal((uDesc('Rainbow Facet').match(/^• 변형 \d/gm) || []).length, 8);
  assert.match(uDesc("Rogue's Bow"), /콜드 애로우 또는 파이어 애로우/);
});

test('유니크 기존 오기 이름 제거 (소환의 재·톱니 이빨 등)', () => {
  for (const bad of ['소환의 재', '톱니 이빨', 'Stone of Jordan / SoJ', 'Harlequin Crest / Shako', '독 독사의 묵주']) {
    assert.ok(!uniques().some((u) => u.name.includes(bad)), bad);
  }
});

// ── 누락 룬워드 35종 (D2R 게임 데이터 기준) ──
const runewords = () => items.filter((i) => i.type === 'runeword');
const rwByEn = (en) => {
  const it = runewords().find((i) => i.name.endsWith(`(${en})`));
  assert.ok(it, `룬워드 없음: ${en}`);
  return it;
};

test('룬워드: 기존 63 + 신규 35 = 98종, 게임 데이터 항목 35종', () => {
  assert.equal(runewords().length, 98);
  assert.equal(runewords().filter((r) => r.description.includes(GAMEDATA_NOTE)).length, 35);
  assert.ok(rwByEn('Enigma') && rwByEn('Infinity'), '기존 룬워드 유지');
});

test('룬워드: 소켓 수 = 룬 개수 (2룬 강철~5룬 불멸 경계), 레벨 = 최고 룬 요구 레벨', () => {
  for (const r of runewords().filter((x) => x.description.includes(GAMEDATA_NOTE))) {
    const sockets = Number((r.meta.base.match(/^(\d)소켓/) || [])[1]);
    assert.equal(sockets, r.meta.runes.length, r.name);
    assert.ok(Number.isInteger(r.meta.level) && r.meta.level >= 1 && r.meta.level <= 99, r.name);
  }
  assert.deepEqual(rwByEn('Steel').meta.runes, ['Tir', 'El']);
  assert.equal(rwByEn('Eternity').meta.runes.length, 5);
  assert.equal(rwByEn('Eternity').meta.level, 63);
  assert.equal(rwByEn('Pride').meta.level, 67);
});

test('룬워드 영문명 중복 없음', () => {
  const en = runewords().map((r) => (r.name.match(/\(([^()]*)\)$/) || [])[1]).filter(Boolean);
  assert.equal(new Set(en).size, en.length);
});

test('신규 룬워드 대표 수치: 자존심·불멸·야수·웰쓰·드레곤', () => {
  assert.match(rwByEn('Pride').description, /장착 시 레벨 16-20 컨센트레이션\(Concentration\) 오라/);
  const eternity = rwByEn('Eternity').description;
  assert.match(eternity, /레벨 8 리바이브\(Revive\) \(88회 충전\)/);
  assert.match(eternity, /룬 옵션 \(무기 장착 시 추가\):[^\n]*생명력 흡수 7%/);
  assert.match(rwByEn('Beast').description, /장착 시 레벨 9 파나티시즘\(Fanaticism\) 오라/);
  const wealth = rwByEn('Wealth').description;
  assert.ok(wealth.includes('골드 획득 +250%') && wealth.includes('매직 아이템 발견 +100%'));
  assert.match(rwByEn('Dragon').description, /원래 래더 전용/);
  assert.match(rwByEn('Dragon').description, /룬 옵션 \(방패 장착 시 추가\)/);
});

// ── D2R 패치 이력 (출시 1.0 ~ 3.3) ──
const PATCHES = [['1.0', '2021-09-23'], ['2.3', '2021-12-02'], ['2.4', '2022-04-14'], ['2.5', '2022-09-22'],
  ['2.6', '2023-02-15'], ['2.7', '2023-05-02'], ['2.8', '2024-12-03'], ['3.0', '2026-02-11'], ['3.2', '2026-05-22'],
  ['3.3', '2026-08-18']];
const patchEvent = (v) => {
  const it = events().find((e) => e.meta && e.meta.type === '패치' && e.meta.patch === v);
  assert.ok(it, `패치 항목 없음: ${v}`);
  return it;
};

test('패치 이력: 1.0~3.3 각 패치 항목 존재, 날짜 명시, 패치 버전 중복 없음', () => {
  for (const [v, date] of PATCHES) assert.ok(patchEvent(v).description.includes(date), `${v}: ${date}`);
  const vs = events().filter((e) => e.meta && e.meta.type === '패치').map((e) => e.meta.patch);
  assert.equal(new Set(vs).size, vs.length);
});

test('패치 이력: 버전 순서와 날짜 순서 일치 (경계: 출시일 최초, 3.3 최신)', () => {
  const firstDate = (v) => patchEvent(v).description.match(/\d{4}-\d{2}-\d{2}/)[0];
  const dates = PATCHES.map(([v]) => firstDate(v));
  assert.deepEqual(dates, [...dates].sort());
});

test('2.4·2.6·3.0 신규 룬워드 목록, 3.0 악마술사', () => {
  const d24 = patchEvent('2.4').description;
  for (const rw of ['Flickering Flame', 'Mist', 'Obsession', 'Pattern', 'Plague', 'Unbending Will', 'Wisdom']) assert.ok(d24.includes(rw), rw);
  const d26 = patchEvent('2.6').description;
  for (const rw of ['Bulwark', 'Cure', 'Ground', 'Hearth', 'Temper', 'Hustle', 'Mosaic', 'Metamorphosis']) assert.ok(d26.includes(rw), rw);
  const d30 = patchEvent('3.0').description;
  for (const x of ['악마술사', 'Authority', 'Coven', 'Void', 'Vigilance', 'Ritual']) assert.ok(d30.includes(x), x);
});

test('선더 참 이벤트: 실제 6종 이름, 존재하지 않는 5종 목록 제거', () => {
  const d = byName('(Sunder Charms)').description;
  for (const en of ['Cold Rupture', 'Flame Rift', 'Crack of the Heavens', 'Rotting Fissure', 'Bone Break', 'Black Cleft']) {
    assert.ok(d.includes(en), en);
    assert.ok(uniqueByEn(en), `유니크 항목과 연결: ${en}`);
  }
  assert.ok(!d.includes('종류 (5가지)'));
});

// ── 유니크 요구 레벨 = max(아이템 요구 레벨, 베이스 요구 레벨), 베이스는 게임 표시명 ──
test('유니크 요구 레벨이 베이스 요구 레벨보다 낮지 않음 (경계: 64→65, 62→66, 60→66)', () => {
  const lv = (en) => { uDesc(en); return uniqueByEn(en).meta.level; };
  assert.equal(lv('Darkforce Spawn'), 65);
  assert.equal(lv('Ghostflame'), 66);
  assert.equal(lv("Astreon's Iron Ward"), 66);
  assert.match(uDesc("Astreon's Iron Ward"), /^요구 레벨: 66$/m);
});

test('유니크 베이스명은 게임 내부 오탈자 대신 표시명 사용', () => {
  const internal = ['Griffon Headress', 'Heirophant Trophy', 'Ornate Armor', 'Mithral Point', 'Colossal Sword',
    'Long Siege Bow', 'Stilleto', 'Kriss', 'Saber'];
  for (const u of uniques()) assert.ok(!internal.includes(u.meta.base), `${u.name}: ${u.meta.base}`);
  assert.equal(uniqueByEn('Skewer of Krintiz').meta.base, 'Sabre');
});

// ── 세트 32종 D2R 게임 데이터 반영 (패치 2.4 세트 상향·2.7 불카토스 변경 등) ──
test('D2R 세트 변경분: 알드르 4세트 흡혈, 나탈야 독 저항, 불카토스 밀쳐내기 제거', () => {
  const aldur = setByEn("Aldur's Watchtower").description;
  assert.match(aldur, /^• 3세트: /m);
  assert.ok(!/^• 4세트: /m.test(aldur), '4피스 세트의 4세트 줄은 풀세트와 중복이라 생략');
  assert.ok(fullBonus(aldur).includes('생명력 흡수 10%'));
  assert.ok(fullBonus(setByEn("Natalya's Odium").description).includes('독 저항 +20%'));
  assert.ok(!setByEn("Bul-Kathos' Children").description.includes('밀쳐내기'));
});

test('풀세트 보너스는 부분 보너스 누적 합산 (IK 명중률 450, 트랑 마나 재생 60%)', () => {
  const ik = fullBonus(setByEn('Immortal King').description);
  assert.ok(ik.includes('명중률 +450'), ik);
  assert.ok(!ik.includes('명중률 +50,'), '합산 전 개별 값 잔존');
  assert.ok(fullBonus(setByEn("Trang-Oul's Avatar").description).includes('마나 재생 +60%'));
});

test('세트 공식 한글명 검색 태그 (사이곤 컴플릿스틸·임모틀 킹)', () => {
  assert.ok(setByEn("Sigon's Complete Steel").tags.includes('사이곤컴플릿스틸'));
  assert.ok(setByEn('Immortal King').tags.includes('임모틀킹'));
});

// ── 지역·용병 보강 (지역 레벨·용병 스킬: D2R 게임 데이터) ──
const areas = () => items.filter((i) => i.type === 'area');
const areaByEn = (en) => {
  const it = areas().find((a) => a.name.includes(`(${en})`));
  assert.ok(it, `지역 없음: ${en}`);
  return it;
};
const mercByAct = (act) => {
  const it = items.find((i) => i.type === 'merc' && i.meta.act === act);
  assert.ok(it, `용병 없음: 액트 ${act}`);
  return it.description;
};

test('기존 지역 헬 레벨 정정: 카운테스 79·트라빈컬 82·니흘라탁 84·안다리엘 73', () => {
  assert.equal(areaByEn('The Countess Tower').meta.level, 79);
  assert.equal(areaByEn('Travincal').meta.level, 82);
  assert.equal(areaByEn("Nihlathak's Temple").meta.level, 84);
  assert.equal(areaByEn('Catacombs Lv4').meta.level, 73);
  for (const a of areas()) assert.ok(!a.description.includes('D2R에서 레벨 85로 상향') && !a.description.includes('D2R에서 85로 상향'), a.name);
  assert.ok(!areaByEn('Secret Cow Level').description.includes('재입장 가능'));
});

const NEW_AREAS = {
  Mausoleum: [1, 85], 'Underground Passage Level 2': [1, 85], 'Maggot Lair Level 3': [2, 85], 'Arcane Sanctuary': [2, 79],
  'Swampy Pit': [3, 85], 'Kurast Sewers': [3, 85], 'Kurast Temples': [3, 85], 'Lower Kurast': [3, 80],
  'Plains of Despair': [4, 83], 'City of the Damned': [4, 84], 'River of Flame': [4, 85], 'Drifter Cavern': [5, 85],
  'Icy Cellar': [5, 85], 'Red Portal Areas': [5, 85], 'Arreat Summit': [5, 87],
};

test('신규 파밍 지역 15곳: 액트·헬 지역 레벨이 게임 데이터와 일치', () => {
  for (const [en, [act, lvl]] of Object.entries(NEW_AREAS)) {
    const a = areaByEn(en);
    assert.equal(a.meta.act, act, en);
    assert.equal(a.meta.level, lvl, en);
    assert.match(a.description, new RegExp(`헬 ${lvl}`), en);
  }
  assert.equal(areas().length, 12 + 15);
});

test('지역 경계: 모든 지역 meta.level 1~99 정수, 레벨85 태그는 헬 85 지역에만', () => {
  for (const a of areas()) {
    assert.ok(Number.isInteger(a.meta.level) && a.meta.level >= 1 && a.meta.level <= 99, a.name);
    if (a.tags.includes('레벨85')) assert.equal(a.meta.level, 85, a.name);
  }
});

test('용병: 2막 나이트메어·헬 오라 6종, 노말 3종 / 5막 이도류형 / 3막 원소별 스킬', () => {
  const a2 = mercByAct(2);
  for (const aura of ['Prayer', 'Defiance', 'Blessed Aim', 'Thorns', 'Holy Freeze', 'Might']) assert.ok(a2.includes(aura), aura);
  assert.match(a2, /노말:[^\n]*Prayer[^\n]*Defiance[^\n]*Blessed Aim/);
  assert.ok(!/노말:[^\n]*(Might|Holy Freeze|Thorns)/.test(a2), '노말에는 3종만');
  const a5 = mercByAct(5);
  for (const sk of ['Frenzy', 'Bash', 'Battle Cry']) assert.ok(a5.includes(sk), sk);
  const a3 = mercByAct(3);
  for (const sk of ['Fire Ball', 'Glacial Spike', 'Static Field']) assert.ok(a3.includes(sk), sk);
});

// ── 룬 33종: 공식 한글명·옵션·요구 레벨 (D2R 게임 데이터) ──
const runeItems = () => items.filter((i) => i.type === 'rune');
const runeByEn = (en) => {
  const it = runeItems().find((r) => r.name.endsWith(`(${en})`));
  assert.ok(it, `룬 없음: ${en}`);
  return it;
};

test('룬 공식 한글명 정정 (아이드·샤에·아이스트·조·차암) 및 옛 이름 검색 태그', () => {
  const expect = { Ith: ['아이드 룬', '이르'], Shael: ['샤에 룬', '샤엘'], Ist: ['아이스트 룬', '이스트'], Jah: ['조 룬', '자'], Cham: ['차암 룬', '참'] };
  for (const [en, [ko, old]] of Object.entries(expect)) {
    const r = runeByEn(en);
    assert.ok(r.name.startsWith(`${ko} (`), `${en}: ${r.name}`);
    assert.ok(r.tags.includes(old), `옛 이름 태그 누락: ${old}`);
  }
});

test('룬 옵션·요구 레벨 게임 데이터 일치 (엘·로·베르·조드)', () => {
  const el = runeByEn('El').description;
  assert.match(el, /^요구 레벨: 11$/m);
  assert.ok(el.includes('명중률 +50') && el.includes('빛 반경 +1'));
  assert.match(runeByEn('Lo').description, /최대 번개 저항 \+5%/);
  const ber = runeByEn('Ber').description;
  assert.match(ber, /무기: [^\n]*강타 확률 20%/);
  assert.match(ber, /받는 피해 감소 8%/);
  assert.match(runeByEn('Zod').description, /^요구 레벨: 69$/m);
  assert.match(runeByEn('Zod').description, /파괴 불가/);
});

test('룬 경계: 33종, rank 1~33 중복 없음, 요구 레벨은 rank 순 비내림차순 (헬 룬은 요구 레벨 없음)', () => {
  const rs = runeItems().slice().sort((a, b) => a.meta.rank - b.meta.rank);
  assert.equal(rs.length, 33);
  assert.deepEqual(rs.map((r) => r.meta.rank), Array.from({ length: 33 }, (_, i) => i + 1));
  assert.match(runeByEn('Hel').description, /^요구 레벨: 없음$/m);
  const lv = rs.filter((r) => !r.name.endsWith('(Hel)')).map((r) => {
    const m = r.description.match(/^요구 레벨: (\d+)$/m);
    assert.ok(m, `요구 레벨 표기 없음: ${r.name}`);
    return Number(m[1]);
  });
  assert.equal(lv[0], 11);
  assert.equal(lv[lv.length - 1], 69);
  assert.deepEqual(lv, [...lv].sort((a, b) => a - b));
});
