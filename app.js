// ========================================
// jsAnki - Enhanced Learning App (Memory Leak Fixed)
// Features: IndexedDB, Lazy Loading, Search, Filters, Exam Mode
// ========================================

// ========================================
// App State
// ========================================
const state = {
    // Data
    manifest: null,
    categories: new Map(),
    allCards: [],
    
    // Current view
    currentTopic: null,
    currentCards: [],
    currentIndex: 0,
    isFlipped: false,
    isRandomMode: false,
    isExamMode: false,
    isErrorsOnlyMode: false,
    cardFilter: 'all',
    
    // Theme
    theme: 'dark',
    
    // UI
    searchQuery: '',
    
    // Abort controllers for cleanup
    abortControllers: {
        search: null,
        cardLoading: null
    },
    
    // Timers for cleanup
    timers: {
        toast: null,
        navigation: null,
        splash: null,
        search: null
    },
    
    // Event handlers storage
    handlers: {
        touchStart: null,
        touchMove: null,
        touchEnd: null,
        keyboard: null,
        globalSearchClick: null,
        dotClickHandlers: new Map() // Store dot click handlers for cleanup
    },
    
    // Flags
    isInitialized: false,
    isCleaningUp: false
};

// ========================================
// IndexedDB Integration
// ========================================
const DB_NAME = 'jsAnkiDB';
const DB_VERSION = 1;

class AnkiDatabase {
    constructor() {
        this.db = null;
        this.isClosing = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                
                // Handle connection close
                this.db.onclose = () => {
                    console.log('[DB] Connection closed');
                    this.db = null;
                };
                
                // Handle version change (other tab upgraded DB)
                this.db.onversionchange = () => {
                    this.close();
                };
                
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('progress')) {
                    const progressStore = db.createObjectStore('progress', { keyPath: 'cardId' });
                    progressStore.createIndex('status', 'status', { unique: false });
                }

                if (!db.objectStoreNames.contains('cache')) {
                    const cacheStore = db.createObjectStore('cache', { keyPath: 'key' });
                    cacheStore.createIndex('category', 'category', { unique: false });
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }
    
    close() {
        if (this.db && !this.isClosing) {
            this.isClosing = true;
            this.db.close();
            this.db = null;
            this.isClosing = false;
        }
    }

    async saveProgress(cardId, status) {
        if (!this.db) throw new Error('DB not initialized');
        return this._put('progress', { cardId, status, timestamp: Date.now() });
    }

    async getProgress(cardId) {
        if (!this.db) return null;
        const result = await this._get('progress', cardId);
        return result ? result.status : null;
    }

    async getAllProgress() {
        if (!this.db) return {};
        const results = await this._getAll('progress');
        const map = {};
        results.forEach(r => map[r.cardId] = r.status);
        return map;
    }

    async getProgressByStatus(status) {
        if (!this.db) return [];
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['progress'], 'readonly');
                const store = transaction.objectStore('progress');
                const index = store.index('status');
                const request = index.getAll(status);
                request.onsuccess = () => resolve(request.result.map(r => r.cardId));
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async clearAllProgress() {
        if (!this.db) return;
        return this._clear('progress');
    }

    async deleteProgress(cardId) {
        if (!this.db) return;
        return this._delete('progress', cardId);
    }

    async getStats() {
        if (!this.db) return { known: 0, unknown: 0, total: 0 };
        const allProgress = await this._getAll('progress');
        const known = allProgress.filter(p => p.status === 'known').length;
        const unknown = allProgress.filter(p => p.status === 'unknown').length;
        return { known, unknown, total: allProgress.length };
    }

    async cacheCategory(categoryId, data) {
        if (!this.db) return;
        return this._put('cache', {
            key: `category_${categoryId}`,
            category: categoryId,
            data,
            timestamp: Date.now()
        });
    }

    async getCachedCategory(categoryId) {
        if (!this.db) return null;
        const result = await this._get('cache', `category_${categoryId}`);
        return result ? result.data : null;
    }

    async cacheManifest(manifest) {
        if (!this.db) return;
        return this._put('cache', {
            key: 'manifest',
            data: manifest,
            timestamp: Date.now()
        });
    }

    async getCachedManifest() {
        if (!this.db) return null;
        const result = await this._get('cache', 'manifest');
        return result ? result.data : null;
    }

    async saveSetting(key, value) {
        if (!this.db) return;
        return this._put('settings', { key, value });
    }

    async getSetting(key, defaultValue = null) {
        if (!this.db) return defaultValue;
        const result = await this._get('settings', key);
        return result ? result.value : defaultValue;
    }

    async migrateFromLocalStorage() {
        try {
            const oldData = localStorage.getItem('cardStatuses');
            if (oldData) {
                const statuses = JSON.parse(oldData);
                const promises = Object.entries(statuses).map(([cardId, status]) => 
                    this.saveProgress(cardId, status)
                );
                await Promise.all(promises);
                localStorage.removeItem('cardStatuses');
                console.log('Migrated', promises.length, 'items from localStorage');
            }
            
            const oldTheme = localStorage.getItem('theme');
            if (oldTheme) {
                await this.saveSetting('theme', oldTheme);
                localStorage.removeItem('theme');
            }
        } catch (e) {
            console.warn('Migration failed:', e);
        }
    }

