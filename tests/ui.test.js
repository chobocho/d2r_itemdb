// 첫 화면 타일·카드 요약·무한 스크롤·스크롤 위치 기억 로직 검증
// 실행: node --test tests/ui.test.js
// DOM 없이 검증 가능하도록 app.js 의 순수 함수(D2UI)만 대상으로 한다 — 실제 스크롤은 브라우저 확인 필요
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { D2UI } = require(path.join(root, 'app.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 함수 부재를 로드 오류가 아닌 단언 실패로 드러내기 위한 헬퍼
function fn(name) {
  assert.equal(typeof D2UI[name], 'function', `D2UI.${name} 함수가 있어야 함`);
  return D2UI[name];
}

// localStorage 흉내 — 용량 초과·접근 차단 상황도 재현
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}
const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); }
};

// ── 첫 화면 판정 ──
test('isHomeView: 전체 탭 + 빈 검색어일 때만 첫 화면', () => {
  const isHomeView = fn('isHomeView');
  assert.equal(isHomeView('all', ''), true);
  assert.equal(isHomeView('all', '   '), true);
  assert.equal(isHomeView('all', null), true);
  assert.equal(isHomeView('all', undefined), true);
  assert.equal(isHomeView('all', '베르'), false);
  assert.equal(isHomeView('unique', ''), false);
});

// ── 페이지 나누기 ──
test('PAGE_SIZE 는 30', () => {
  assert.equal(D2UI.PAGE_SIZE, 30);
});

test('nextPageEnd: 경계값 0·1·30·31·651', () => {
  const nextPageEnd = fn('nextPageEnd');
  assert.equal(nextPageEnd(0, 0, 30), 0);
  assert.equal(nextPageEnd(0, 1, 30), 1);
  assert.equal(nextPageEnd(0, 30, 30), 30);
  assert.equal(nextPageEnd(0, 31, 30), 30);
  assert.equal(nextPageEnd(30, 31, 30), 31);
  assert.equal(nextPageEnd(31, 31, 30), 31);
  assert.equal(nextPageEnd(630, 651, 30), 651);
});

test('nextPageEnd: 음수·NaN·총합 초과 입력은 안전하게 보정', () => {
  const nextPageEnd = fn('nextPageEnd');
  assert.equal(nextPageEnd(-5, 100, 30), 30);
  assert.equal(nextPageEnd(NaN, 100, 30), 30);
  assert.equal(nextPageEnd(900, 100, 30), 100);
  assert.equal(nextPageEnd(0, -1, 30), 0);
  assert.equal(nextPageEnd(0, 100, 0), 30, '페이지 크기 0 이하면 기본값 사용');
});

test('restoreCount: 저장 개수를 [PAGE_SIZE, total] 로 제한', () => {
  const restoreCount = fn('restoreCount');
  assert.equal(restoreCount(120, 651, 30), 120);
  assert.equal(restoreCount(120, 50, 30), 50, '결과가 줄었으면 결과 수까지만');
  assert.equal(restoreCount(0, 651, 30), 30, '최소 첫 페이지');
  assert.equal(restoreCount(undefined, 651, 30), 30);
  assert.equal(restoreCount(-3, 651, 30), 30);
  assert.equal(restoreCount(120, 0, 30), 0);
  assert.equal(restoreCount(10, 20, 30), 20);
});

// ── 카드 요약·펼치기 ──
test('itemKey: DB 재적재로 바뀌는 id 대신 type+name 으로 식별', () => {
  const itemKey = fn('itemKey');
  assert.equal(itemKey({ id: 7, type: 'rune', name: '엘 룬 (El)' }), 'rune:엘 룬 (El)');
  assert.equal(itemKey({ id: 999, type: 'rune', name: '엘 룬 (El)' }), 'rune:엘 룬 (El)');
  assert.notEqual(itemKey({ type: 'set', name: 'A' }), itemKey({ type: 'unique', name: 'A' }));
  assert.equal(itemKey(null), '');
});

test('isCollapsible: 3줄 초과 또는 긴 설명만 접기 대상', () => {
  const isCollapsible = fn('isCollapsible');
  assert.equal(isCollapsible('한 줄'), false);
  assert.equal(isCollapsible('1\n2\n3'), false);
  assert.equal(isCollapsible('1\n2\n3\n4'), true);
  assert.equal(isCollapsible('가'.repeat(120)), false);
  assert.equal(isCollapsible('가'.repeat(121)), true);
  assert.equal(isCollapsible(''), false);
  assert.equal(isCollapsible(null), false);
});

