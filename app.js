/**
 * D2R Item Database v2.0 - Vanilla JavaScript
 */

// ========== IndexedDB Manager ==========
var D2Database = (function () {
    function D2Database() {
        this.dbName = 'D2R_DB_V3';
        this.dbVersion = 1;
        this.db = null;
    }

    D2Database.prototype.connect = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(self.dbName, self.dbVersion);
            request.onerror = function () { reject(request.error); };
            request.onsuccess = function () {
                self.db = request.result;
                resolve();
            };
            request.onupgradeneeded = function (event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains('items')) {
                    var store = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('isCustom', 'isCustom', { unique: false });
                }
            };
        });
    };

    D2Database.prototype.addItem = function (item) {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.db) return reject('DB not initialized');
            var tx = self.db.transaction(['items'], 'readwrite');
            var store = tx.objectStore('items');
            item.isCustom = true;
            var req = store.add(item);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    };

    D2Database.prototype.getAllItems = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.db) return reject('DB not initialized');
            var tx = self.db.transaction(['items'], 'readonly');
            var store = tx.objectStore('items');
            var req = store.getAll();
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    };

    D2Database.prototype.searchItems = function (keyword, category) {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.db) return reject('DB not initialized');
            var tx = self.db.transaction(['items'], 'readonly');
            var store = tx.objectStore('items');
            var req = store.getAll();
            req.onsuccess = function () {
                var results = req.result;
                if (category !== 'all') {
                    results = results.filter(function (item) {
                        return item.type === category;
                    });
                }
                if (keyword) {
                    var lowerKey = keyword.toLowerCase();
                    var terms = lowerKey.split(/\s+/).filter(function (t) { return t.length > 0; });
                    results = results.filter(function (item) {
                        var searchText = (
                            item.name + ' ' +
                            item.description + ' ' +
                            (item.tags ? item.tags.join(' ') : '')
                        ).toLowerCase();
                        return terms.every(function (term) {
                            return searchText.indexOf(term) !== -1;
                        });
                    });
                }
                resolve(results);
            };
            req.onerror = function () { reject(req.error); };
        });
    };

    D2Database.prototype.updateSeedData = function (newItems) {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.db) return reject('DB not initialized');
            var tx = self.db.transaction(['items'], 'readwrite');
            var store = tx.objectStore('items');
            var cursorReq = store.openCursor();
            cursorReq.onsuccess = function (event) {
                var cursor = event.target.result;
                if (cursor) {
                    if (!cursor.value.isCustom) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    newItems.forEach(function (item) {
                        item.isCustom = false;
                        store.add(item);
                    });
                }
            };
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
        });
    };

    return D2Database;
})();