    // Private helpers
    _put(storeName, data) {
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    _getAll(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    _clear(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }
}

const db = new AnkiDatabase();

// ========================================
// DOM Elements (cached)
// ========================================
const elements = {};

function cacheElements() {
    elements.splash = document.getElementById('splash');
    elements.menuBtn = document.getElementById('menuBtn');
    elements.themeBtn = document.getElementById('themeBtn');
    elements.shuffleBtn = document.getElementById('shuffleBtn');
    elements.sidebar = document.getElementById('sidebar');
    elements.overlay = document.getElementById('overlay');
    elements.closeSidebar = document.getElementById('closeSidebar');
    elements.topicList = document.getElementById('topicList');
    elements.searchInput = document.getElementById('searchInput');
    elements.randomMode = document.getElementById('randomMode');
    elements.totalCards = document.getElementById('totalCards');
    elements.clearProgress = document.getElementById('clearProgress');
    elements.progressBarMini = document.getElementById('progressBarMini');
    elements.knownCount = document.getElementById('knownCount');
    elements.unknownCount = document.getElementById('unknownCount');
    elements.topicView = document.getElementById('topicView');
    elements.studyView = document.getElementById('studyView');
    elements.currentTopic = document.getElementById('currentTopic');
    elements.cardCounter = document.getElementById('cardCounter');
    elements.cardsContainer = document.getElementById('cardsContainer');
    elements.studyAllBtn = document.getElementById('studyAllBtn');
    elements.welcomeRandom = document.getElementById('welcomeRandom');
    elements.backBtn = document.getElementById('backBtn');
    elements.progressText = document.getElementById('progressText');
    elements.progressPercent = document.getElementById('progressPercent');
    elements.progressFill = document.getElementById('progressFill');
    elements.cardDots = document.getElementById('cardDots');
    elements.flashcard = document.getElementById('flashcard');
    elements.cardInner = document.querySelector('.card-inner');
    elements.cardTerm = document.getElementById('cardTerm');
    elements.cardEnglish = document.getElementById('cardEnglish');
    elements.cardRussian = document.getElementById('cardRussian');
    elements.cardCode = document.getElementById('cardCode');
    elements.codeSection = document.getElementById('codeSection');
    elements.prevCard = document.getElementById('prevCard');
    elements.nextCard = document.getElementById('nextCard');
    elements.cardArea = document.getElementById('cardArea');
    elements.flipBtn = document.getElementById('flipBtn');
    elements.knowBtn = document.getElementById('knowBtn');
    elements.dontKnowBtn = document.getElementById('dontKnowBtn');
    elements.toast = document.getElementById('toast');
    elements.globalSearch = document.getElementById('globalSearch');
    elements.globalSearchResults = document.getElementById('globalSearchResults');
    elements.cardFilter = document.getElementById('cardFilter');
    elements.errorsOnlyMode = document.getElementById('errorsOnlyMode');
    elements.examMode = document.getElementById('examMode');
    elements.mdnLink = document.getElementById('mdnLink');
    elements.copyCodeBtn = document.getElementById('copyCodeBtn');
}

// ========================================
// Initialization
// ========================================
async function init() {
    if (state.isInitialized) return;
    
    try {
        // Cache DOM elements
        cacheElements();
        
        // Initialize database
        await db.init();
        await db.migrateFromLocalStorage();
        
        // Load theme
        state.theme = await db.getSetting('theme', 'dark');
        applyTheme(state.theme);
        
        // Load manifest
        await loadManifest();
        
        // Build all cards index for search
        await buildCardsIndex();
        
        // Setup UI
        renderCategories();
        setupEventListeners();
        setupSwipeGestures();
        setupKeyboardNavigation();
        updateProgressStats();
        
        // Mark as initialized
        state.isInitialized = true;
        
        // Hide splash
        state.timers.splash = setTimeout(() => {
            elements.splash?.classList.add('hidden');
        }, 1500);
        
    } catch (error) {
        console.error('Init failed:', error);
        showError('Ошибка загрузки приложения');
    }
}

// ========================================
// Data Loading (Lazy Loading with AbortController)
// ========================================
async function loadManifest() {
    // Try cache first
    const cached = await db.getCachedManifest();
    if (cached) {
        state.manifest = cached;
    }
    
    try {
        const response = await fetch('data/manifest.json');
        if (response.ok) {
            state.manifest = await response.json();
            await db.cacheManifest(state.manifest);
        }
    } catch (e) {
        console.warn('Failed to load manifest:', e);
        if (!state.manifest) {
            throw new Error('No manifest available');
        }
    }
}

async function loadCategory(categoryId) {
    // Return cached if exists
    if (state.categories.has(categoryId)) {
        return state.categories.get(categoryId);
    }
    
    // Try IndexedDB cache
    const cached = await db.getCachedCategory(categoryId);
    if (cached) {
        state.categories.set(categoryId, cached);
        return cached;
    }
    
    // Fetch from network
    const categoryInfo = state.manifest?.categories?.find(c => c.id === categoryId);
    if (!categoryInfo) return null;
    
    try {
        const response = await fetch(categoryInfo.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        state.categories.set(categoryId, data);
        await db.cacheCategory(categoryId, data);
        return data;
    } catch (e) {
        console.error('Failed to load category:', categoryId, e);
        return null;
    }
}

async function loadAllCategories() {
    if (!state.manifest?.categories) return;
    const promises = state.manifest.categories.map(c => loadCategory(c.id));
    await Promise.all(promises);
}

async function buildCardsIndex() {
    await loadAllCategories();
    
    state.allCards = [];
    for (const [categoryId, category] of state.categories) {
        if (!category?.topics) continue;
        for (const topic of category.topics) {
            if (!topic?.cards) continue;
            for (const card of topic.cards) {
                if (card) {
                    state.allCards.push({
                        ...card,
                        topicId: topic.id,
                        topicTitle: topic.title,
                        categoryId,
                        cardId: getCardId(card)
                    });
                }
            }
        }
    }
    
    if (elements.totalCards) {
        elements.totalCards.textContent = `${state.allCards.length} карточек`;
    }
}

// ========================================
// UI Rendering
// ========================================
function renderCategories() {
    if (!elements.topicList || !state.manifest) return;
    
    const fragment = document.createDocumentFragment();
    
    state.manifest.categories.forEach(category => {
        const header = document.createElement('li');
        header.className = 'category-header';
        header.textContent = category.name;
        fragment.appendChild(header);
        
        const topicsContainer = document.createElement('ul');
        topicsContainer.className = 'category-topics';
        topicsContainer.dataset.categoryId = category.id;
        fragment.appendChild(topicsContainer);
        
        loadCategory(category.id).then(catData => {
            if (catData?.topics) {
                renderCategoryTopics(topicsContainer, catData.topics);
            }
        }).catch(console.error);
    });
    
    elements.topicList.innerHTML = '';
    elements.topicList.appendChild(fragment);
}

function renderCategoryTopics(container, topics) {
    if (!container || !topics) return;
    
    const fragment = document.createDocumentFragment();
    
    topics.forEach(topic => {
        if (!topic) return;
        const li = document.createElement('li');
        li.className = 'topic-item';
        li.dataset.topicId = topic.id;
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'topic-name';
        nameDiv.textContent = topic.title || '';
        
        const countDiv = document.createElement('div');
        countDiv.className = 'topic-count';
        countDiv.textContent = `${topic.cards?.length || 0} карточек`;
        
        li.appendChild(nameDiv);
        li.appendChild(countDiv);
        fragment.appendChild(li);
    });
    
    container.innerHTML = '';
    container.appendChild(fragment);
}

async function renderCardsGrid() {
    if (!elements.cardsContainer || !state.currentTopic) return;
    
    // Abort previous loading if any
    if (state.abortControllers.cardLoading) {
        state.abortControllers.cardLoading.abort();
    }
    state.abortControllers.cardLoading = new AbortController();
    
    let cards = [...(state.currentTopic.cards || [])];
    
    if (state.cardFilter === 'unknown') {
        const unknownIds = await db.getProgressByStatus('unknown');
        cards = cards.filter(c => unknownIds.includes(getCardId(c)));
    } else if (state.cardFilter === 'unstudied') {
        const allProgress = await db.getAllProgress();
        cards = cards.filter(c => !allProgress[getCardId(c)]);
    }
    
    if (cards.length === 0) {
        elements.cardsContainer.innerHTML = `
            <div class="welcome">
                <div class="welcome-icon">🔍</div>
                <h3>Нет карточек</h3>
                <p>По выбранному фильтру нет карточек</p>
            </div>
        `;
        return;
    }
    
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    
    // Use event delegation for grid clicks
    grid.addEventListener('click', handleGridClick);
    
    for (const card of cards) {
        if (state.abortControllers.cardLoading.signal.aborted) break;
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'mini-card';
        cardDiv.dataset.index = String(cards.indexOf(card));
        cardDiv.dataset.cardId = getCardId(card);
        
        const status = await db.getProgress(getCardId(card));
        if (status === 'known') cardDiv.classList.add('status-known');
        if (status === 'unknown') cardDiv.classList.add('status-unknown');
        
        const termDiv = document.createElement('div');
        termDiv.className = 'mini-card-term';
        termDiv.textContent = card.term || '';
        
        const previewDiv = document.createElement('div');
        previewDiv.className = 'mini-card-preview';
        previewDiv.textContent = card.english || '';
        
        cardDiv.appendChild(termDiv);
        cardDiv.appendChild(previewDiv);
        grid.appendChild(cardDiv);
    }
    
    if (!state.abortControllers.cardLoading.signal.aborted) {
        fragment.appendChild(grid);
        elements.cardsContainer.innerHTML = '';
        elements.cardsContainer.appendChild(fragment);
    }
}

function handleGridClick(e) {
    const card = e.target?.closest('.mini-card');
    if (card) {
        const index = parseInt(card.dataset.index, 10);
        if (!isNaN(index)) {
            startStudy(index);
        }
    }
}

// ========================================
// Search (with debounce and AbortController)
// ========================================
function setupSearch() {
    if (!elements.searchInput) return;
    
    const debouncedSearch = debounce((value) => {
        performSearch(value);
    }, 150);
    
    elements.searchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });
}

function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

function performSearch(query) {
    // Cancel previous search
    if (state.abortControllers.search) {
        state.abortControllers.search.abort();
    }
    state.abortControllers.search = new AbortController();
    
    const normalized = query.toLowerCase().trim();
    
    if (!normalized) {
        renderCategories();
        return;
    }
    
    const allTopics = [];
    for (const category of state.categories.values()) {
        if (!category?.topics) continue;
        for (const topic of category.topics) {
            if (topic) {
                allTopics.push({ ...topic, categoryName: category.name });
            }
        }
    }
    
    const filtered = allTopics.filter(t => 
        t.title?.toLowerCase().includes(normalized)
    );
    
    renderFilteredTopics(filtered);
}

function renderFilteredTopics(topics) {
    if (!elements.topicList) return;
    
    const fragment = document.createDocumentFragment();
    
    (topics || []).forEach(topic => {
        const li = document.createElement('li');
        li.className = 'topic-item';
        li.dataset.topicId = topic.id;
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'topic-name';
        nameDiv.textContent = topic.title || '';
        
        const catDiv = document.createElement('div');
        catDiv.className = 'topic-category';
        catDiv.textContent = topic.categoryName || '';
        
        const countDiv = document.createElement('div');
        countDiv.className = 'topic-count';
        countDiv.textContent = `${topic.cards?.length || 0} карточек`;
        
        li.appendChild(nameDiv);
        if (topic.categoryName) li.appendChild(catDiv);
        li.appendChild(countDiv);
        fragment.appendChild(li);
    });
    
    elements.topicList.innerHTML = '';
    elements.topicList.appendChild(fragment);
}

// ========================================
// Global Card Search
// ========================================
function setupGlobalSearch() {
    if (!elements.globalSearch) return;
    
    let searchController = null;
    
    elements.globalSearch.addEventListener('input', (e) => {
        clearTimeout(state.timers.search);
        
        // Cancel previous search
        if (searchController) {
            searchController.abort();
        }
        searchController = new AbortController();
        
        state.timers.search = setTimeout(() => {
            performGlobalCardSearch(e.target.value, searchController.signal);
        }, 200);
    });
    
    // Close search on outside click (use single handler)
    if (!state.handlers.globalSearchClick) {
        state.handlers.globalSearchClick = (e) => {
            if (!e.target.closest('.global-search-container')) {
                hideGlobalSearchResults();
            }
        };
        document.addEventListener('click', state.handlers.globalSearchClick);
    }
}

function performGlobalCardSearch(query, signal) {
    const normalized = query.toLowerCase().trim();
    
    if (!normalized || normalized.length < 2) {
        hideGlobalSearchResults();
        return;
    }
    
    if (signal.aborted) return;
    
    const results = state.allCards.filter(card => 
        card.term?.toLowerCase().includes(normalized) ||
        card.english?.toLowerCase().includes(normalized) ||
        card.russian?.toLowerCase().includes(normalized)
    ).slice(0, 10);
    
    if (signal.aborted) return;
    
    renderGlobalSearchResults(results);
}

function renderGlobalSearchResults(results) {
    if (!elements.globalSearchResults) return;
    
    if (results.length === 0) {
        elements.globalSearchResults.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
        elements.globalSearchResults.classList.add('show');
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    results.forEach(card => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
            <div class="search-result-term">${escapeHtml(card.term)}</div>
            <div class="search-result-topic">${escapeHtml(card.topicTitle)}</div>
        `;
        item.addEventListener('click', () => {
            selectTopic(card.topicId, card.cardId);
            hideGlobalSearchResults();
        });
        fragment.appendChild(item);
    });
    
    elements.globalSearchResults.innerHTML = '';
    elements.globalSearchResults.appendChild(fragment);
    elements.globalSearchResults.classList.add('show');
}

function hideGlobalSearchResults() {
    elements.globalSearchResults?.classList.remove('show');
}

// ========================================
// Topic Selection
// ========================================
async function selectTopic(topicId, specificCardId = null) {
    let topic = null;
    let categoryId = null;
    
    for (const [catId, category] of state.categories) {
        if (!category?.topics) continue;
        const found = category.topics.find(t => t.id === topicId);
        if (found) {
            topic = found;
            categoryId = catId;
            break;
        }
    }
    
    if (!topic?.cards) return;
    
    state.currentTopic = topic;
    state.isRandomMode = false;
    state.isExamMode = false;
    state.isErrorsOnlyMode = false;
    
    await applyCardFilter();
    
    if (state.currentCards.length === 0) {
        showToast('Нет карточек по выбранному фильтру');
        return;
    }
    
    if (specificCardId) {
        const index = state.currentCards.findIndex(c => getCardId(c) === specificCardId);
        if (index !== -1) {
            state.currentIndex = index;
        }
    }
    
    if (elements.currentTopic) {
        elements.currentTopic.textContent = topic.title;
    }
    if (elements.cardCounter) {
        elements.cardCounter.textContent = `${state.currentCards.length} карточек`;
    }
    if (elements.studyAllBtn) {
        elements.studyAllBtn.style.display = 'flex';
    }
    
    document.querySelectorAll('.topic-item').forEach(item => {
        item.classList.toggle('active', item.dataset.topicId === topicId);
    });
    
    renderCardsGrid();
    showView('topic');
    closeSidebar();
}

async function applyCardFilter() {
    let cards = [...(state.currentTopic?.cards || [])];
    
    if (state.cardFilter === 'unknown') {
        const unknownIds = await db.getProgressByStatus('unknown');
        cards = cards.filter(c => unknownIds.includes(getCardId(c)));
    } else if (state.cardFilter === 'unstudied') {
        const allProgress = await db.getAllProgress();
        cards = cards.filter(c => !allProgress[getCardId(c)]);
    }
    
    state.currentCards = cards;
    state.currentIndex = 0;
}

// ========================================
// Study Modes
// ========================================
function startStudy(startIndex = 0) {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    state.currentIndex = Math.max(0, Math.min(startIndex, state.currentCards.length - 1));
    state.isFlipped = false;
    
    updateCard();
    renderCardDots();
    showView('study');
}

async function startErrorsOnlyMode() {
    const unknownIds = await db.getProgressByStatus('unknown');
    
    if (unknownIds.length === 0) {
        showToast('Нет карточек для повторения');
        return;
    }
    
    const errorCards = [];
    for (const card of state.allCards) {
        if (unknownIds.includes(card.cardId)) {
            errorCards.push(card);
        }
    }
    
    if (errorCards.length === 0) {
        showToast('Нет карточек для повторения');
        return;
    }
    
    state.currentCards = errorCards;
    state.currentTopic = { title: '🔴 Только ошибки', cards: errorCards };
    state.currentIndex = 0;
    state.isRandomMode = false;
    state.isExamMode = false;
    state.isErrorsOnlyMode = true;
    
    if (elements.currentTopic) {
        elements.currentTopic.textContent = 'Только ошибки';
    }
    if (elements.cardCounter) {
        elements.cardCounter.textContent = `${errorCards.length} карточек`;
    }
    if (elements.studyAllBtn) {
        elements.studyAllBtn.style.display = 'none';
    }
    
    document.querySelectorAll('.topic-item').forEach(item => {
        item.classList.remove('active');
    });
    
    startStudy(0);
    showToast(`Повторяем ${errorCards.length} карточек`);
    closeSidebar();
}

function startExamMode() {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) {
        showToast('Сначала выберите тему');
        return;
    }
    
    state.isExamMode = true;
    state.isFlipped = false;
    state.currentIndex = 0;
    
    state.currentCards = shuffleArray([...state.currentCards]);
    
    elements.flashcard?.classList.remove('flipped');
    
    updateCard();
    renderCardDots();
    
    showToast('Режим экзамена: отвечайте без подсказок');
}

function endExamMode() {
    state.isExamMode = false;
}

// ========================================
// Card Display & Interactions
// ========================================
async function updateCard() {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    const card = state.currentCards[state.currentIndex];
    if (!card) return;
    
    if (state.isExamMode && state.isFlipped) {
        elements.flashcard?.classList.remove('flipped');
        state.isFlipped = false;
    } else if (!state.isExamMode) {
        elements.flashcard?.classList.remove('flipped');
        state.isFlipped = false;
    }
    
    if (elements.cardTerm) {
        elements.cardTerm.textContent = card.term || '';
    }
    if (elements.cardEnglish) {
        elements.cardEnglish.textContent = card.english || '';
    }
    if (elements.cardRussian) {
        elements.cardRussian.textContent = card.russian || '';
    }
    
    if (elements.codeSection && elements.cardCode) {
        if (card.example) {
            elements.codeSection.style.display = 'block';
            elements.cardCode.innerHTML = highlightCode(card.example);
            if (elements.copyCodeBtn) {
                elements.copyCodeBtn.style.display = 'flex';
            }
        } else {
            elements.codeSection.style.display = 'none';
            if (elements.copyCodeBtn) {
                elements.copyCodeBtn.style.display = 'none';
            }
        }
    }
    
    updateMdnLink(card.term);
    
    const total = state.currentCards.length;
    const current = state.currentIndex + 1;
    const percent = Math.round((current / total) * 100);
    
    if (elements.progressText) {
        elements.progressText.textContent = `${current} / ${total}`;
    }
    if (elements.progressPercent) {
        elements.progressPercent.textContent = `${percent}%`;
    }
    if (elements.progressFill) {
        elements.progressFill.style.width = `${percent}%`;
    }
    
    if (elements.prevCard) {
        elements.prevCard.disabled = state.currentIndex === 0;
    }
    if (elements.nextCard) {
        elements.nextCard.disabled = state.currentIndex === total - 1;
    }
    
    updateCardDots();
}

function updateMdnLink(term) {
    if (!elements.mdnLink || !term) return;
    
    const mdnTerm = term.toLowerCase().replace(/\s+/g, '_');
    const mdnUrl = `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/${mdnTerm}`;
    
    elements.mdnLink.href = mdnUrl;
    elements.mdnLink.style.display = 'inline-flex';
}

async function copyCode() {
    const card = state.currentCards[state.currentIndex];
    if (!card?.example) return;
    
    try {
        await navigator.clipboard.writeText(card.example);
        showToast('Код скопирован!');
    } catch (e) {
        showToast('Не удалось скопировать');
    }
}

async function markCard(status) {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    const card = state.currentCards[state.currentIndex];
    if (!card) return;
    
    const cardId = getCardId(card);
    if (!cardId) return;
    
    await db.saveProgress(cardId, status);
    
    updateCardDots();
    updateProgressStats();
    
    const message = status === 'known' ? '✓ Отмечено как изученное' : '✗ Будем повторять';
    showToast(message);
    
    clearTimeout(state.timers.navigation);
    state.timers.navigation = setTimeout(() => {
        if (state.currentIndex < state.currentCards.length - 1) {
            navigateCard(1);
        } else if (state.isExamMode) {
            showExamResults();
        }
    }, 600);
}

function showExamResults() {
    let known = 0;
    let unknown = 0;
    
    showToast(`Экзамен завершен! Изучено: ${known}, На повтор: ${unknown}`);
    
    setTimeout(() => {
        goToTopicView();
        state.isExamMode = false;
    }, 2000);
}

// ========================================
// Event Listeners (with cleanup tracking)
// ========================================
const eventListeners = [];

function addTrackedListener(element, event, handler, options) {
    if (!element) return;
    element.addEventListener(event, handler, options);
    eventListeners.push({ element, event, handler, options });
}

function setupEventListeners() {
    // Clean up old listeners first
    removeAllEventListeners();
    
    // Sidebar
    addTrackedListener(elements.menuBtn, 'click', openSidebar);
    addTrackedListener(elements.closeSidebar, 'click', closeSidebar);
    addTrackedListener(elements.overlay, 'click', closeSidebar);
    
    // Search
    setupSearch();
    setupGlobalSearch();
    
    // Filters
    addTrackedListener(elements.cardFilter, 'change', handleCardFilterChange);
    
    // Special modes
    addTrackedListener(elements.errorsOnlyMode, 'click', startErrorsOnlyMode);
    addTrackedListener(elements.examMode, 'click', startExamMode);
    addTrackedListener(elements.randomMode, 'click', startRandomMode);
    addTrackedListener(elements.welcomeRandom, 'click', startRandomMode);
    
    // Theme
    addTrackedListener(elements.themeBtn, 'click', toggleTheme);
    
    // Topic selection (delegation)
    addTrackedListener(elements.topicList, 'click', handleTopicListClick);
    
    // Shuffle
    addTrackedListener(elements.shuffleBtn, 'click', () => {
        shuffleCards();
        showToast('Карточки перемешаны');
    });
    
    // Study
    addTrackedListener(elements.studyAllBtn, 'click', () => startStudy(0));
    addTrackedListener(elements.backBtn, 'click', goToTopicView);
    
    // Card interactions
    addTrackedListener(elements.flashcard, 'click', handleFlashcardClick);
    addTrackedListener(elements.flipBtn, 'click', flipCard);
    addTrackedListener(elements.prevCard, 'click', () => navigateCard(-1));
    addTrackedListener(elements.nextCard, 'click', () => navigateCard(1));
    addTrackedListener(elements.copyCodeBtn, 'click', (e) => {
        e.stopPropagation();
        copyCode();
    });
    
    // Progress
    addTrackedListener(elements.clearProgress, 'click', clearProgress);
    
    // Visibility
    addTrackedListener(document, 'visibilitychange', handleVisibilityChange);
    addTrackedListener(window, 'beforeunload', handleBeforeUnload);
    addTrackedListener(window, 'pagehide', handlePageHide);
}

function handleCardFilterChange(e) {
    state.cardFilter = e.target.value;
    if (state.currentTopic) {
        applyCardFilter().then(() => renderCardsGrid());
    }
}

function handleTopicListClick(e) {
    const topicItem = e.target?.closest('.topic-item');
    if (topicItem?.dataset.topicId) {
        selectTopic(topicItem.dataset.topicId);
    }
}

function removeAllEventListeners() {
    eventListeners.forEach(({ element, event, handler, options }) => {
        if (element) {
            element.removeEventListener(event, handler, options);
        }
    });
    eventListeners.length = 0;
}

// ========================================
// Theme Functions
// ========================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (elements.themeBtn) {
        elements.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

async function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    await db.saveSetting('theme', state.theme);
}

// ========================================
// Utility Functions
// ========================================
function getCardId(card) {
    if (!card) return '';
    const term = String(card.term || '').slice(0, 50);
    const english = String(card.english || '').slice(0, 50);
    return `${term}_${english}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function shuffleArray(array) {
    if (!Array.isArray(array)) return [];
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ========================================
// UI Helpers
// ========================================
function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    
    clearTimeout(state.timers.toast);
    state.timers.toast = setTimeout(() => {
        elements.toast?.classList.remove('show');
    }, 2000);
}

function showError(message) {
    if (elements.cardsContainer) {
        elements.cardsContainer.innerHTML = `
            <div class="welcome">
                <div class="welcome-icon">⚠️</div>
                <h3>Ошибка</h3>
                <p>${escapeHtml(message)}</p>
                <button class="welcome-btn" onclick="location.reload()">🔄 Перезагрузить</button>
            </div>
        `;
    }
}

function showView(view) {
    if (view === 'topic') {
        elements.topicView?.classList.add('active');
        elements.studyView?.classList.remove('active');
    } else if (view === 'study') {
        elements.topicView?.classList.remove('active');
        elements.studyView?.classList.add('active');
    }
}

function openSidebar() {
    elements.sidebar?.classList.add('open');
    elements.overlay?.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    elements.sidebar?.classList.remove('open');
    elements.overlay?.classList.remove('show');
    document.body.style.overflow = '';
}

// ========================================
// Progress & Stats
// ========================================
async function updateProgressStats() {
    if (!elements.knownCount || !elements.unknownCount || !elements.progressBarMini) return;
    
    try {
        const stats = await db.getStats();
        const total = state.allCards.length;
        const percent = total > 0 ? Math.round((stats.known / total) * 100) : 0;
        
        elements.knownCount.textContent = `Изучено: ${stats.known}`;
        elements.knownCount.className = stats.known > 0 ? 'known' : '';
        elements.unknownCount.textContent = `На повтор: ${stats.unknown}`;
        elements.unknownCount.className = stats.unknown > 0 ? 'unknown' : '';
        elements.progressBarMini.style.width = `${percent}%`;
    } catch (e) {
        console.error('Failed to update stats:', e);
    }
}

async function clearProgress() {
    try {
        const stats = await db.getStats();
        if (stats.total === 0) {
            showToast('Прогресс и так пуст');
            return;
        }
        
        if (!confirm('Уверены, что хотите сбросить весь прогресс?')) return;
        
        await db.clearAllProgress();
        updateProgressStats();
        renderCardsGrid();
        showToast('Прогресс очищен');
    } catch (e) {
        console.error('Failed to clear progress:', e);
        showToast('Ошибка при очистке');
    }
}

// ========================================
// Navigation
// ========================================
function navigateCard(direction) {
    if (!Array.isArray(state.currentCards)) return;
    
    const newIndex = state.currentIndex + direction;
    if (newIndex < 0 || newIndex >= state.currentCards.length) return;
    
    clearTimeout(state.timers.navigation);
    
    const swipeClass = direction > 0 ? 'swipe-left' : 'swipe-right';
    elements.flashcard?.classList.add(swipeClass);
    
    state.timers.navigation = setTimeout(() => {
        state.currentIndex = newIndex;
        state.isFlipped = false;
        updateCard();
        elements.flashcard?.classList.remove(swipeClass);
    }, 150);
}

function flipCard() {
    state.isFlipped = !state.isFlipped;
    elements.flashcard?.classList.toggle('flipped', state.isFlipped);
}

function handleFlashcardClick(e) {
    if (e.target?.closest('.action-btn') || 
        e.target?.closest('button') ||
        e.target?.closest('pre') ||
        e.target?.closest('code') ||
        e.target?.closest('a')) return;
    flipCard();
}

function goToTopicView() {
    clearTimeout(state.timers.navigation);
    showView('topic');
}

// ========================================
// Card Dots (with proper cleanup)
// ========================================
async function renderCardDots() {
    if (!elements.cardDots || !Array.isArray(state.currentCards)) return;
    
    const total = state.currentCards.length;
    const maxDots = Math.min(total, 50);
    
    if (total > maxDots) {
        elements.cardDots.innerHTML = '<span class="dots-overflow">...</span>';
        return;
    }
    
    // Clear old handlers
    state.handlers.dotClickHandlers.forEach((handler, dot) => {
        dot.removeEventListener('click', handler);
    });
    state.handlers.dotClickHandlers.clear();
    
    const fragment = document.createDocumentFragment();
    let progressMap = {};
    
    try {
        progressMap = await db.getAllProgress();
    } catch (e) {
        console.error('Failed to get progress:', e);
    }
    
    state.currentCards.forEach((card, i) => {
        const dot = document.createElement('div');
        dot.className = 'card-dot';
        if (i === state.currentIndex) dot.classList.add('active');
        
        const cardId = getCardId(card);
        const status = progressMap[cardId];
        if (status === 'known') dot.classList.add('known');
        if (status === 'unknown') dot.classList.add('unknown');
        
        dot.dataset.index = String(i);
        
        const clickHandler = () => {
            state.currentIndex = i;
            updateCard();
        };
        
        dot.addEventListener('click', clickHandler);
        state.handlers.dotClickHandlers.set(dot, clickHandler);
        fragment.appendChild(dot);
    });
    
    elements.cardDots.innerHTML = '';
    elements.cardDots.appendChild(fragment);
}

async function updateCardDots() {
    if (!elements.cardDots) return;
    
    const dots = elements.cardDots.querySelectorAll('.card-dot');
    let progressMap = {};
    
    try {
        progressMap = await db.getAllProgress();
    } catch (e) {
        console.error('Failed to get progress:', e);
        return;
    }
    
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === state.currentIndex);
        
        const card = state.currentCards[i];
        if (card) {
            const status = progressMap[getCardId(card)];
            dot.classList.remove('known', 'unknown');
            if (status === 'known') dot.classList.add('known');
            if (status === 'unknown') dot.classList.add('unknown');
        }
    });
}

// ========================================
// Syntax Highlighting
// ========================================
function highlightCode(code) {
    if (typeof code !== 'string') return '';
    
    const cleanCode = code.replace(/<\/?[^>]+(>|$)/g, '');
    
    const escaped = cleanCode
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    return escaped
        .replace(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|default|try|catch|finally|throw|new|this|class|extends|super|static|get|set|import|export|from|async|await|typeof|instanceof|in|of|void|delete|with|yield)\b/g, 
            '<span class=token-keyword>$1</span>')
        .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, 
            '<span class=token-boolean>$1</span>')
        .replace(/(\/\/.*$)/gm, 
            '<span class=token-comment>$1</span>')
        .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, 
            '<span class=token-string>$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, 
            '<span class=token-number>$1</span>')
        .replace(/\b(console|Math|JSON|Object|Array|String|Number|Boolean|Date|RegExp|Promise|Set|Map|WeakMap|WeakSet|Error|window|document|localStorage|sessionStorage|fetch|navigator|history|location)\b/g, 
            '<span class=token-builtins>$1</span>');
}