test('shouldAutoExpand: 검색어가 이름·태그에 없고 설명에만 있으면 자동 펼침', () => {
  const shouldAutoExpand = fn('shouldAutoExpand');
  const item = { type: 'unique', name: '해골 투구', description: '1줄\n2줄\n3줄\n4줄 화염 저항 +30%', tags: ['투구'] };
  assert.equal(shouldAutoExpand(item, '화염'), true);
  assert.equal(shouldAutoExpand(item, '해골'), false, '이름에 있으면 요약으로 충분');
  assert.equal(shouldAutoExpand(item, '투구'), false, '태그에 있으면 요약으로 충분');
  assert.equal(shouldAutoExpand(item, '해골 화염'), true, '여러 키워드 중 하나라도 설명에만 있으면 펼침');
  assert.equal(shouldAutoExpand(item, 'ZZZ 없음'), false);
  assert.equal(shouldAutoExpand(item, ''), false);
  assert.equal(shouldAutoExpand(item, '   '), false);
  assert.equal(shouldAutoExpand({ type: 'rune', name: 'x', description: '짧은 화염' , tags: [] }, '화염'), false,
    '접기 대상이 아니면 펼칠 필요 없음');
  assert.equal(shouldAutoExpand({ type: 'rune', name: 'x', description: '1\n2\n3\n4 (화염)' }, '(화염)'), true,
    '정규식 특수문자·태그 없음도 안전');
});

// ── 스크롤 위치 ──
test('viewKey: 탭·정규화된 검색어·정렬 조합', () => {
  const viewKey = fn('viewKey');
  assert.equal(viewKey('unique', '', false), 'unique||default');
  assert.equal(viewKey('unique', '  베르   룬 ', true), 'unique|베르 룬|name');
  assert.equal(viewKey('all', 'ABC', false), viewKey('all', 'abc', false));
  assert.equal(viewKey('all', null, false), 'all||default');
});

test('pickAnchor: 고정 영역 아래 처음 보이는 카드와 어긋남 계산', () => {
  const pickAnchor = fn('pickAnchor');
  const cards = [
    { key: 'a', top: -300, bottom: -20 },
    { key: 'b', top: -10, bottom: 200 },
    { key: 'c', top: 210, bottom: 400 }
  ];
  // 고정 검색 바 높이 100px — b 의 하단(200)이 100 보다 아래이므로 b 가 기준
  assert.deepEqual(pickAnchor(cards, 100), { key: 'b', offset: -110 });
  assert.deepEqual(pickAnchor(cards, 0), { key: 'b', offset: -10 });
  assert.deepEqual(pickAnchor(cards, 250), { key: 'c', offset: -40 });
  assert.equal(pickAnchor([], 100), null);
  assert.equal(pickAnchor(null, 100), null);
  assert.equal(pickAnchor([{ key: 'a', top: -500, bottom: -400 }], 0), null, '모두 화면 위로 지나감');
});

test('anchorScrollTop: 폭이 바뀌어도 기준 카드 기준으로 스크롤 값 계산', () => {
  const anchorScrollTop = fn('anchorScrollTop');
  // 카드 문서 좌표 1500, 고정 영역 100, 저장된 어긋남 -110 → 1500 - 100 + 110
  assert.equal(anchorScrollTop(1500, 100, -110), 1510);
  assert.equal(anchorScrollTop(50, 100, 0), 0, '음수 스크롤은 0');
  assert.equal(anchorScrollTop(1500, 100, NaN), 1400, '손상된 어긋남은 0 취급');
});

test('createScrollStore: 저장 후 복원 (브라우저 재시작 = 같은 저장소 재생성)', () => {
  const createScrollStore = fn('createScrollStore');
  const storage = memoryStorage();
  createScrollStore(storage).save('unique||default', { count: 120, anchor: 'unique:해골 투구', offset: -40, expanded: ['unique:a'] });
  const reopened = createScrollStore(storage);
  assert.deepEqual(reopened.load('unique||default'),
    { count: 120, anchor: 'unique:해골 투구', offset: -40, expanded: ['unique:a'] });
  assert.equal(reopened.load('rune||default'), null);
});

