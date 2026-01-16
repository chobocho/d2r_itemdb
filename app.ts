/**
 * 1. 데이터 모델 정의
 */
interface D2Item {
    id?: number;
    type: 'rune' | 'runeword' | 'quest' | 'merc';
    name: string;
    description: string;
    tags: string[];
    meta?: any;
    isCustom?: boolean; // 사용자 추가 데이터인지 여부 판별
}

interface SeedDataFile {
    version: number;
    items: D2Item[];
}

/**
 * 2. IndexedDB 관리 클래스
 */
class D2Database {
    private dbName = 'D2R_DB_V2'; // DB 이름 변경 (구조 변경 대응)
    private dbVersion = 1;
    private db: IDBDatabase | null = null;

    constructor() {}

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('items')) {
                    const objectStore = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
                    objectStore.createIndex('type', 'type', { unique: false });
                    objectStore.createIndex('isCustom', 'isCustom', { unique: false });
                }
            };
        });
    }

    async addItem(item: D2Item): Promise<number> {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction(['items'], 'readwrite');
            const store = transaction.objectStore('items');
            
            // 사용자 추가 데이터임을 명시
            item.isCustom = true;
            
            const request = store.add(item);
            request.onsuccess = () => resolve(request.result as number);
            request.onerror = () => reject(request.error);
        });
    }

    async searchItems(keyword: string, category: string): Promise<D2Item[]> {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction(['items'], 'readonly');
            const store = transaction.objectStore('items');
            const request = store.getAll();

            request.onsuccess = () => {
                let results: D2Item[] = request.result;
                if (category !== 'all') {
                    results = results.filter(item => item.type === category);
                }
                if (keyword) {
                    const lowerKey = keyword.toLowerCase();
                    results = results.filter(item => 
                        item.name.toLowerCase().includes(lowerKey) ||
                        item.description.toLowerCase().includes(lowerKey) ||
                        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(lowerKey)))
                    );
                }
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 시드 데이터 업데이트 (기존 시드 데이터 삭제 후 재삽입, 사용자 데이터는 유지)
    async updateSeedData(newItems: D2Item[]): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            
            const transaction = this.db.transaction(['items'], 'readwrite');
            const store = transaction.objectStore('items');

            // 1. 모든 데이터를 순회하며 isCustom이 없는(혹은 false인) 데이터 삭제
            const request = store.openCursor();
            
            request.onsuccess = (event: any) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value as D2Item;
                    // 사용자 데이터가 아니면 삭제 (시드 데이터 교체)
                    if (!item.isCustom) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    // 2. 삭제 완료 후 새로운 데이터 일괄 삽입
                    newItems.forEach(item => {
                        // 시드 데이터는 isCustom = false로 설정
                        item.isCustom = false;
                        store.add(item);
                    });
                    console.log(`시드 데이터 ${newItems.length}개 업데이트 완료`);
                }
            };
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

/**
 * 3. 메인 애플리케이션 로직
 */
class App {
    private db: D2Database;
    private currentCategory: string = 'all';
    private readonly VERSION_KEY = 'd2r_data_version';

    constructor() {
        this.db = new D2Database();
        this.init();
    }

    async init() {
        try {
            await this.db.connect();
            console.log("DB 연결 성공");

            // 데이터 파일 로드 및 업데이트 체크
            await this.checkAndLoadData();

            this.handleSearch();
            this.bindEvents();
        } catch (e) {
            console.error("초기화 실패", e);
        }
    }

