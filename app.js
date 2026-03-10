// ========================================
// App State
// ========================================
const state = {
    data: null,
    currentTopic: null,
    currentCards: [],
    currentIndex: 0,
    isFlipped: false,
    isRandomMode: false,
    theme: 'dark',
    cardStatuses: {},
    // Timers for cleanup
    timers: {
        toast: null,
        navigation: null,
        splash: null
    },
    // Event handler references for cleanup
    handlers: {
        touchStart: null,
        touchMove: null,
        touchEnd: null,
        keyboard: null
    }
};

// ========================================
// Safe LocalStorage Functions
// ========================================
function safeGetItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item !== null ? item : defaultValue;
    } catch (e) {
        console.warn('localStorage getItem failed:', e);
        return defaultValue;
    }
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn('localStorage setItem failed:', e);
        return false;
    }
}

function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (e) {
        console.warn('localStorage removeItem failed:', e);
        return false;
    }
}

function safeParseJSON(json, defaultValue = {}) {
    try {
        return JSON.parse(json);
    } catch (e) {
        console.warn('JSON parse failed:', e);
        return defaultValue;
    }
}

// Initialize state with safe localStorage access
state.theme = safeGetItem('theme', 'dark');
state.cardStatuses = safeParseJSON(safeGetItem('cardStatuses', '{}'), {});

// ========================================
// DOM Elements
// ========================================
const elements = {
    // Splash
    splash: document.getElementById('splash'),
    
    // Header
    menuBtn: document.getElementById('menuBtn'),
    themeBtn: document.getElementById('themeBtn'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    
    // Sidebar
    sidebar: document.getElementById('sidebar'),
    overlay: document.getElementById('overlay'),
    closeSidebar: document.getElementById('closeSidebar'),
    topicList: document.getElementById('topicList'),
    searchInput: document.getElementById('searchInput'),
    randomMode: document.getElementById('randomMode'),
    totalCards: document.getElementById('totalCards'),
    clearProgress: document.getElementById('clearProgress'),
    progressBarMini: document.getElementById('progressBarMini'),
    knownCount: document.getElementById('knownCount'),
    unknownCount: document.getElementById('unknownCount'),
    
    // Views
    topicView: document.getElementById('topicView'),
    studyView: document.getElementById('studyView'),
    
    // Topic View
    currentTopic: document.getElementById('currentTopic'),
    cardCounter: document.getElementById('cardCounter'),
    cardsContainer: document.getElementById('cardsContainer'),
    studyAllBtn: document.getElementById('studyAllBtn'),
    welcomeRandom: document.getElementById('welcomeRandom'),
    
    // Study View
    backBtn: document.getElementById('backBtn'),
    progressText: document.getElementById('progressText'),
    progressPercent: document.getElementById('progressPercent'),
    progressFill: document.getElementById('progressFill'),
    cardDots: document.getElementById('cardDots'),
    flashcard: document.getElementById('flashcard'),
    cardInner: document.querySelector('.card-inner'),
    cardTerm: document.getElementById('cardTerm'),
    cardEnglish: document.getElementById('cardEnglish'),
    cardRussian: document.getElementById('cardRussian'),
    cardCode: document.getElementById('cardCode'),
    codeSection: document.getElementById('codeSection'),
    prevCard: document.getElementById('prevCard'),
    nextCard: document.getElementById('nextCard'),
    cardArea: document.getElementById('cardArea'),
    flipBtn: document.getElementById('flipBtn'),
    knowBtn: document.getElementById('knowBtn'),
    dontKnowBtn: document.getElementById('dontKnowBtn'),
    
    // Toast
    toast: document.getElementById('toast')
};

// ========================================
// Initialize App
// ========================================
async function init() {
    // Apply theme
    applyTheme(state.theme);
    
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Validate data structure
        if (!data || !Array.isArray(data.topics)) {
            throw new Error('Invalid data structure: missing topics array');
        }
        
        // Validate each topic has required fields
        data.topics = data.topics.filter(topic => {
            if (!topic || typeof topic !== 'object') return false;
            if (!topic.id || typeof topic.id !== 'string') return false;
            if (!topic.title || typeof topic.title !== 'string') return false;
            if (!Array.isArray(topic.cards)) return false;
            // Validate cards
            topic.cards = topic.cards.filter(card => {
                return card && typeof card === 'object' && 
                       (card.term || card.english || card.russian);
            });
            return true;
        });
        
        state.data = data;
        
        // Calculate total cards
        const total = state.data.topics.reduce((sum, t) => sum + (t.cards?.length || 0), 0);
        if (elements.totalCards) {
            elements.totalCards.textContent = `${total} карточек`;
        }
        
        renderTopics();
        setupEventListeners();
        setupSwipeGestures();
        setupKeyboardNavigation();
        updateProgressStats();
        
        // Hide splash screen
        state.timers.splash = setTimeout(() => {
            if (elements.splash) {
                elements.splash.classList.add('hidden');
            }
        }, 1500);
        
    } catch (error) {
        console.error('Failed to load data:', error);
        showError('Ошибка загрузки данных. Пожалуйста, проверьте подключение к интернету.');
        if (elements.splash) {
            elements.splash.classList.add('hidden');
        }
    }
}