test('createScrollStore: 마지막 화면(탭·검색어·정렬) 저장·복원', () => {
  const createScrollStore = fn('createScrollStore');
  const storage = memoryStorage();
  assert.equal(createScrollStore(storage).loadLastView(), null);
  createScrollStore(storage).saveLastView({ category: 'set', keyword: '탈 라샤', sortByName: true });
  assert.deepEqual(createScrollStore(storage).loadLastView(), { category: 'set', keyword: '탈 라샤', sortByName: true });
});

test('createScrollStore: 최근 20개 화면만 보관 (가장 오래 안 쓴 것부터 제거)', () => {
  const createScrollStore = fn('createScrollStore');
  const storage = memoryStorage();
  const store = createScrollStore(storage);
  for (let i = 0; i < 21; i++) store.save('k' + i, { count: 30, anchor: null, offset: 0, expanded: [] });
  assert.equal(store.load('k0'), null, '21번째 저장 시 가장 오래된 항목 제거');
  assert.ok(store.load('k20'));
  // k1 을 다시 저장하면 최근으로 갱신되어 다음 제거 대상은 k2
  store.save('k1', { count: 60, anchor: null, offset: 0, expanded: [] });
  store.save('k21', { count: 30, anchor: null, offset: 0, expanded: [] });
  assert.ok(store.load('k1'));
  assert.equal(store.load('k2'), null);
});

test('createScrollStore: 손상된 JSON·잘못된 필드는 무시하거나 보정', () => {
  const createScrollStore = fn('createScrollStore');
  const storage = memoryStorage();
  storage.setItem('d2r_scroll_state', '{깨진 json');
  storage.setItem('d2r_last_view', '[1,2');
  const store = createScrollStore(storage);
  assert.equal(store.load('unique||default'), null);
  assert.equal(store.loadLastView(), null);

  storage.setItem('d2r_scroll_state', JSON.stringify({
    order: ['x'],
    views: { x: { count: 'abc', anchor: 5, offset: 'z', expanded: 'nope' } }
  }));
  assert.deepEqual(createScrollStore(storage).load('x'), { count: 0, anchor: null, offset: 0, expanded: [] });

  storage.setItem('d2r_last_view', JSON.stringify({ category: 123, keyword: null, sortByName: 'yes' }));
  assert.deepEqual(createScrollStore(storage).loadLastView(), { category: 'all', keyword: '', sortByName: false });
});

test('createScrollStore: 저장소 접근 차단·용량 초과·저장소 없음에도 예외 없음', () => {
  const createScrollStore = fn('createScrollStore');
  for (const s of [throwingStorage, null, undefined]) {
    const store = createScrollStore(s);
    assert.doesNotThrow(() => store.save('k', { count: 30, anchor: null, offset: 0, expanded: [] }));
    assert.doesNotThrow(() => store.saveLastView({ category: 'all', keyword: '', sortByName: false }));
    // 영구 저장이 막혀도 같은 세션 안의 탭 전환 복원은 메모리로 동작해야 함
    assert.deepEqual(store.load('k'), { count: 30, anchor: null, offset: 0, expanded: [] });
  }
});

// ── 마크업·반응형 (갤럭시 폴드 펼침 포함) ──
test('index.html: 첫 화면 타일·무한 스크롤 감시 요소 존재, 통계 바 제거', () => {
  assert.ok(html.includes('id="homeView"'), '카테고리 타일 영역');
  assert.ok(html.includes('id="loadMore"'), '무한 스크롤 감시 겸 더 보기 버튼');
  assert.ok(!html.includes('id="statsBar"'), '통계는 타일로 통합');
});

test('index.html: 폴드 대응 뷰포트·safe-area·반응형 구간', () => {
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.ok(html.includes('env(safe-area-inset-'), 'safe-area 여백');
  assert.match(html, /@media \(min-width: 600px\)/, '폴드 펼침(약 880px) 구간 시작');
  assert.match(html, /@media \(min-width: 1024px\)/, '데스크톱 3열');
  assert.ok(!/@media \(min-width: 640px\)/.test(html), '기존 640px 구간은 대체됨');
});

test('index.html: 인코딩 — BOM·U+FFFD 없음, 한국어 보존', () => {
  assert.notEqual(html.charCodeAt(0), 0xfeff);
  assert.ok(!html.includes('�'));
  assert.ok(html.includes('데이터 추가'));
});