// ========================================
// Random Mode
// ========================================
function startRandomMode() {
    if (state.allCards.length === 0) {
        showToast('Нет карточек для изучения');
        return;
    }
    
    state.currentCards = shuffleArray([...state.allCards]);
    state.currentTopic = { title: '🎲 Случайный режим', cards: state.currentCards };
    state.currentIndex = 0;
    state.isRandomMode = true;
    state.isExamMode = false;
    state.isErrorsOnlyMode = false;
    
    if (elements.currentTopic) {
        elements.currentTopic.textContent = 'Случайный режим';
    }
    if (elements.cardCounter) {
        elements.cardCounter.textContent = `${state.currentCards.length} карточек`;
    }
    if (elements.studyAllBtn) {
        elements.studyAllBtn.style.display = 'none';
    }
    
    document.querySelectorAll('.topic-item').forEach(item => {
        item.classList.remove('active');
    });
    
    startStudy(0);
    showToast('Случайный режим запущен');
    closeSidebar();
}

function shuffleCards() {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    state.currentCards = shuffleArray([...state.currentCards]);
    state.currentIndex = 0;
    state.isFlipped = false;
    
    if (elements.studyView?.classList.contains('active')) {
        updateCard();
        renderCardDots();
    } else {
        renderCardsGrid();
    }
}