function showError(message) {
    if (elements.cardsContainer) {
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome';
        welcomeDiv.innerHTML = `
            <div class="welcome-icon">⚠️</div>
            <h3>Ошибка</h3>
            <p></p>
        `;
        welcomeDiv.querySelector('p').textContent = message;
        
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'welcome-btn';
        reloadBtn.textContent = '🔄 Перезагрузить';
        reloadBtn.addEventListener('click', () => location.reload());
        welcomeDiv.appendChild(reloadBtn);
        
        elements.cardsContainer.innerHTML = '';
        elements.cardsContainer.appendChild(welcomeDiv);
    }
}

// ========================================
// Theme Functions
// ========================================
function applyTheme(theme) {
    if (!document.documentElement || !elements.themeBtn) return;
    document.documentElement.setAttribute('data-theme', theme);
    elements.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    safeSetItem('theme', state.theme);
}

// ========================================
// Render Topics
// ========================================
function renderTopics(filter = '') {
    if (!state.data?.topics || !elements.topicList) return;
    
    const normalizedFilter = filter.toLowerCase().trim();
    const filteredTopics = state.data.topics.filter(topic => 
        topic?.title?.toLowerCase().includes(normalizedFilter)
    );
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    
    filteredTopics.forEach(topic => {
        const li = document.createElement('li');
        li.className = 'topic-item';
        li.dataset.topicId = String(topic.id || '');
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'topic-name';
        nameDiv.textContent = String(topic.title || '');
        
        const countDiv = document.createElement('div');
        countDiv.className = 'topic-count';
        countDiv.textContent = `${topic.cards?.length || 0} карточек`;
        
        li.appendChild(nameDiv);
        li.appendChild(countDiv);
        fragment.appendChild(li);
    });
    
    elements.topicList.innerHTML = '';
    elements.topicList.appendChild(fragment);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ========================================
// Setup Event Listeners (one-time setup)
// ========================================
function setupEventListeners() {
    // Sidebar
    elements.menuBtn?.addEventListener('click', openSidebar);
    elements.closeSidebar?.addEventListener('click', closeSidebar);
    elements.overlay?.addEventListener('click', closeSidebar);
    
    // Search with debounce
    let searchTimeout;
    elements.searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderTopics(e.target?.value || '');
        }, 150);
    });
    
    // Theme
    elements.themeBtn?.addEventListener('click', toggleTheme);
    
    // Topic selection (event delegation)
    elements.topicList?.addEventListener('click', (e) => {
        const topicItem = e.target?.closest('.topic-item');
        if (topicItem) {
            const topicId = topicItem.dataset.topicId;
            if (topicId) {
                selectTopic(topicId);
                closeSidebar();
            }
        }
    });
    
    // Random mode
    elements.randomMode?.addEventListener('click', () => {
        startRandomMode();
        closeSidebar();
    });
    
    elements.welcomeRandom?.addEventListener('click', startRandomMode);
    
    // Shuffle
    elements.shuffleBtn?.addEventListener('click', () => {
        shuffleCards();
        showToast('Карточки перемешаны');
    });
    
    // Study all
    elements.studyAllBtn?.addEventListener('click', () => {
        startStudy(0);
    });
    
    // Back button
    elements.backBtn?.addEventListener('click', goToTopicView);
    
    // Card flip
    elements.flashcard?.addEventListener('click', handleFlashcardClick);
    elements.flipBtn?.addEventListener('click', flipCard);
    
    // Navigation
    elements.prevCard?.addEventListener('click', () => navigateCard(-1));
    elements.nextCard?.addEventListener('click', () => navigateCard(1));
    
    // Know / Don't know buttons
    elements.knowBtn?.addEventListener('click', () => markCard('known'));
    elements.dontKnowBtn?.addEventListener('click', () => markCard('unknown'));
    
    // Clear progress button
    elements.clearProgress?.addEventListener('click', clearProgress);
    
    // Visibility change - cleanup when tab hidden
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Before unload - cleanup
    window.addEventListener('beforeunload', cleanup);
    
    // Keyboard navigation is set up separately in setupKeyboardNavigation
}