	// 로딩 화면 제어 메서드 추가
    showLoading(message: string = "데이터 업데이트 중...") {
        const overlay = document.getElementById('loadingOverlay');
        const text = document.getElementById('loadingText');
        if (overlay && text) {
            text.textContent = message;
            overlay.classList.remove('hidden');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    async checkAndLoadData() {
        try {
            // 1. 버전 파일 확인 (가벼움)
            const versionResponse = await fetch(`./db_version.json?t=${Date.now()}`);
            if (!versionResponse.ok) throw new Error("버전 파일을 찾을 수 없습니다.");
            
            const versionData = await versionResponse.json();
            const remoteVersion = versionData.version;
            const currentVersion = parseInt(localStorage.getItem(this.VERSION_KEY) || '0');
            
            console.log(`현재 로컬 버전: ${currentVersion}, 서버 버전: ${remoteVersion}`);

            // 2. 업데이트가 필요한 경우에만 로딩창 표시 및 다운로드
            if (remoteVersion > currentVersion) {
                // UI: 로딩 시작
                this.showLoading(`새 데이터(v${remoteVersion})를 받아오고 있습니다...`);
                
                try {
                    const dataResponse = await fetch('./data.json');
                    if (!dataResponse.ok) throw new Error("데이터 파일을 찾을 수 없습니다.");
                    
                    // UI: 메시지 변경 (다운로드 완료 후 DB 작업 시)
                    this.showLoading("데이터베이스를 최적화 중입니다...");
                    
                    const data = await dataResponse.json();

                    // DB 업데이트 수행
                    await this.db.updateSeedData(data.items);
                    
                    // 버전 갱신
                    localStorage.setItem(this.VERSION_KEY, remoteVersion.toString());
                    
                    // 검색 결과 갱신
                    this.handleSearch();
                    
                    // 완료 알림 (선택 사항)
                    // alert(`업데이트 완료 (v${remoteVersion})`);
                    
                } catch (updateError) {
                    console.error("업데이트 실패:", updateError);
                    alert("데이터 업데이트 중 문제가 발생했습니다.");
                } finally {
                    // 성공하든 실패하든 로딩창 닫기
                    this.hideLoading();
                }
            } else {
                console.log("최신 상태입니다.");
            }

        } catch (e) {
            console.error("초기화 확인 실패:", e);
            // 버전 파일 체크 자체가 실패했을 때는 로딩창을 띄우지 않았으므로 닫을 필요 없음
        }
    }

    bindEvents() {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        searchInput.addEventListener('input', () => this.handleSearch());
    }

    setCategory(category: string) {
        this.currentCategory = category;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        // 탭 활성화 UI 로직은 간소화함
        this.handleSearch();
    }

    async handleSearch() {
        const searchInput = document.getElementById('searchInput') as HTMLInputElement;
        const keyword = searchInput.value.trim();
        const resultsContainer = document.getElementById('results') as HTMLDivElement;

        const items = await this.db.searchItems(keyword, this.currentCategory);

        resultsContainer.innerHTML = '';
        if (items.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align:center; color:#777;">검색 결과가 없습니다.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            // 사용자 추가 아이템인 경우 별도 표시
            const badge = item.isCustom ? '<span style="color:#00ff00; font-size:0.8em; border:1px solid #00ff00; padding:2px 4px; border-radius:4px; margin-left:5px;">USER</span>' : '';
            
            card.innerHTML = `
                <div class="item-type">${this.translateType(item.type)}</div>
                <div class="item-name">${item.name} ${badge}</div>
                <div class="item-detail">${item.description}</div>
            `;
            resultsContainer.appendChild(card);
        });
    }

    translateType(type: string): string {
        switch(type) {
            case 'rune': return '룬 (Rune)';
            case 'runeword': return '룬어 (Runeword)';
            case 'quest': return '퀘스트 (Quest)';
            case 'merc': return '용병 (Mercenary)';
            default: return type;
        }
    }

    // --- 모달 및 추가 기능 ---
    openAddModal() {
        document.getElementById('addModal')!.style.display = 'block';
    }

    closeAddModal() {
        document.getElementById('addModal')!.style.display = 'none';
        (document.getElementById('newName') as HTMLInputElement).value = '';
        (document.getElementById('newDesc') as HTMLTextAreaElement).value = '';
    }

    async addItem() {
        const type = (document.getElementById('newType') as HTMLSelectElement).value as any;
        const name = (document.getElementById('newName') as HTMLInputElement).value;
        const desc = (document.getElementById('newDesc') as HTMLTextAreaElement).value;

        if (!name || !desc) {
            alert('이름과 설명을 모두 입력해주세요.');
            return;
        }

        const newItem: D2Item = {
            type: type,
            name: name,
            description: desc,
            tags: [name, type]
        };

        try {
            await this.db.addItem(newItem);
            alert('저장되었습니다.');
            this.closeAddModal();
            this.handleSearch();
        } catch (e) {
            console.error(e);
            alert('저장 중 오류가 발생했습니다.');
        }
    }
}

const app = new App();
(window as any).app = app;