// ========== UI 순수 함수 ==========
// DOM 에 의존하지 않는 판단 로직만 모아 Node 테스트로 검증한다
var D2UI = (function () {
    var PAGE_SIZE = 30;
    // 설명이 이 길이를 넘으면 한 줄이 여러 줄로 감길 가능성이 높아 접기 대상으로 본다
    var COLLAPSE_CHARS = 120;
    var COLLAPSE_LINES = 3;
    // 검색어별로 화면이 늘어나므로 localStorage 가 무한히 커지지 않게 최근 화면만 보관
    var MAX_VIEWS = 20;
    var STATE_KEY = 'd2r_scroll_state';
    var LAST_VIEW_KEY = 'd2r_last_view';

    function toInt(n) {
        n = Math.floor(Number(n));
        return isFinite(n) && n > 0 ? n : 0;
    }

    function splitTerms(keyword) {
        return String(keyword == null ? '' : keyword).toLowerCase().split(/\s+/)
            .filter(function (t) { return t.length > 0; });
    }

    function isHomeView(category, keyword) {
        return category === 'all' && splitTerms(keyword).length === 0;
    }

    function nextPageEnd(rendered, total, pageSize) {
        var size = toInt(pageSize) || PAGE_SIZE;
        return Math.min(toInt(rendered) + size, toInt(total));
    }

    // 저장 당시보다 결과가 줄었을 수 있으므로 현재 결과 수로 제한하고, 최소 첫 페이지는 보장
    function restoreCount(saved, total, pageSize) {
        var size = toInt(pageSize) || PAGE_SIZE;
        return Math.min(Math.max(toInt(saved), size), toInt(total));
    }

    // IndexedDB autoIncrement id 는 데이터 버전 갱신 때 시드를 재삽입하며 바뀌므로 type+name 을 식별자로 쓴다
    function itemKey(item) {
        return item ? item.type + ':' + item.name : '';
    }

    function isCollapsible(description) {
        if (!description) return false;
        return description.length > COLLAPSE_CHARS || description.split('\n').length > COLLAPSE_LINES;
    }

    // 이름·태그에서 이미 일치가 보이면 요약으로 충분, 설명에만 있는 키워드는 접힌 부분에 숨을 수 있어 펼친다
    function shouldAutoExpand(item, keyword) {
        if (!item || !isCollapsible(item.description)) return false;
        var head = (item.name + ' ' + (item.tags ? item.tags.join(' ') : '')).toLowerCase();
        var desc = item.description.toLowerCase();
        return splitTerms(keyword).some(function (term) {
            return head.indexOf(term) === -1 && desc.indexOf(term) !== -1;
        });
    }

    function viewKey(category, keyword, sortByName) {
        return category + '|' + splitTerms(keyword).join(' ') + '|' + (sortByName ? 'name' : 'default');
    }

    // 스크롤 픽셀 대신 "고정 영역 바로 아래 보이는 카드 + 어긋남"을 저장 — 폴드 접힘/펼침으로 열 수가 바뀌어도 같은 카드로 복귀
    // cards 는 화면 순서대로 정렬돼 있으므로 O(n) 선형 탐색
    function pickAnchor(cards, stickyBottom) {
        if (!cards) return null;
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].bottom > stickyBottom) {
                return { key: cards[i].key, offset: cards[i].top - stickyBottom };
            }
        }
        return null;
    }

    function anchorScrollTop(cardDocTop, stickyBottom, offset) {
        var off = Number(offset);
        if (!isFinite(off)) off = 0;
        return Math.max(0, cardDocTop - stickyBottom - off);
    }

    function normalizeState(s) {
        s = s && typeof s === 'object' ? s : {};
        var offset = Number(s.offset);
        return {
            count: toInt(s.count),
            anchor: typeof s.anchor === 'string' ? s.anchor : null,
            offset: isFinite(offset) ? offset : 0,
            expanded: Array.isArray(s.expanded)
                ? s.expanded.filter(function (k) { return typeof k === 'string'; })
                : []
        };
    }

    // 저장소가 막혀도(시크릿 모드·용량 초과) 메모리 사본으로 같은 세션 내 복원은 유지
    function createScrollStore(storage) {
        function read(key) {
            try {
                var text = storage ? storage.getItem(key) : null;
                return text ? JSON.parse(text) : null;
            } catch (e) {
                return null;
            }
        }
        function write(key, value) {
            try {
                if (storage) storage.setItem(key, JSON.stringify(value));
            } catch (e) { /* 영구 저장 실패는 무시 */ }
        }

        var raw = read(STATE_KEY);
        var views = raw && raw.views && typeof raw.views === 'object' ? raw.views : {};
        var order = raw && Array.isArray(raw.order)
            ? raw.order.filter(function (k) { return typeof k === 'string' && views[k]; })
            : [];
        var lastView = null;

        return {
            load: function (key) {
                return views[key] ? normalizeState(views[key]) : null;
            },
            // order 는 오래된 것 → 최근 순서의 LRU 목록, 최대 20개라 indexOf/splice 비용은 무시 가능
            save: function (key, state) {
                views[key] = normalizeState(state);
                var idx = order.indexOf(key);
                if (idx !== -1) order.splice(idx, 1);
                order.push(key);
                while (order.length > MAX_VIEWS) delete views[order.shift()];
                write(STATE_KEY, { order: order, views: views });
            },
            loadLastView: function () {
                var v = lastView || read(LAST_VIEW_KEY);
                if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
                return {
                    category: typeof v.category === 'string' ? v.category : 'all',
                    keyword: typeof v.keyword === 'string' ? v.keyword : '',
                    sortByName: v.sortByName === true
                };
            },
            saveLastView: function (view) {
                lastView = view;
                write(LAST_VIEW_KEY, view);
            }
        };
    }

    return {
        PAGE_SIZE: PAGE_SIZE,
        isHomeView: isHomeView,
        nextPageEnd: nextPageEnd,
        restoreCount: restoreCount,
        itemKey: itemKey,
        isCollapsible: isCollapsible,
        shouldAutoExpand: shouldAutoExpand,
        viewKey: viewKey,
        pickAnchor: pickAnchor,
        anchorScrollTop: anchorScrollTop,
        createScrollStore: createScrollStore
    };
})();