function handleFlashcardClick(e) {
    // Don't flip if clicking on buttons or interactive elements
    if (e.target?.closest('.action-btn') || 
        e.target?.closest('button') ||
        e.target?.closest('pre') ||
        e.target?.closest('code')) return;
    flipCard();
}

function handleVisibilityChange() {
    if (document.hidden) {
        // Pause any ongoing animations or timers when tab is hidden
        clearTimeout(state.timers.toast);
        clearTimeout(state.timers.navigation);
    }
}

function cleanup() {
    // Clear all timers
    Object.values(state.timers).forEach(timer => clearTimeout(timer));
    
    // Remove event listeners
    if (state.handlers.keyboard) {
        document.removeEventListener('keydown', state.handlers.keyboard);
        state.handlers.keyboard = null;
    }
    if (elements.cardArea) {
        if (state.handlers.touchStart) {
            elements.cardArea.removeEventListener('touchstart', state.handlers.touchStart);
            state.handlers.touchStart = null;
        }
        if (state.handlers.touchMove) {
            elements.cardArea.removeEventListener('touchmove', state.handlers.touchMove);
            state.handlers.touchMove = null;
        }
        if (state.handlers.touchEnd) {
            elements.cardArea.removeEventListener('touchend', state.handlers.touchEnd);
            state.handlers.touchEnd = null;
        }
    }
}

// ========================================
// Sidebar Functions
// ========================================
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
// Topic Selection
// ========================================
function selectTopic(topicId) {
    if (!state.data?.topics || !topicId) return;
    
    const topic = state.data.topics.find(t => t.id === topicId);
    if (!topic || !Array.isArray(topic.cards)) return;
    
    state.currentTopic = topic;
    state.currentCards = [...topic.cards];
    state.currentIndex = 0;
    state.isRandomMode = false;
    state.isFlipped = false;
    
    // Update active state
    document.querySelectorAll('.topic-item').forEach(item => {
        item.classList.toggle('active', item.dataset.topicId === topicId);
    });
    
    // Update header
    if (elements.currentTopic) {
        elements.currentTopic.textContent = topic.title || '';
    }
    if (elements.cardCounter) {
        elements.cardCounter.textContent = `${topic.cards.length} карточек`;
    }
    if (elements.studyAllBtn) {
        elements.studyAllBtn.style.display = 'flex';
    }
    
    // Render cards
    renderCardsGrid();
    showView('topic');
}

// ========================================
// Render Cards Grid
// ========================================
function renderCardsGrid() {
    if (!elements.cardsContainer || !Array.isArray(state.currentCards)) return;
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    
    state.currentCards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'mini-card';
        cardDiv.dataset.index = String(index);
        
        const termDiv = document.createElement('div');
        termDiv.className = 'mini-card-term';
        termDiv.textContent = String(card?.term || '');
        
        const previewDiv = document.createElement('div');
        previewDiv.className = 'mini-card-preview';
        previewDiv.textContent = String(card?.english || '');
        
        cardDiv.appendChild(termDiv);
        cardDiv.appendChild(previewDiv);
        grid.appendChild(cardDiv);
    });
    
    fragment.appendChild(grid);
    elements.cardsContainer.innerHTML = '';
    elements.cardsContainer.appendChild(fragment);
    
    // Use event delegation instead of individual listeners
    grid.addEventListener('click', (e) => {
        const card = e.target?.closest('.mini-card');
        if (card) {
            const index = parseInt(card.dataset.index, 10);
            if (!isNaN(index) && index >= 0 && index < state.currentCards.length) {
                startStudy(index);
            }
        }
    });
}