// ========================================
// Swipe Gestures (with proper cleanup)
// ========================================
function setupSwipeGestures() {
    if (!elements.cardArea) return;
    
    cleanupSwipeHandlers();
    
    let startX = 0, startY = 0, startTime = 0, isTracking = false;
    
    state.handlers.touchStart = (e) => {
        if (!e.touches?.[0]) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        isTracking = true;
    };
    
    state.handlers.touchMove = (e) => {
        if (!isTracking || !startX || !startY || !e.touches?.[0]) return;
        
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const diffX = startX - x;
        const diffY = startY - y;
        
        if (Math.abs(diffY) > Math.abs(diffX)) return;
        
        if (Math.abs(diffX) > 10 && e.cancelable) {
            e.preventDefault();
        }
    };
    
    state.handlers.touchEnd = (e) => {
        if (!isTracking || !startX || !startY || !e.changedTouches?.[0]) return;
        
        isTracking = false;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = startX - endX;
        const diffY = startY - endY;
        const duration = Date.now() - startTime;
        
        startX = 0;
        startY = 0;
        
        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10 && duration < 300) {
            const target = e.target;
            if (target?.closest('.card-hint') || 
                target?.closest('.swipe-hint') ||
                target?.closest('button') ||
                target?.closest('pre') ||
                target?.closest('code') ||
                target?.closest('a')) {
                return;
            }
            flipCard();
            return;
        }
        
        const swipeThreshold = 50;
        const isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        
        if (isHorizontal && Math.abs(diffX) > swipeThreshold) {
            if (diffX > 0) {
                navigateCard(1);
            } else {
                navigateCard(-1);
            }
        }
    };
    
    elements.cardArea.addEventListener('touchstart', state.handlers.touchStart, { passive: true });
    elements.cardArea.addEventListener('touchmove', state.handlers.touchMove, { passive: false });
    elements.cardArea.addEventListener('touchend', state.handlers.touchEnd, { passive: true });
}

