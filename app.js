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

// ========== Main App ==========
var App = (function () {
    function App() {
        this.currentCategory = 'all';
        this.sortByName = false;
        this.VERSION_KEY = 'd2r_data_version';
        this.db = new D2Database();
        this.searchTimer = null;
        this.init();
    }

    var TYPE_MAP = {
        rune: { label: '룬', cls: 'type-rune' },
        runeword: { label: '룬워드', cls: 'type-runeword' },
        unique: { label: '유니크', cls: 'type-unique' },
        set: { label: '세트', cls: 'type-set' },
        quest: { label: '퀘스트', cls: 'type-quest' },
        merc: { label: '용병', cls: 'type-merc' },
        area: { label: '지역', cls: 'type-area' },
        event: { label: '이벤트', cls: 'type-event' }
    };

    App.prototype.init = function () {
        var self = this;
        this.db.connect().then(function () {
            return self.checkAndLoadData();
        }).then(function () {
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

    App.prototype.updateStats = function () {
        var self = this;
        this.db.getAllItems().then(function (items) {
            var counts = {};
            items.forEach(function (item) {
                var t = item.type;
                counts[t] = (counts[t] || 0) + 1;
            });
            var bar = document.getElementById('statsBar');
            if (!bar) return;
            var labels = {
                rune: '룬', runeword: '룬워드', unique: '유니크', set: '세트',
                quest: '퀘스트', merc: '용병', area: '지역', event: '이벤트'
            };
            var html = '<div class="stat-item">전체 <span>' + items.length + '</span></div>';
            Object.keys(labels).forEach(function (key) {
                if (counts[key]) {
                    html += '<div class="stat-item">' + labels[key] + ' <span>' + counts[key] + '</span></div>';
                }
            });
            bar.innerHTML = html;
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

        // Scroll to top
        window.addEventListener('scroll', function () {
            scrollTop.style.display = window.scrollY > 300 ? 'block' : 'none';
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
        var keyword = document.getElementById('searchInput').value.trim();
        var container = document.getElementById('results');
        var countEl = document.getElementById('resultCount');

        this.db.searchItems(keyword, this.currentCategory).then(function (items) {
            if (self.sortByName) {
                items.sort(function (a, b) {
                    return a.name.localeCompare(b.name, 'ko');
                });
            }

            countEl.textContent = items.length + '개 결과';

            if (items.length === 0) {
                container.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
                return;
            }

            var fragment = document.createDocumentFragment();
            items.forEach(function (item) {
                fragment.appendChild(self.createCard(item, keyword));
            });
            container.innerHTML = '';
            container.appendChild(fragment);
        });
    };

    App.prototype.createCard = function (item, keyword) {
        var card = document.createElement('div');
        card.className = 'item-card';
        card.setAttribute('data-type', item.type);

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

var app = new App();
window.app = app;