// ========================================
// Study Mode
// ========================================
function startStudy(startIndex = 0) {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    state.currentIndex = Math.max(0, Math.min(startIndex, state.currentCards.length - 1));
    state.isFlipped = false;
    showView('study');
    updateCard();
    renderCardDots();
}

function startRandomMode() {
    if (!state.data?.topics) return;
    
    const allCards = [];
    state.data.topics.forEach(topic => {
        if (Array.isArray(topic?.cards)) {
            topic.cards.forEach(card => {
                if (card) {
                    allCards.push({ ...card, topicTitle: topic.title });
                }
            });
        }
    });
    
    if (allCards.length === 0) {
        showToast('Нет карточек для изучения');
        return;
    }
    
    state.currentCards = shuffleArray(allCards);
    state.currentTopic = { title: '🎲 Случайный режим', cards: state.currentCards };
    state.currentIndex = 0;
    state.isRandomMode = true;
    state.isFlipped = false;
    
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

function shuffleArray(array) {
    if (!Array.isArray(array)) return [];
    const arr = [...array];
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ========================================
// Card Display
// ========================================
function updateCard() {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    const card = state.currentCards[state.currentIndex];
    if (!card) return;
    
    // Reset flip
    elements.flashcard?.classList.remove('flipped');
    state.isFlipped = false;
    
    // Update content safely using textContent
    if (elements.cardTerm) {
        elements.cardTerm.textContent = String(card.term || '');
    }
    if (elements.cardEnglish) {
        elements.cardEnglish.textContent = String(card.english || '');
    }
    if (elements.cardRussian) {
        elements.cardRussian.textContent = String(card.russian || '');
    }
    
    // Code with syntax highlighting
    if (elements.codeSection && elements.cardCode) {
        if (card.example) {
            elements.codeSection.style.display = 'block';
            elements.cardCode.innerHTML = highlightCode(String(card.example));
        } else {
            elements.codeSection.style.display = 'none';
            elements.cardCode.innerHTML = '';
        }
    }
    
    // Progress
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
    
    // Navigation buttons
    if (elements.prevCard) {
        elements.prevCard.disabled = state.currentIndex === 0;
    }
    if (elements.nextCard) {
        elements.nextCard.disabled = state.currentIndex === total - 1;
    }
    
    // Update dots
    updateCardDots();
}

// ========================================
// Syntax Highlighting
// ========================================
function stripHtmlTags(text) {
    if (typeof text !== 'string') return '';
    // Use regex to remove HTML tags - safer than DOM manipulation
    return text.replace(/<[^>]*>/g, '');
}

function highlightCode(code) {
    if (typeof code !== 'string') return '';
    
    // First strip any existing HTML tags from the data
    const cleanCode = stripHtmlTags(code);
    
    // Escape HTML entities
    const escaped = cleanCode
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Apply syntax highlighting
    return escaped
        .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|default|try|catch|finally|throw|new|this|class|extends|super|static|get|set|import|export|from|async|await|typeof|instanceof|in|of|void|delete|with|yield)\b/g, 
            '<span class="token-keyword">$1</span>')
        .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, 
            '<span class="token-boolean">$1</span>')
        .replace(/(\/\/.*$)/gm, 
            '<span class="token-comment">$1</span>')
        .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, 
            '<span class="token-string">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, 
            '<span class="token-number">$1</span>')
        .replace(/\b(console|Math|JSON|Object|Array|String|Number|Boolean|Date|RegExp|Promise|Set|Map|WeakMap|WeakSet|Error|window|document|localStorage|sessionStorage|fetch|navigator|history|location)\b/g, 
            '<span class="token-builtins">$1</span>');
}