// ========== Main App ==========
var App = (function () {
    function App() {
        this.currentCategory = 'all';
        this.sortByName = false;
        this.VERSION_KEY = 'd2r_data_version';
        this.db = new D2Database();
        this.searchTimer = null;
        this.store = D2UI.createScrollStore(safeLocalStorage());
        this.items = [];            // 현재 목록 화면의 전체 검색 결과
        this.rendered = 0;          // 그중 DOM 에 그린 개수
        this.viewKey = null;        // 첫 화면이면 null
        this.keyword = '';
        this.expandedKeys = {};     // 복원 대상 펼침 카드 (itemKey → true)
        this.searchSeq = 0;         // 느린 이전 검색 결과가 최신 화면을 덮어쓰지 않게 하는 순번
        this.pristine = true;       // 렌더·복원 후 사용자가 스크롤/펼침을 안 했으면 저장 생략
        this.baseScrollY = 0;
        this.saveTimer = null;
        this.currentAnchor = null;  // 폴드 접힘/펼침(폭 변경) 시 되돌아갈 기준 카드
        this.lastWidth = 0;
        this.init();
    }

    // 시크릿 모드 등에서 localStorage 접근 자체가 예외를 던질 수 있음
    function safeLocalStorage() {
        try {
            return window.localStorage;
        } catch (e) {
            return null;
        }
    }

    var SUGGESTIONS = ['베르', '수수께끼', '카오스', '테러존', '올스킬'];

    var TYPE_MAP = {
        rune: { label: '룬', cls: 'type-rune' },
        runeword: { label: '룬워드', cls: 'type-runeword' },
        unique: { label: '유니크', cls: 'type-unique' },
        set: { label: '세트', cls: 'type-set' },
        quest: { label: '퀘스트', cls: 'type-quest' },
        merc: { label: '용병', cls: 'type-merc' },
        area: { label: '지역', cls: 'type-area' },
        event: { label: '이벤트', cls: 'type-event' },
        class: { label: '클래스', cls: 'type-class' }
    };

    App.prototype.init = function () {
        var self = this;
        // 브라우저 자체 스크롤 복원은 목록이 그려지기 전에 동작해 엉뚱한 위치로 가므로 직접 처리
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        this.db.connect().then(function () {
            return self.checkAndLoadData();
        }).then(function () {
            self.restoreLastView();
            self.updateStats();
            self.handleSearch();
            self.bindEvents();
        }).catch(function (e) {
            console.error('초기화 실패', e);
        });
    };

    App.prototype.showLoading = function (message) {
        var overlay = document.getElementById('loadingOverlay');
        var text = document.getElementById('loadingText');
        if (overlay && text) {
            text.textContent = message || '데이터 업데이트 중...';
            overlay.classList.remove('hidden');
        }
    };

    App.prototype.hideLoading = function () {
        var overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.add('hidden');
    };

    App.prototype.checkAndLoadData = function () {
        var self = this;
        return fetch('./db_version.json?t=' + Date.now()).then(function (res) {
            if (!res.ok) throw new Error('버전 파일 없음');
            return res.json();
        }).then(function (data) {
            var remote = data.version;
            var local = parseInt(localStorage.getItem(self.VERSION_KEY) || '0');
            if (remote > local) {
                self.showLoading('새 데이터(v' + remote + ')를 받아오는 중...');
                return fetch('./data.json').then(function (res) {
                    if (!res.ok) throw new Error('데이터 파일 없음');
                    return res.json();
                }).then(function (json) {
                    self.showLoading('데이터베이스 최적화 중...');
                    return self.db.updateSeedData(json.items);
                }).then(function () {
                    localStorage.setItem(self.VERSION_KEY, remote.toString());
                }).finally(function () {
                    self.hideLoading();
                });
            }
        }).catch(function (e) {
            console.error('데이터 로드 실패:', e);
            self.hideLoading();
        });
    };

    // 새로고침·브라우저 재시작 후 마지막으로 보던 탭·검색어·정렬을 되살림
    App.prototype.restoreLastView = function () {
        var last = this.store.loadLastView();
        if (!last) return;
        var tab = document.querySelector('.tab-btn[data-cat="' + last.category + '"]');
        this.currentCategory = tab ? last.category : 'all';
        var cat = this.currentCategory;
        document.querySelectorAll('.tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
        });
        document.getElementById('searchInput').value = last.keyword;
        this.sortByName = last.sortByName;
        document.getElementById('sortBtn').textContent = this.sortByName ? '기본순' : '이름순';
    };

    // 첫 화면 카테고리 타일 — 기존 통계 바를 대체
    App.prototype.updateStats = function () {
        var self = this;
        this.db.getAllItems().then(function (items) {
            var counts = {};
            items.forEach(function (item) {
                var t = item.type;
                counts[t] = (counts[t] || 0) + 1;
            });
            var home = document.getElementById('homeView');
            if (!home) return;
            var labels = {
                rune: '룬', runeword: '룬워드', unique: '유니크', set: '세트',
                quest: '퀘스트', merc: '용병', area: '지역', event: '이벤트', class: '클래스'
            };
            var html = '<div class="home-total">전체 <b>' + items.length + '</b>개 항목</div>' +
                '<div class="home-tiles">';
            Object.keys(labels).forEach(function (key) {
                html += '<button class="home-tile" data-type="' + key + '" data-cat="' + key + '">' +
                    '<span class="tile-label">' + labels[key] + '</span>' +
                    '<span class="tile-count">' + (counts[key] || 0) + '</span>' +
                    '</button>';
            });
            html += '</div><div class="home-suggest"><span class="suggest-title">추천 검색</span>';
            SUGGESTIONS.forEach(function (word) {
                html += '<button class="suggest-chip" data-keyword="' + word + '">' + word + '</button>';
            });
            html += '</div>';
            home.innerHTML = html;
        });
    };

    App.prototype.bindEvents = function () {
        var self = this;
        var searchInput = document.getElementById('searchInput');
        var tabsContainer = document.getElementById('tabsContainer');
        var sortBtn = document.getElementById('sortBtn');
        var scrollTop = document.getElementById('scrollTop');
        var btnAdd = document.getElementById('btnAdd');
        var btnSave = document.getElementById('btnSave');
        var btnCancel = document.getElementById('btnCancel');
        var modal = document.getElementById('addModal');

        // Debounced search
        searchInput.addEventListener('input', function () {
            clearTimeout(self.searchTimer);
            self.searchTimer = setTimeout(function () {
                self.handleSearch();
            }, 200);
        });

        // Tab clicks via event delegation
        tabsContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.tab-btn');
            if (!btn) return;
            var cat = btn.getAttribute('data-cat');
            self.setCategory(cat);
        });

        // Sort toggle
        sortBtn.addEventListener('click', function () {
            self.sortByName = !self.sortByName;
            sortBtn.textContent = self.sortByName ? '기본순' : '이름순';
            self.handleSearch();
        });

        // Home tiles & suggestions
        document.getElementById('homeView').addEventListener('click', function (e) {
            var tile = e.target.closest('.home-tile');
            if (tile) return self.setCategory(tile.getAttribute('data-cat'));
            var chip = e.target.closest('.suggest-chip');
            if (chip) {
                searchInput.value = chip.getAttribute('data-keyword');
                self.handleSearch();
            }
        });

        // Card expand/collapse
        var results = document.getElementById('results');
        results.addEventListener('click', function (e) {
            // 설명 텍스트를 드래그로 복사하는 중이면 펼침 토글하지 않음
            if (window.getSelection && String(window.getSelection()).length > 0) return;
            var card = e.target.closest('.item-card.collapsible');
            if (card) self.toggleCard(card);
        });
        results.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var card = e.target.closest('.item-card.collapsible');
            if (!card || card !== e.target) return;
            e.preventDefault();
            self.toggleCard(card);
        });

        // Infinite scroll — 감시 요소가 화면 아래 800px 안에 들어오면 미리 다음 페이지를 붙임
        var loadMore = document.getElementById('loadMore');
        loadMore.addEventListener('click', function () { self.loadNextPage(); });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting) self.loadNextPage();
            }, { rootMargin: '0px 0px 800px 0px' }).observe(loadMore);
        }

        // Scroll to top & scroll position memory
        this.lastWidth = window.innerWidth;
        window.addEventListener('scroll', function () {
            scrollTop.style.display = window.scrollY > 300 ? 'block' : 'none';
            // 폭 변경 직후의 스크롤 이벤트는 재배치 결과라 기준 카드를 갱신하지 않음 (resize 처리에서 복귀)
            if (window.innerWidth !== self.lastWidth) return;
            if (Math.abs(window.scrollY - self.baseScrollY) > 4) self.pristine = false;
            self.scheduleSave();
        });
        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                // 모바일 주소창 표시/숨김은 높이만 바뀌므로 무시, 폴드 접힘/펼침·회전만 처리
                if (window.innerWidth === self.lastWidth) return;
                self.lastWidth = window.innerWidth;
                if (self.currentAnchor) {
                    self.scrollToAnchor(self.currentAnchor.key, self.currentAnchor.offset);
                }
            }, 150);
        });
        // 모바일 브라우저는 백그라운드에서 탭을 종료할 수 있어 숨겨지는 시점에 즉시 저장
        window.addEventListener('pagehide', function () { self.saveScrollState(); });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') self.saveScrollState();
        });
        scrollTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Modal
        btnAdd.addEventListener('click', function () { self.openAddModal(); });
        btnCancel.addEventListener('click', function () { self.closeAddModal(); });
        btnSave.addEventListener('click', function () { self.addItem(); });
        modal.addEventListener('click', function (e) {
            if (e.target === modal) self.closeAddModal();
        });

        // Keyboard shortcut
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') self.closeAddModal();
            if (e.key === '/' && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        });
    };

    App.prototype.setCategory = function (category) {
        this.currentCategory = category;
        var btns = document.querySelectorAll('.tab-btn');
        btns.forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-cat') === category);
        });
        this.handleSearch();
    };

    App.prototype.handleSearch = function () {
        var self = this;
        var seq = ++this.searchSeq;
        var keyword = document.getElementById('searchInput').value.trim();
        var container = document.getElementById('results');
        var countEl = document.getElementById('resultCount');
        var homeView = document.getElementById('homeView');
        var listView = document.getElementById('listView');

        // 화면이 바뀌기 전에 이전 목록의 위치를 저장 (DOM 이 아직 이전 화면 상태)
        this.saveScrollState();
        this.store.saveLastView({ category: this.currentCategory, keyword: keyword, sortByName: this.sortByName });

        if (D2UI.isHomeView(this.currentCategory, keyword)) {
            this.viewKey = null;
            this.items = [];
            this.rendered = 0;
            this.currentAnchor = null;
            container.innerHTML = '';
            homeView.classList.remove('hidden');
            listView.classList.add('hidden');
            window.scrollTo(0, 0);
            return;
        }

        this.db.searchItems(keyword, this.currentCategory).then(function (items) {
            if (seq !== self.searchSeq) return;
            if (self.sortByName) {
                items.sort(function (a, b) {
                    return a.name.localeCompare(b.name, 'ko');
                });
            }

            homeView.classList.add('hidden');
            listView.classList.remove('hidden');
            countEl.textContent = items.length + '개 결과';

            var key = D2UI.viewKey(self.currentCategory, keyword, self.sortByName);
            var saved = self.store.load(key);
            self.viewKey = key;
            self.keyword = keyword;
            self.items = items;
            self.rendered = 0;
            self.expandedKeys = {};
            if (saved) {
                saved.expanded.forEach(function (k) { self.expandedKeys[k] = true; });
            }
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
                self.updateLoadMore();
                self.scrollToListStart();
                return;
            }

            // 저장된 개수만큼 한 번에 그려 30개씩 다시 불러오는 과정을 생략
            self.renderUpTo(saved
                ? D2UI.restoreCount(saved.count, items.length, D2UI.PAGE_SIZE)
                : D2UI.nextPageEnd(0, items.length, D2UI.PAGE_SIZE));
            if (saved && saved.anchor) {
                self.scrollToAnchor(saved.anchor, saved.offset);
            } else {
                self.scrollToListStart();
            }
            self.pristine = true;
            self.baseScrollY = window.scrollY;
        });
    };

    App.prototype.renderUpTo = function (end) {
        var fragment = document.createDocumentFragment();
        for (var i = this.rendered; i < end; i++) {
            fragment.appendChild(this.createCard(this.items[i], this.keyword));
        }
        this.rendered = Math.max(this.rendered, end);
        document.getElementById('results').appendChild(fragment);
        this.updateLoadMore();
    };

    App.prototype.loadNextPage = function () {
        if (!this.viewKey || this.rendered >= this.items.length) return;
        this.renderUpTo(D2UI.nextPageEnd(this.rendered, this.items.length, D2UI.PAGE_SIZE));
        // 붙인 뒤에도 감시 요소가 계속 보이면 IntersectionObserver 가 다시 알리지 않으므로 직접 확인
        var self = this;
        requestAnimationFrame(function () {
            var btn = document.getElementById('loadMore');
            if (!btn.classList.contains('hidden') &&
                btn.getBoundingClientRect().top < window.innerHeight + 800) {
                self.loadNextPage();
            }
        });
    };

    App.prototype.updateLoadMore = function () {
        var btn = document.getElementById('loadMore');
        var remaining = this.rendered < this.items.length;
        btn.classList.toggle('hidden', !remaining);
        if (remaining) btn.textContent = '더 보기 (' + this.rendered + ' / ' + this.items.length + ')';
    };

    // 고정된 검색 바의 하단 좌표 — 이 아래부터가 실제로 보이는 목록 영역
    App.prototype.stickyBottom = function () {
        return document.querySelector('.control-panel').getBoundingClientRect().height;
    };

    App.prototype.findCard = function (key) {
        var cards = document.getElementById('results').children;
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].getAttribute('data-key') === key) return cards[i];
        }
        return null;
    };

    App.prototype.scrollToAnchor = function (key, offset) {
        var card = this.findCard(key);
        if (!card) return this.scrollToListStart();
        var docTop = card.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, D2UI.anchorScrollTop(docTop, this.stickyBottom(), offset));
        this.currentAnchor = { key: key, offset: offset };
    };

    // 저장 위치가 없는 새 화면: 목록 시작이 이미 보이면 그대로, 지나쳐 있으면 목록 시작으로
    App.prototype.scrollToListStart = function () {
        var listTop = document.getElementById('listView').getBoundingClientRect().top + window.scrollY;
        var target = Math.max(0, listTop - this.stickyBottom() - 8);
        if (window.scrollY > target) window.scrollTo(0, target);
        this.currentAnchor = null;
    };

    // 화면 순서대로 카드를 훑다가 고정 영역 아래로 완전히 내려간 카드를 만나면 중단 — 최악 O(렌더된 카드 수)
    App.prototype.captureAnchor = function () {
        var cards = document.getElementById('results').children;
        var stickyBottom = this.stickyBottom();
        var rects = [];
        for (var i = 0; i < cards.length; i++) {
            var key = cards[i].getAttribute('data-key');
            if (!key) continue;
            var r = cards[i].getBoundingClientRect();
            rects.push({ key: key, top: r.top, bottom: r.bottom });
            if (r.top > stickyBottom) break;
        }
        return D2UI.pickAnchor(rects, stickyBottom);
    };

    App.prototype.scheduleSave = function () {
        var self = this;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(function () { self.saveScrollState(); }, 200);
    };

    App.prototype.saveScrollState = function () {
        clearTimeout(this.saveTimer);
        // 검색어 입력 중 거쳐 간 화면들로 최근 20개 보관 목록이 채워지지 않도록, 실제로 탐색한 화면만 저장
        if (!this.viewKey || this.pristine) return;
        var anchor = this.captureAnchor();
        this.currentAnchor = anchor;
        var expanded = [];
        var open = document.querySelectorAll('#results .item-card.expanded');
        for (var i = 0; i < open.length; i++) expanded.push(open[i].getAttribute('data-key'));
        this.store.save(this.viewKey, {
            count: this.rendered,
            anchor: anchor ? anchor.key : null,
            offset: anchor ? anchor.offset : 0,
            expanded: expanded
        });
    };

    App.prototype.toggleCard = function (card) {
        var expanded = card.classList.toggle('expanded');
        card.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // 긴 카드를 접으면 카드 머리가 화면 위로 사라질 수 있어 카드 시작으로 당겨 옴
        if (!expanded) {
            var top = card.getBoundingClientRect().top;
            var stickyBottom = this.stickyBottom();
            if (top < stickyBottom) window.scrollTo(0, window.scrollY + top - stickyBottom - 8);
        }
        this.pristine = false;
        this.scheduleSave();
    };

    App.prototype.createCard = function (item, keyword) {
        var card = document.createElement('div');
        var key = D2UI.itemKey(item);
        card.className = 'item-card';
        card.setAttribute('data-type', item.type);
        card.setAttribute('data-key', key);
        if (D2UI.isCollapsible(item.description)) {
            var expanded = !!this.expandedKeys[key] || D2UI.shouldAutoExpand(item, keyword);
            card.classList.add('collapsible');
            if (expanded) card.classList.add('expanded');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        var typeInfo = TYPE_MAP[item.type] || { label: item.type, cls: '' };
        var badge = item.isCustom ? ' <span class="item-badge">USER</span>' : '';

        // Highlight keyword in description
        var desc = this.escapeHtml(item.description);
        if (keyword) {
            var terms = keyword.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });
            terms.forEach(function (term) {
                var regex = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                desc = desc.replace(regex, '<mark style="background:#d4af3744;color:#d4af37;padding:0 1px;border-radius:2px;">$1</mark>');
            });
        }

        var html = '<div class="item-header">' +
            '<span class="item-type ' + typeInfo.cls + '">' + typeInfo.label + '</span>' +
            badge +
            '</div>' +
            '<div class="item-name">' + this.escapeHtml(item.name) + '</div>' +
            '<div class="item-detail">' + desc + '</div>';

        // Meta chips
        if (item.meta) {
            var metaHtml = '<div class="item-meta">';
            if (item.meta.rank) metaHtml += '<span class="meta-chip"><b>#' + item.meta.rank + '</b> 등급</span>';
            if (item.meta.dropRate) metaHtml += '<span class="meta-chip">드랍: <b>' + item.meta.dropRate + '</b></span>';
            if (item.meta.base) metaHtml += '<span class="meta-chip">베이스: <b>' + item.meta.base + '</b></span>';
            if (item.meta.runes) metaHtml += '<span class="meta-chip">룬: <b>' + item.meta.runes.join(' + ') + '</b></span>';
            if (item.meta.act) metaHtml += '<span class="meta-chip">Act <b>' + item.meta.act + '</b></span>';
            if (item.meta.level) metaHtml += '<span class="meta-chip">Lv <b>' + item.meta.level + '</b></span>';
            if (item.meta.rarity) metaHtml += '<span class="meta-chip"><b>' + item.meta.rarity + '</b></span>';
            if (item.meta.pieces) metaHtml += '<span class="meta-chip"><b>' + item.meta.pieces + '</b>종</span>';
            if (item.meta.class) metaHtml += '<span class="meta-chip"><b>' + item.meta.class + '</b></span>';
            if (item.meta.patch) metaHtml += '<span class="meta-chip">패치 <b>' + item.meta.patch + '</b></span>';
            metaHtml += '</div>';
            html += metaHtml;
        }

        // Tags
        if (item.tags && item.tags.length > 0) {
            var tagsHtml = '<div class="item-tags">';
            var shown = item.tags.slice(0, 6);
            shown.forEach(function (tag) {
                tagsHtml += '<span class="tag">' + tag + '</span>';
            });
            if (item.tags.length > 6) {
                tagsHtml += '<span class="tag">+' + (item.tags.length - 6) + '</span>';
            }
            tagsHtml += '</div>';
            html += tagsHtml;
        }

        card.innerHTML = html;
        return card;
    };

    App.prototype.escapeHtml = function (text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    App.prototype.openAddModal = function () {
        document.getElementById('addModal').style.display = 'block';
        document.getElementById('newName').focus();
    };

    App.prototype.closeAddModal = function () {
        document.getElementById('addModal').style.display = 'none';
        document.getElementById('newName').value = '';
        document.getElementById('newDesc').value = '';
        document.getElementById('newTags').value = '';
    };

    App.prototype.addItem = function () {
        var self = this;
        var type = document.getElementById('newType').value;
        var name = document.getElementById('newName').value.trim();
        var desc = document.getElementById('newDesc').value.trim();
        var tagsStr = document.getElementById('newTags').value.trim();

        if (!name || !desc) {
            alert('이름과 설명을 모두 입력해주세요.');
            return;
        }

        var tags = [name, type];
        if (tagsStr) {
            tagsStr.split(',').forEach(function (t) {
                var trimmed = t.trim();
                if (trimmed) tags.push(trimmed);
            });
        }

        var newItem = {
            type: type,
            name: name,
            description: desc,
            tags: tags
        };

        this.db.addItem(newItem).then(function () {
            alert('저장되었습니다.');
            self.closeAddModal();
            self.updateStats();
            self.handleSearch();
        }).catch(function (e) {
            console.error(e);
            alert('저장 중 오류가 발생했습니다.');
        });
    };

    return App;
})();

// Node(테스트)에서는 DOM·IndexedDB 가 없으므로 앱을 띄우지 않고 순수 함수만 내보낸다
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { D2UI: D2UI };
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var app = new App();
    window.app = app;
}