function cleanupSwipeHandlers() {
    if (!elements.cardArea) return;
    
    if (state.handlers.touchStart) {
        elements.cardArea.removeEventListener('touchstart', state.handlers.touchStart);
    }
    if (state.handlers.touchMove) {
        elements.cardArea.removeEventListener('touchmove', state.handlers.touchMove);
    }
    if (state.handlers.touchEnd) {
        elements.cardArea.removeEventListener('touchend', state.handlers.touchEnd);
    }
    
    state.handlers.touchStart = null;
    state.handlers.touchMove = null;
    state.handlers.touchEnd = null;
}

// ========================================
// Keyboard Navigation (with cleanup)
// ========================================
function setupKeyboardNavigation() {
    if (state.handlers.keyboard) {
        document.removeEventListener('keydown', state.handlers.keyboard);
    }
    
    state.handlers.keyboard = (e) => {
        if (!elements.studyView?.classList.contains('active')) return;
        
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                navigateCard(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                navigateCard(1);
                break;
            case ' ':
            case 'Enter':
                e.preventDefault();
                flipCard();
                break;
            case '1':
                e.preventDefault();
                markCard('known');
                break;
            case '2':
                e.preventDefault();
                markCard('unknown');
                break;
            case 'Escape':
                e.preventDefault();
                goToTopicView();
                break;
        }
    };
    
    document.addEventListener('keydown', state.handlers.keyboard);
}