// ========================================
// Card Dots Navigation
// ========================================
function renderCardDots() {
    if (!elements.cardDots || !Array.isArray(state.currentCards)) return;
    
    const total = state.currentCards.length;
    // Limit dots for performance with many cards
    const maxDots = Math.min(total, 50);
    const showDots = total <= maxDots;
    
    if (!showDots) {
        elements.cardDots.innerHTML = '<span class="dots-overflow">...</span>';
        return;
    }
    
    // Use DocumentFragment
    const fragment = document.createDocumentFragment();
    state.currentCards.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = `card-dot ${i === state.currentIndex ? 'active' : ''}`;
        dot.dataset.index = String(i);
        dot.setAttribute('role', 'button');
        dot.setAttribute('aria-label', `Карточка ${i + 1}`);
        fragment.appendChild(dot);
    });
    
    elements.cardDots.innerHTML = '';
    elements.cardDots.appendChild(fragment);
    
    // Event delegation for dots
    elements.cardDots.onclick = (e) => {
        const dot = e.target?.closest('.card-dot');
        if (dot) {
            const index = parseInt(dot.dataset.index, 10);
            if (!isNaN(index) && index >= 0 && index < state.currentCards.length) {
                state.currentIndex = index;
                updateCard();
            }
        }
    };
}

function updateCardDots() {
    if (!elements.cardDots) return;
    
    const dots = elements.cardDots.querySelectorAll('.card-dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === state.currentIndex);
        
        // Add status classes
        const card = state.currentCards[i];
        if (card) {
            const cardId = getCardId(card);
            dot.classList.remove('known', 'unknown');
            if (state.cardStatuses[cardId] === 'known') dot.classList.add('known');
            if (state.cardStatuses[cardId] === 'unknown') dot.classList.add('unknown');
        }
    });
}

function getCardId(card) {
    if (!card) return '';
    // Create a safe ID from term and english fields
    const term = String(card.term || '').slice(0, 50);
    const english = String(card.english || '').slice(0, 50);
    return `${term}_${english}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

// ========================================
// Card Actions
// ========================================
function flipCard() {
    state.isFlipped = !state.isFlipped;
    elements.flashcard?.classList.toggle('flipped', state.isFlipped);
}

function navigateCard(direction) {
    if (!Array.isArray(state.currentCards)) return;
    
    const newIndex = state.currentIndex + direction;
    if (newIndex < 0 || newIndex >= state.currentCards.length) return;
    
    // Clear pending navigation timer
    clearTimeout(state.timers.navigation);
    
    // Add swipe animation class
    const swipeClass = direction > 0 ? 'swipe-left' : 'swipe-right';
    elements.flashcard?.classList.add(swipeClass);
    
    state.timers.navigation = setTimeout(() => {
        state.currentIndex = newIndex;
        state.isFlipped = false;
        updateCard();
        elements.flashcard?.classList.remove(swipeClass);
    }, 150);
}

function markCard(status) {
    if (!Array.isArray(state.currentCards) || state.currentCards.length === 0) return;
    
    const card = state.currentCards[state.currentIndex];
    if (!card) return;
    
    const cardId = getCardId(card);
    if (!cardId) return;
    
    state.cardStatuses[cardId] = status;
    
    safeSetItem('cardStatuses', JSON.stringify(state.cardStatuses));
    
    updateCardDots();
    updateProgressStats();
    
    const message = status === 'known' ? '✓ Отмечено как изученное' : '✗ Будем повторять';
    showToast(message);
    
    // Clear pending auto-advance
    clearTimeout(state.timers.navigation);
    
    // Auto-advance after marking
    state.timers.navigation = setTimeout(() => {
        if (state.currentIndex < state.currentCards.length - 1) {
            navigateCard(1);
        }
    }, 600);
}

// ========================================
// Progress Statistics
// ========================================
function updateProgressStats() {
    if (!elements.knownCount || !elements.unknownCount || !elements.progressBarMini) return;
    
    const statuses = Object.values(state.cardStatuses);
    const known = statuses.filter(s => s === 'known').length;
    const unknown = statuses.filter(s => s === 'unknown').length;
    const total = state.data?.topics?.reduce((sum, t) => sum + (t.cards?.length || 0), 0) || 0;
    
    const percent = total > 0 ? Math.round((known / total) * 100) : 0;
    
    elements.knownCount.textContent = `Изучено: ${known}`;
    elements.knownCount.className = known > 0 ? 'known' : '';
    elements.unknownCount.textContent = `На повтор: ${unknown}`;
    elements.unknownCount.className = unknown > 0 ? 'unknown' : '';
    elements.progressBarMini.style.width = `${percent}%`;
}

function clearProgress() {
    if (Object.keys(state.cardStatuses).length === 0) {
        showToast('Прогресс и так пуст');
        return;
    }
    
    if (!confirm('Уверены, что хотите сбросить весь прогресс? Это действие нельзя отменить.')) {
        return;
    }
    
    state.cardStatuses = {};
    
    safeRemoveItem('cardStatuses');
    
    updateProgressStats();
    updateCardDots();
    showToast('Прогресс очищен');
}

// ========================================
// View Management
// ========================================
function showView(view) {
    if (view === 'topic') {
        elements.topicView?.classList.add('active');
        elements.studyView?.classList.remove('active');
    } else if (view === 'study') {
        elements.topicView?.classList.remove('active');
        elements.studyView?.classList.add('active');
    }
}

function goToTopicView() {
    // Clear any pending timers when leaving study view
    clearTimeout(state.timers.navigation);
    showView('topic');
}

// ========================================
// Swipe Gestures (with proper cleanup)
// ========================================
function setupSwipeGestures() {
    if (!elements.cardArea) return;
    
    // Clean up existing listeners first
    cleanup();
    
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isTracking = false;
    
    // Touch start
    state.handlers.touchStart = (e) => {
        if (!e.touches?.[0]) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        isTracking = true;
    };
    
    // Touch move
    state.handlers.touchMove = (e) => {
        if (!isTracking || !startX || !startY || !e.touches?.[0]) return;
        
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const diffX = startX - x;
        const diffY = startY - y;
        
        // Let browser handle vertical scroll
        if (Math.abs(diffY) > Math.abs(diffX)) {
            return;
        }
        
        // Prevent default only for horizontal swipes (check if cancelable first)
        if (Math.abs(diffX) > 10 && e.cancelable) {
            e.preventDefault();
        }
    };
    
    // Touch end
    state.handlers.touchEnd = (e) => {
        if (!isTracking || !startX || !startY || !e.changedTouches?.[0]) return;
        
        isTracking = false;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = startX - endX;
        const diffY = startY - endY;
        const duration = Date.now() - startTime;
        
        // Reset
        startX = 0;
        startY = 0;
        
        // Tap detection (for flip)
        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10 && duration < 300) {
            // Don't flip if clicking on specific elements
            const target = e.target;
            if (target?.closest('.card-hint') || 
                target?.closest('.swipe-hint') ||
                target?.closest('button') ||
                target?.closest('pre') ||
                target?.closest('code')) {
                return;
            }
            flipCard();
            return;
        }
        
        // Swipe detection
        const swipeThreshold = 50;
        const isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        
        if (isHorizontal && Math.abs(diffX) > swipeThreshold) {
            if (diffX > 0) {
                navigateCard(1); // Swipe left - next
            } else {
                navigateCard(-1); // Swipe right - previous
            }
        }
    };
    
    // Add listeners with capture options for proper cleanup
    elements.cardArea.addEventListener('touchstart', state.handlers.touchStart, { passive: true });
    elements.cardArea.addEventListener('touchmove', state.handlers.touchMove, { passive: false });
    elements.cardArea.addEventListener('touchend', state.handlers.touchEnd, { passive: true });
}

// ========================================
// Keyboard Navigation
// ========================================
function setupKeyboardNavigation() {
    // Remove old listener if exists
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
                e.preventDefault();
                if (!state.isFlipped) {
                    flipCard();
                } else {
                    navigateCard(1);
                }
                break;
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
// Toast Notifications (with cleanup)
// ========================================
function showToast(message) {
    if (!elements.toast) return;
    
    // Clear existing timer
    clearTimeout(state.timers.toast);
    
    elements.toast.textContent = String(message);
    elements.toast.classList.add('show');
    
    state.timers.toast = setTimeout(() => {
        elements.toast?.classList.remove('show');
    }, 2000);
}

// ========================================
// Service Worker Registration
// ========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('[App] Service Worker registered');
                
                // Check for updates
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker?.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showToast('Доступно обновление! Перезагрузите приложение.');
                        }
                    });
                });
            })
            .catch(err => console.log('[App] Service Worker registration failed:', err));
    });
}

// ========================================
// Start App
// ========================================
init();