// ========================================
// Cleanup Functions (comprehensive)
// ========================================
function handleVisibilityChange() {
    if (document.hidden) {
        // Pause non-essential operations when tab is hidden
        clearTimeout(state.timers.toast);
        clearTimeout(state.timers.navigation);
        
        // Abort ongoing searches
        if (state.abortControllers.search) {
            state.abortControllers.search.abort();
        }
    }
}

function handleBeforeUnload(e) {
    // Quick sync before leaving
    cleanup();
}

function handlePageHide(e) {
    // More aggressive cleanup when page is hidden (mobile)
    if (e.persisted) {
        // Page was cached by browser (bfcache), clean up
        cleanup();
    }
}

function cleanup() {
    if (state.isCleaningUp) return;
    state.isCleaningUp = true;
    
    console.log('[App] Cleanup started');
    
    // Clear all timers
    Object.values(state.timers).forEach(timer => clearTimeout(timer));
    
    // Abort all ongoing operations
    Object.values(state.abortControllers).forEach(controller => {
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }
    });
    
    // Remove all event listeners
    removeAllEventListeners();
    
    // Clean up keyboard handler
    if (state.handlers.keyboard) {
        document.removeEventListener('keydown', state.handlers.keyboard);
        state.handlers.keyboard = null;
    }
    
    // Clean up global search click handler
    if (state.handlers.globalSearchClick) {
        document.removeEventListener('click', state.handlers.globalSearchClick);
        state.handlers.globalSearchClick = null;
    }
    
    // Clean up swipe handlers
    cleanupSwipeHandlers();
    
    // Clean up dot handlers
    state.handlers.dotClickHandlers.forEach((handler, dot) => {
        dot.removeEventListener('click', handler);
    });
    state.handlers.dotClickHandlers.clear();
    
    // Close IndexedDB connection
    db.close();
    
    // Clear large data structures
    state.categories.clear();
    state.allCards = [];
    state.currentCards = [];
    
    state.isCleaningUp = false;
    console.log('[App] Cleanup completed');
}

// ========================================
// Start App
// ========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
