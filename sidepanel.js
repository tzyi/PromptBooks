// PromptBooks — The Digital Archivist
// Chrome Extension Side Panel — Main Application Logic

'use strict';

// ============================================================
// AI 平台注入函數（此函數會被序列化並注入到目標分頁；必須完全獨立，不可依賴外部變數）
// ============================================================

function _injectAndSubmit(text) {
  return new Promise((resolve) => {
    const h = window.location.hostname;
    let platform = null;
    if (h.includes('claude.ai')) platform = 'claude';
    else if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) platform = 'chatgpt';
    else if (h.includes('gemini.google.com')) platform = 'gemini';

    if (!platform) {
      resolve({ ok: false, err: 'unsupported' });
      return;
    }

    // ---- 尋找輸入框 ----
    let input = null;
    if (platform === 'claude') {
      // Claude 使用 ProseMirror，data-placeholder 屬性可幫助定位真正的編輯器
      input = document.querySelector('div[contenteditable="true"][data-placeholder]')
           || document.querySelector('div.ProseMirror[contenteditable="true"]')
           || document.querySelector('fieldset div[contenteditable="true"]')
           || document.querySelector('div[contenteditable="true"]');
    } else if (platform === 'chatgpt') {
      input = document.querySelector('#prompt-textarea')
           || document.querySelector('div[contenteditable="true"]');
    } else if (platform === 'gemini') {
      input = document.querySelector('.ql-editor[contenteditable="true"]')
           || document.querySelector('rich-textarea [contenteditable="true"]')
           || document.querySelector('div[contenteditable="true"]');
    }

    if (!input) {
      resolve({ ok: false, err: 'no_input' });
      return;
    }

    // ---- 清空現有內容並插入新文字 ----
    input.focus();

    // 先全選再插入，讓 ProseMirror / React controlled input 都能正確接收
    document.execCommand('selectAll', false, null);
    const inserted = document.execCommand('insertText', false, text);

    // execCommand 後備：直接操作 DOM 並派送 input 事件
    if (!inserted || input.textContent.trim() === '') {
      // 清空舊內容
      input.innerHTML = '';
      // 建立文字節點插入
      const textNode = document.createTextNode(text);
      input.appendChild(textNode);
      // 將游標移到尾端
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    }

    // 等待框架 digest 後嘗試點擊送出按鈕
    setTimeout(() => {
      let btn = null;

      if (platform === 'claude') {
        // Claude 的送出按鈕通常緊鄰輸入區，尋找最近的 button[type="button"] 或帶有 send/arrow 類名
        btn = document.querySelector('button[aria-label="Send Message"]')
           || document.querySelector('button[aria-label="Send"]')
           || document.querySelector('button[data-testid="send-button"]');
        // 後備：在輸入框的父容器中找最後一個未 disabled 的 button
        if (!btn) {
          const container = input.closest('form, fieldset, [class*="composer"], [class*="input"]');
          if (container) {
            const btns = [...container.querySelectorAll('button')].filter(b => !b.disabled);
            if (btns.length) btn = btns[btns.length - 1];
          }
        }
        // 全頁後備
        if (!btn) {
          const allBtns = [...document.querySelectorAll('button')].filter(
            b => !b.disabled && b.offsetParent !== null
          );
          // 找靠近輸入框的那個
          const inputRect = input.getBoundingClientRect();
          allBtns.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ad = Math.hypot(ar.left - inputRect.right, ar.top - inputRect.top);
            const bd = Math.hypot(br.left - inputRect.right, br.top - inputRect.top);
            return ad - bd;
          });
          if (allBtns[0]) btn = allBtns[0];
        }
      } else if (platform === 'chatgpt') {
        btn = document.querySelector('button[data-testid="send-button"]')
           || document.querySelector('button[aria-label="Send prompt"]')
           || document.querySelector('#composer-submit-button');
      } else if (platform === 'gemini') {
        btn = document.querySelector('button[aria-label="Send message"]')
           || document.querySelector('button[jsname="Qx7uuf"]')
           || document.querySelector('button.send-button');
      }

      if (btn && !btn.disabled) {
        btn.click();
        resolve({ ok: true });
      } else {
        // 最終後備：對輸入框派送 Enter keydown
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, cancelable: true, composed: true
        }));
        resolve({ ok: true, warn: 'used_enter_fallback' });
      }
    }, 800);
  });
}

// ============================================================
// Data Layer
// ============================================================

const DEFAULT_CATEGORIES = [
  { id: 'productivity', name: '生產力', icon: 'bolt' },
  { id: 'creative', name: '創意', icon: 'palette' },
  { id: 'coding', name: '程式', icon: 'terminal' },
  { id: 'academic', name: '學術', icon: 'school' },
  { id: 'writing', name: '寫作', icon: 'history_edu' },
];

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

async function loadData() {
  const result = await chrome.storage.local.get(['prompts', 'categories']);
  return {
    prompts: result.prompts || [],
    categories: result.categories || DEFAULT_CATEGORIES,
  };
}

async function savePrompts(prompts) {
  await chrome.storage.local.set({ prompts });
}

async function saveCategories(categories) {
  await chrome.storage.local.set({ categories });
}

// ============================================================
// State
// ============================================================

const state = {
  prompts: [],
  categories: [],
  activeTab: 'all',       // 'all' | 'favorites'
  activeCategory: 'all',  // 'all' | category id
  searchQuery: '',
  editingPromptId: null,   // null = new, string = editing
  selectionMode: false,    // 批量選取模式
  selectedIds: new Set(),  // 已選取的提示詞 ID
};

// ============================================================
// DOM References
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  appMain: $('#app-main'),
  editor: $('#prompt-editor'),
  detail: $('#prompt-detail'),
  settings: $('#settings-panel'),
  categoryDialog: $('#category-dialog'),
  confirmDialog: $('#confirm-dialog'),
  toast: $('#toast'),
  fileImport: $('#file-import'),

  // Main
  searchInput: $('#search-input'),
  filterBar: $('#filter-bar'),
  cardGrid: $('#card-grid'),
  emptyState: $('#empty-state'),
  noResults: $('#no-results'),

  // Editor
  editorTitle: $('#editor-title'),
  fieldName: $('#field-name'),
  fieldContent: $('#field-content'),
  fieldCategory: $('#field-category'),
  fieldFavorite: $('#field-favorite'),
  btnEditorDelete: $('#btn-editor-delete'),

  // Detail
  detailTitle: $('#detail-title'),
  detailCategory: $('#detail-category'),
  detailDate: $('#detail-date'),
  detailContent: $('#detail-content'),
  btnDetailFav: $('#btn-detail-fav'),

  // Settings
  categoryList: $('#category-list'),
  newCategoryName: $('#new-category-name'),
  newCategoryIcon: $('#new-category-icon'),

  // Dialog
  dialogCatName: $('#dialog-cat-name'),
  dialogCatIcon: $('#dialog-cat-icon'),

  // Confirm
  confirmTitle: $('#confirm-title'),
  confirmMessage: $('#confirm-message'),

  // Batch selection
  batchBar: $('#batch-action-bar'),
  batchCountLabel: $('#batch-count-label'),
  btnBatchSelect: $('#btn-batch-select'),
  batchCatDialog: $('#batch-cat-dialog'),
  batchCatOptions: $('#batch-cat-options'),
};

// ============================================================
// Utility
// ============================================================

function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} 週前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 個月前`;
  return `${Math.floor(months / 12)} 年前`;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  // Force reflow
  void dom.toast.offsetHeight;
  dom.toast.classList.add('show');
  setTimeout(() => {
    dom.toast.classList.remove('show');
    setTimeout(() => dom.toast.classList.add('hidden'), 300);
  }, 2000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製到剪貼簿');
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('已複製到剪貼簿');
  }
}

// ============================================================
// 送出提示詞至 AI 平台
// ============================================================

async function sendPromptToAI(text) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) {
      showToast('找不到目前的分頁');
      return;
    }

    const url = tab.url || '';
    const supported = url.includes('claude.ai')
      || url.includes('chatgpt.com')
      || url.includes('chat.openai.com')
      || url.includes('gemini.google.com');

    if (!supported) {
      showToast('請切換到 Claude、ChatGPT 或 Gemini 分頁');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: _injectAndSubmit,
      args: [text],
    });

    const result = results?.[0]?.result;
    if (result?.ok) {
      showToast('已送出至 AI！');
    } else if (result?.err === 'no_input') {
      showToast('找不到輸入框，請確認頁面已載入完成');
    } else if (result?.err === 'unsupported') {
      showToast('不支援此平台');
    } else {
      showToast('送出失敗，請重試');
    }
  } catch (err) {
    console.error('[PromptBooks] sendPromptToAI:', err);
    if (err.message?.includes('Cannot access') || err.message?.includes('Missing host')) {
      showToast('請切換到 Claude、ChatGPT 或 Gemini 分頁');
    } else {
      showToast('送出失敗：請重試');
    }
  }
}

// ============================================================
// Variable Modal（完全由 JS 動態建立，不依賴 HTML）
// ============================================================

let _varModalEl = null;     // 遮罩層
let _varFieldsEl = null;    // 欄位容器
let _pendingContent = '';   // 待複製的原始文字

function _buildVariableModal() {
  if (_varModalEl) return; // 已建立則跳過

  // ----- 遮罩層 -----
  const overlay = document.createElement('div');
  overlay.id = 'pb-variable-modal';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    background: 'rgba(0,0,0,0.65)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    zIndex: '99999',
    display: 'none',          // 預設隱藏
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    boxSizing: 'border-box',
  });

  // ----- 對話框 -----
  const box = document.createElement('div');
  Object.assign(box.style, {
    background: 'var(--surface-container-high, #1b2025)',
    borderRadius: '12px',
    padding: '20px',
    width: '100%',
    maxWidth: '340px',
    maxHeight: '80vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    boxSizing: 'border-box',
  });

  // ----- 標題 -----
  const title = document.createElement('h3');
  title.textContent = '填寫變數';
  Object.assign(title.style, {
    fontFamily: 'var(--font-headline, Inter, sans-serif)',
    fontSize: '15px',
    fontWeight: '600',
    color: 'var(--on-surface, #e0e6ed)',
    margin: '0',
  });

  // ----- 副標題 -----
  const subtitle = document.createElement('p');
  subtitle.textContent = '此提示詞包含變數，請填寫後選擇複製或送出';
  Object.assign(subtitle.style, {
    fontSize: '12px',
    color: 'var(--on-surface-variant, #a6acb3)',
    margin: '0',
  });

  // ----- 欄位容器 -----
  const fieldsDiv = document.createElement('div');
  Object.assign(fieldsDiv.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  });

  // ----- 按鈕列 -----
  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
    marginTop: '4px',
    flexWrap: 'wrap',
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.style.marginRight = 'auto';
  cancelBtn.addEventListener('click', _closeModal);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-secondary';
  copyBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;">content_copy</span> 複製';
  copyBtn.addEventListener('click', _applyAndCopy);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn-primary';
  sendBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;">send</span> 送出';
  sendBtn.addEventListener('click', _applyAndSend);

  actions.appendChild(cancelBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(sendBtn);

  // ----- 組裝 -----
  box.appendChild(title);
  box.appendChild(subtitle);
  box.appendChild(fieldsDiv);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // 點擊遮罩關閉
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _closeModal();
  });

  // Enter 鍵觸發送出（Ctrl+Enter 或 Shift+Enter 改為複製）
  fieldsDiv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.shiftKey) {
        _applyAndCopy();
      } else {
        _applyAndSend();
      }
    }
  });

  _varModalEl = overlay;
  _varFieldsEl = fieldsDiv;
}

// 偵測 {{ 變數名稱 }} 格式
function extractVariables(content) {
  const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const seen = new Set();
  const vars = [];
  let m;
  while ((m = regex.exec(content)) !== null) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }
  return vars;
}

// 按下複製時的入口
function copyPromptContent(content) {
  const vars = extractVariables(content);
  if (vars.length === 0) {
    copyToClipboard(content);
    return;
  }
  _openVariableModal(content);
}

// 按下送出時的入口
function sendPromptContent(content) {
  const vars = extractVariables(content);
  if (vars.length === 0) {
    sendPromptToAI(content);
    return;
  }
  _openVariableModal(content);
}

// 開啟「填寫變數」Modal（共用）
function _openVariableModal(content) {
  _pendingContent = content;
  _buildVariableModal();

  const vars = extractVariables(content);

  // 清空並重建欄位
  _varFieldsEl.innerHTML = '';
  for (const varName of vars) {
    const group = document.createElement('div');
    Object.assign(group.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

    const label = document.createElement('label');
    label.textContent = varName;
    Object.assign(label.style, {
      fontSize: '11px',
      fontFamily: 'var(--font-label, Manrope, sans-serif)',
      fontWeight: '600',
      color: 'var(--primary, #bdc2ff)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `輸入「${varName}」的值`;
    input.dataset.varName = varName;
    Object.assign(input.style, {
      background: 'var(--surface-container-lowest, #000)',
      border: '1px solid var(--outline-variant, #42494f)',
      borderRadius: '6px',
      color: 'var(--on-surface, #e0e6ed)',
      fontFamily: 'var(--font-body, Inter, sans-serif)',
      fontSize: '13px',
      padding: '8px 10px',
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box',
    });
    input.addEventListener('focus', () => {
      input.style.borderColor = 'var(--primary, #bdc2ff)';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = 'var(--outline-variant, #42494f)';
    });

    group.appendChild(label);
    group.appendChild(input);
    _varFieldsEl.appendChild(group);
  }

  // 顯示（設為 flex）
  _varModalEl.style.display = 'flex';

  // focus 第一個欄位
  const first = _varFieldsEl.querySelector('input');
  if (first) requestAnimationFrame(() => first.focus());
}

function _applyAndCopy() {
  if (!_varFieldsEl) return;
  let content = _pendingContent;

  _varFieldsEl.querySelectorAll('input[data-var-name]').forEach((input) => {
    const name = input.dataset.varName;
    const val = input.value;
    const pattern = new RegExp(
      `\\{\\{\\s*${_escapeRe(name)}\\s*\\}\\}`, 'g'
    );
    content = content.replace(pattern, val);
  });

  _closeModal();
  copyToClipboard(content);
}

function _applyAndSend() {
  if (!_varFieldsEl) return;
  let content = _pendingContent;

  _varFieldsEl.querySelectorAll('input[data-var-name]').forEach((input) => {
    const name = input.dataset.varName;
    const val = input.value;
    const pattern = new RegExp(
      `\\{\\{\\s*${_escapeRe(name)}\\s*\\}\\}`, 'g'
    );
    content = content.replace(pattern, val);
  });

  _closeModal();
  sendPromptToAI(content);
}

function _closeModal() {
  if (_varModalEl) _varModalEl.style.display = 'none';
  _pendingContent = '';
}

function _escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isVariableModalOpen() {
  return _varModalEl && _varModalEl.style.display !== 'none';
}

// ============================================================
// Navigation
// ============================================================

function showPanel(panel) {
  dom.appMain.classList.add('hidden');
  dom.editor.classList.add('hidden');
  dom.detail.classList.add('hidden');
  dom.settings.classList.add('hidden');

  switch (panel) {
    case 'main':
      dom.appMain.classList.remove('hidden');
      break;
    case 'editor':
      dom.editor.classList.remove('hidden');
      break;
    case 'detail':
      dom.detail.classList.remove('hidden');
      break;
    case 'settings':
      dom.settings.classList.remove('hidden');
      break;
  }
}

// ============================================================
// Rendering
// ============================================================

function getFilteredPrompts() {
  let list = [...state.prompts];

  // Tab filter
  if (state.activeTab === 'favorites') {
    list = list.filter((p) => p.favorite);
  }

  // Category filter
  if (state.activeCategory !== 'all') {
    list = list.filter((p) => p.categoryId === state.activeCategory);
  }

  // Search filter
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
    );
  }

  // Sort: pinned first, then by updatedAt descending
  list.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return b.updatedAt - a.updatedAt;
  });

  return list;
}

function renderFilterBar() {
  const bar = dom.filterBar;
  bar.innerHTML = '';

  // "All" chip
  const allChip = document.createElement('button');
  allChip.className = `chip${state.activeCategory === 'all' ? ' active' : ''}`;
  allChip.dataset.category = 'all';
  allChip.innerHTML = `<span class="material-symbols-outlined">apps</span><span>全部</span>`;
  bar.appendChild(allChip);

  // Category chips
  for (const cat of state.categories) {
    const chip = document.createElement('button');
    chip.className = `chip${state.activeCategory === cat.id ? ' active' : ''}`;
    chip.dataset.category = cat.id;
    chip.innerHTML = `<span class="material-symbols-outlined">${sanitize(cat.icon)}</span><span>${sanitize(cat.name)}</span>`;
    bar.appendChild(chip);
  }

  // 重繪後更新漸層提示（若 wrapper 已存在）
  const fbWrapper = document.getElementById('filter-bar-wrapper');
  if (fbWrapper) {
    const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
    fbWrapper.classList.toggle('fb-scrolled', bar.scrollLeft > 2);
    fbWrapper.classList.toggle('fb-at-end', atEnd);
  }
}

function renderCards() {
  const filtered = getFilteredPrompts();
  const grid = dom.cardGrid;
  grid.innerHTML = '';

  // Handle empty states
  const hasPrompts = state.prompts.length > 0;
  const hasResults = filtered.length > 0;

  dom.emptyState.classList.toggle('hidden', hasPrompts);
  dom.noResults.classList.toggle('hidden', !hasPrompts || hasResults);
  dom.cardGrid.classList.toggle('hidden', !hasResults);
  dom.cardGrid.classList.toggle('selection-mode', state.selectionMode);

  for (const prompt of filtered) {
    const cat = state.categories.find((c) => c.id === prompt.categoryId);
    const isSelected = state.selectedIds.has(prompt.id);
    const card = document.createElement('div');
    card.className = `prompt-card${prompt.pinned ? ' is-pinned' : ''}${isSelected ? ' is-selected' : ''}`;
    card.dataset.id = prompt.id;

    let favHtml = '';
    if (prompt.favorite) {
      favHtml = '<span class="material-symbols-outlined card-fav" style="font-variation-settings: \'FILL\' 1;">star</span>';
    }

    let pinHtml = '';
    if (prompt.pinned) {
      pinHtml = '<span class="material-symbols-outlined card-pin-badge" title="已置頂">push_pin</span>';
    }

    const actionBtnsHtml = state.selectionMode
      ? `<button class="card-check-btn${isSelected ? ' is-checked' : ''}" data-check-id="${sanitize(prompt.id)}" title="${isSelected ? '取消選取' : '選取'}">
           <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${isSelected ? '1' : '0'}">check_circle</span>
         </button>`
      : `<button class="card-send-btn" data-send-id="${sanitize(prompt.id)}" title="送出至 AI">
           <span class="material-symbols-outlined">send</span>
         </button>
         <button class="card-copy-btn" data-copy-id="${sanitize(prompt.id)}" title="複製提示詞">
           <span class="material-symbols-outlined">content_copy</span>
         </button>`;

    card.innerHTML = `
      ${favHtml}
      ${pinHtml}
      ${actionBtnsHtml}
      <h3 class="card-title">${sanitize(prompt.name)}</h3>
      <p class="card-preview">${sanitize(prompt.content)}</p>
      <div class="card-footer">
        ${cat ? `<span class="chip-sm">${sanitize(cat.name)}</span>` : ''}
        <div class="card-meta">
          <span class="card-date">${formatDate(prompt.updatedAt)}</span>
          <span class="material-symbols-outlined card-arrow">arrow_forward</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  }

}

function renderCategorySelect() {
  const select = dom.fieldCategory;
  const currentVal = select.value;
  select.innerHTML = '<option value="">選擇分類</option>';
  for (const cat of state.categories) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  }
  select.value = currentVal;
}

function renderCategoryList() {
  const list = dom.categoryList;
  list.innerHTML = '';

  for (const cat of state.categories) {
    const count = state.prompts.filter((p) => p.categoryId === cat.id).length;
    const item = document.createElement('div');
    item.className = 'category-item';
    item.dataset.catId = sanitize(cat.id);
    item.innerHTML = `
      <span class="material-symbols-outlined">${sanitize(cat.icon)}</span>
      <span class="cat-name">${sanitize(cat.name)}</span>
      <span class="cat-count">${count}</span>
      <button class="btn-icon btn-edit-cat" data-cat-id="${sanitize(cat.id)}" title="編輯分類">
        <span class="material-symbols-outlined">edit</span>
      </button>
      <button class="btn-icon btn-delete-cat" data-cat-id="${sanitize(cat.id)}" title="刪除分類">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    list.appendChild(item);
  }
}

function renderAll() {
  renderFilterBar();
  renderCards();
}

// ============================================================
// Editor Logic
// ============================================================

function openEditor(promptId) {
  state.editingPromptId = promptId || null;
  renderCategorySelect();

  if (promptId) {
    const prompt = state.prompts.find((p) => p.id === promptId);
    if (!prompt) return;
    dom.editorTitle.textContent = '編輯提示詞';
    dom.fieldName.value = prompt.name;
    dom.fieldContent.value = prompt.content;
    dom.fieldCategory.value = prompt.categoryId || '';
    dom.fieldFavorite.checked = prompt.favorite || false;
    dom.btnEditorDelete.classList.remove('hidden');
  } else {
    dom.editorTitle.textContent = '新增提示詞';
    dom.fieldName.value = '';
    dom.fieldContent.value = '';
    dom.fieldCategory.value = '';
    dom.fieldFavorite.checked = false;
    dom.btnEditorDelete.classList.add('hidden');
  }

  // Trigger checkbox visual
  dom.fieldFavorite.dispatchEvent(new Event('change'));

  showPanel('editor');
}

async function saveEditor() {
  const name = dom.fieldName.value.trim();
  const content = dom.fieldContent.value.trim();
  const categoryId = dom.fieldCategory.value;
  const favorite = dom.fieldFavorite.checked;

  if (!name) {
    showToast('請輸入標題');
    dom.fieldName.focus();
    return;
  }
  if (!content) {
    showToast('請輸入提示詞內容');
    dom.fieldContent.focus();
    return;
  }

  const now = Date.now();

  if (state.editingPromptId) {
    // Update existing
    const idx = state.prompts.findIndex((p) => p.id === state.editingPromptId);
    if (idx !== -1) {
      state.prompts[idx] = {
        ...state.prompts[idx],
        name,
        content,
        categoryId,
        favorite,
        updatedAt: now,
      };
    }
    showToast('提示詞已更新');
  } else {
    // Create new
    state.prompts.push({
      id: generateId(),
      name,
      content,
      categoryId,
      favorite,
      createdAt: now,
      updatedAt: now,
    });
    showToast('提示詞已新增');
  }

  await savePrompts(state.prompts);
  renderAll();
  showPanel('main');
}

async function deletePrompt(promptId) {
  state.prompts = state.prompts.filter((p) => p.id !== promptId);
  await savePrompts(state.prompts);
  renderAll();
  showToast('提示詞已刪除');
  showPanel('main');
}

// ============================================================
// Detail Logic
// ============================================================

let currentDetailId = null;

function openDetail(promptId) {
  const prompt = state.prompts.find((p) => p.id === promptId);
  if (!prompt) return;

  currentDetailId = promptId;
  dom.detailTitle.textContent = prompt.name;
  dom.detailContent.textContent = prompt.content;

  const cat = state.categories.find((c) => c.id === prompt.categoryId);
  dom.detailCategory.textContent = cat ? cat.name : '未分類';
  dom.detailDate.textContent = formatDate(prompt.updatedAt);

  // Favorite button state
  if (prompt.favorite) {
    dom.btnDetailFav.classList.add('btn-fav-active');
  } else {
    dom.btnDetailFav.classList.remove('btn-fav-active');
  }

  showPanel('detail');
}

async function toggleFavorite(promptId) {
  const prompt = state.prompts.find((p) => p.id === promptId);
  if (!prompt) return;
  prompt.favorite = !prompt.favorite;
  await savePrompts(state.prompts);
  renderAll();

  if (prompt.favorite) {
    dom.btnDetailFav.classList.add('btn-fav-active');
    showToast('已加入收藏');
  } else {
    dom.btnDetailFav.classList.remove('btn-fav-active');
    showToast('已取消收藏');
  }
}

// ============================================================
// Pin Logic
// ============================================================

async function togglePin(promptId) {
  const prompt = state.prompts.find((p) => p.id === promptId);
  if (!prompt) return;
  prompt.pinned = !prompt.pinned;
  await savePrompts(state.prompts);
  renderAll();
  showToast(prompt.pinned ? '已置頂' : '已取消置頂');
}

// ============================================================
// Context Menu
// ============================================================

let _ctxMenuEl = null;
let _ctxTargetId = null;

function _buildContextMenu() {
  if (_ctxMenuEl) return;

  const menu = document.createElement('div');
  menu.id = 'pb-context-menu';
  document.body.appendChild(menu);
  _ctxMenuEl = menu;
}

function showContextMenu(x, y, promptId) {
  _buildContextMenu();
  _ctxTargetId = promptId;

  const prompt = state.prompts.find((p) => p.id === promptId);
  if (!prompt) return;

  const isPinned = !!prompt.pinned;

  _ctxMenuEl.innerHTML = `
    <button class="ctx-item" data-action="select">
      <span class="material-symbols-outlined">checklist</span>
      <span>批量選取</span>
    </button>
    <button class="ctx-item" data-action="pin">
      <span class="material-symbols-outlined">${isPinned ? 'keep_off' : 'push_pin'}</span>
      <span>${isPinned ? '取消置頂' : '置頂'}</span>
    </button>
  `;

  _ctxMenuEl.querySelectorAll('.ctx-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'pin') togglePin(_ctxTargetId);
      else if (action === 'select') enterSelectionMode(_ctxTargetId);
      hideContextMenu();
    });
  });

  // Position
  _ctxMenuEl.style.display = 'block';
  const menuW = _ctxMenuEl.offsetWidth;
  const menuH = _ctxMenuEl.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  _ctxMenuEl.style.left = `${Math.min(x, vw - menuW - 4)}px`;
  _ctxMenuEl.style.top = `${Math.min(y, vh - menuH - 4)}px`;
}

function hideContextMenu() {
  if (_ctxMenuEl) _ctxMenuEl.style.display = 'none';
  _ctxTargetId = null;
}

// ============================================================
// Batch Selection
// ============================================================

let _longPressTimer = null;
let _longPressCardId = null;

function enterSelectionMode(initialId) {
  state.selectionMode = true;
  state.selectedIds.clear();
  if (initialId) state.selectedIds.add(initialId);
  dom.btnBatchSelect.classList.add('selection-active');
  dom.batchBar.classList.remove('hidden');
  updateBatchBar();
  renderCards();
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedIds.clear();
  dom.btnBatchSelect.classList.remove('selection-active');
  dom.batchBar.classList.add('hidden');
  renderCards();
}

function toggleCardSelection(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  // 直接更新卡片 DOM，不需要全部重繪
  const card = dom.cardGrid.querySelector(`.prompt-card[data-id="${id}"]`);
  if (card) {
    const isSelected = state.selectedIds.has(id);
    card.classList.toggle('is-selected', isSelected);
    const checkBtn = card.querySelector('.card-check-btn');
    if (checkBtn) {
      checkBtn.classList.toggle('is-checked', isSelected);
      checkBtn.title = isSelected ? '取消選取' : '選取';
      const icon = checkBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.style.fontVariationSettings = isSelected ? "'FILL' 1" : "'FILL' 0";
    }
  }
  updateBatchBar();
}

function toggleSelectAll() {
  const filtered = getFilteredPrompts();
  const allSelected = filtered.length > 0 && filtered.every((p) => state.selectedIds.has(p.id));
  if (allSelected) {
    filtered.forEach((p) => state.selectedIds.delete(p.id));
  } else {
    filtered.forEach((p) => state.selectedIds.add(p.id));
  }
  updateBatchBar();
  renderCards();
}

function updateBatchBar() {
  const count = state.selectedIds.size;
  dom.batchCountLabel.textContent = `已選 ${count} 個`;
  const filtered = getFilteredPrompts();
  const allSelected = filtered.length > 0 && filtered.every((p) => state.selectedIds.has(p.id));
  const btnAll = $('#btn-batch-select-all');
  if (btnAll) btnAll.textContent = allSelected ? '取消全選' : '全選';
  const btnDel = $('#btn-batch-delete');
  const btnCat = $('#btn-batch-assign-cat');
  if (btnDel) btnDel.disabled = count === 0;
  if (btnCat) btnCat.disabled = count === 0;
}

async function batchDelete() {
  const count = state.selectedIds.size;
  if (count === 0) return;
  showConfirm(
    '批量刪除',
    `確定要刪除選取的 ${count} 個提示詞嗎？此操作無法復原。`,
    async () => {
      state.prompts = state.prompts.filter((p) => !state.selectedIds.has(p.id));
      await savePrompts(state.prompts);
      exitSelectionMode();
      showToast(`已刪除 ${count} 個提示詞`);
    }
  );
}

async function batchAssignCategory(catId) {
  const count = state.selectedIds.size;
  const now = Date.now();
  for (const id of state.selectedIds) {
    const prompt = state.prompts.find((p) => p.id === id);
    if (prompt) {
      prompt.categoryId = catId;
      prompt.updatedAt = now;
    }
  }
  await savePrompts(state.prompts);
  dom.batchCatDialog.classList.add('hidden');
  exitSelectionMode();
  const cat = state.categories.find((c) => c.id === catId);
  showToast(cat ? `已將 ${count} 個提示詞移至「${cat.name}」` : `已清除 ${count} 個提示詞的分類`);
}

function showBatchCatDialog() {
  const options = dom.batchCatOptions;
  options.innerHTML = '';
  for (const cat of state.categories) {
    const btn = document.createElement('button');
    btn.className = 'batch-cat-option';
    btn.innerHTML = `
      <span class="material-symbols-outlined">${sanitize(cat.icon)}</span>
      <span>${sanitize(cat.name)}</span>
    `;
    btn.addEventListener('click', () => batchAssignCategory(cat.id));
    options.appendChild(btn);
  }
  dom.batchCatDialog.classList.remove('hidden');
}

// ============================================================
// Category Management
// ============================================================

async function addCategory(name, icon) {
  if (!name.trim()) {
    showToast('請輸入分類名稱');
    return false;
  }

  const id = name.trim().toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36);
  state.categories.push({ id, name: name.trim(), icon: icon.trim() || 'label' });
  await saveCategories(state.categories);
  renderAll();
  renderCategoryList();
  renderCategorySelect();
  showToast('分類已新增');
  return true;
}

async function editCategory(catId, newName, newIcon) {
  if (!newName.trim()) {
    showToast('請輸入分類名稱');
    return false;
  }
  const cat = state.categories.find((c) => c.id === catId);
  if (!cat) return false;
  cat.name = newName.trim();
  cat.icon = newIcon.trim() || 'label';
  await saveCategories(state.categories);
  renderAll();
  renderCategoryList();
  renderCategorySelect();
  showToast('分類已更新');
  return true;
}

async function deleteCategory(catId) {
  state.categories = state.categories.filter((c) => c.id !== catId);
  // Clear category from prompts that used it
  let changed = false;
  for (const p of state.prompts) {
    if (p.categoryId === catId) {
      p.categoryId = '';
      changed = true;
    }
  }
  await saveCategories(state.categories);
  if (changed) await savePrompts(state.prompts);

  if (state.activeCategory === catId) {
    state.activeCategory = 'all';
  }

  renderAll();
  renderCategoryList();
  renderCategorySelect();
  showToast('分類已刪除');
}

// ============================================================
// Filter Bar Drag-and-Drop Reorder
// ============================================================

function setupFilterBarDnD() {
  const bar = dom.filterBar;
  let dragState = null; // { el, startX, origCats, dragging }

  function onMove(e) {
    if (!dragState) return;

    if (!dragState.dragging) {
      if (Math.abs(e.clientX - dragState.startX) < 8) return;
      dragState.dragging = true;
      dragState.el.classList.add('chip-dragging');
    }

    // chip-dragging 設定 pointer-events:none，elementFromPoint 會自動跳過它
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const overChip = elUnder?.closest('.chip[data-category]');
    if (!overChip || overChip === dragState.el || overChip.dataset.category === 'all') return;

    const rect = overChip.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      bar.insertBefore(dragState.el, overChip);
    } else {
      bar.insertBefore(dragState.el, overChip.nextSibling);
    }
  }

  async function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    if (!dragState) return;

    const { el, dragging, origCats } = dragState;
    dragState = null;
    el.classList.remove('chip-dragging');

    if (!dragging) return;

    // 從 DOM 讀取新順序並儲存
    const newOrder = [];
    bar.querySelectorAll('.chip[data-category]').forEach((chip) => {
      if (chip.dataset.category !== 'all') {
        const cat = origCats.find((c) => c.id === chip.dataset.category);
        if (cat) newOrder.push(cat);
      }
    });
    state.categories = newOrder;
    await saveCategories(state.categories);
    renderCategoryList();

    // 防止拖曳結束後觸發 click 事件切換分類
    el.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
  }

  function onCancel() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    if (!dragState) return;
    const { el, origCats } = dragState;
    dragState = null;
    el.classList.remove('chip-dragging');
    state.categories = origCats;
    renderFilterBar();
  }

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // 只處理滑鼠左鍵
    const chip = e.target.closest('.chip');
    if (!chip || chip.dataset.category === 'all') return;

    dragState = { el: chip, startX: e.clientX, origCats: [...state.categories], dragging: false };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

// ============================================================
// Swipe Navigation（左右滑動切換分類）
// ============================================================

function scrollActiveChipIntoView() {
  const activeChip = dom.filterBar.querySelector('.chip.active');
  if (activeChip) {
    activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

function setupSwipeNavigation() {
  let touchStartX = 0;
  let touchStartY = 0;

  const getCategoryList = () => ['all', ...state.categories.map((c) => c.id)];

  const handleSwipe = (dx, dy) => {
    // 水平位移 < 50px 或垂直位移大於水平時忽略
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return;

    const list = getCategoryList();
    const idx = list.indexOf(state.activeCategory);
    const newIdx = dx < 0
      ? Math.min(idx + 1, list.length - 1)  // 向左滑 → 下一分類
      : Math.max(idx - 1, 0);               // 向右滑 → 上一分類

    if (newIdx === idx) return;

    state.activeCategory = list[newIdx];
    renderFilterBar();
    renderCards();
    scrollActiveChipIntoView();
  };

  const onTouchStart = (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    handleSwipe(dx, dy);
  };

  // 在卡片區域、空狀態區域都支援滑動
  [dom.cardGrid, dom.emptyState, dom.noResults].forEach((el) => {
    if (!el) return;
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
  });
}

// ============================================================
// Import / Export
// ============================================================

function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    prompts: state.prompts,
    categories: state.categories,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `promptbooks-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('資料已匯出');
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate structure
    if (!data || !Array.isArray(data.prompts)) {
      showToast('無效的匯入檔案格式');
      return;
    }

    // Validate each prompt has required fields
    for (const p of data.prompts) {
      if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.content !== 'string') {
        showToast('匯入檔案包含無效的提示詞資料');
        return;
      }
    }

    // Merge: add new prompts that don't exist, update those that do
    const existingIds = new Set(state.prompts.map((p) => p.id));
    let added = 0;
    let updated = 0;

    for (const imported of data.prompts) {
      if (existingIds.has(imported.id)) {
        const idx = state.prompts.findIndex((p) => p.id === imported.id);
        if (idx !== -1) {
          state.prompts[idx] = { ...state.prompts[idx], ...imported };
          updated++;
        }
      } else {
        state.prompts.push(imported);
        added++;
      }
    }

    // Merge categories
    if (Array.isArray(data.categories)) {
      const existingCatIds = new Set(state.categories.map((c) => c.id));
      for (const cat of data.categories) {
        if (typeof cat.id === 'string' && typeof cat.name === 'string' && !existingCatIds.has(cat.id)) {
          state.categories.push(cat);
        }
      }
    }

    await savePrompts(state.prompts);
    await saveCategories(state.categories);
    renderAll();
    renderCategoryList();
    renderCategorySelect();

    showToast(`已匯入：${added} 個新增，${updated} 個更新`);
  } catch {
    showToast('匯入失敗：檔案格式錯誤');
  }
}

// ============================================================
// Confirm Dialog
// ============================================================

let confirmCallback = null;

function showConfirm(title, message, callback) {
  dom.confirmTitle.textContent = title;
  dom.confirmMessage.textContent = message;
  confirmCallback = callback;
  dom.confirmDialog.classList.remove('hidden');
}

// ============================================================
// Event Binding
// ============================================================

function bindEvents() {
  // --- Tab Navigation ---
  $$('.tab-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.tab-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
      state.activeTab = link.dataset.tab;
      renderCards();
    });
  });

  // --- Search ---
  dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderCards();
  });

  // --- Filter Bar (using event delegation) ---
  dom.filterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.activeCategory = chip.dataset.category;
    renderFilterBar();
    renderCards();
    scrollActiveChipIntoView();
  });

  setupFilterBarDnD();
  setupSwipeNavigation();

  // --- Filter Bar scroll → 更新漸層提示 ---
  const fbWrapper = document.getElementById('filter-bar-wrapper');
  function updateFilterBarFade() {
    if (!fbWrapper) return;
    const bar = dom.filterBar;
    const atStart = bar.scrollLeft <= 2;
    const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
    fbWrapper.classList.toggle('fb-scrolled', !atStart);
    fbWrapper.classList.toggle('fb-at-end', atEnd);
  }
  dom.filterBar.addEventListener('scroll', updateFilterBarFade, { passive: true });
  // 滑鼠滾輪左右捲動分類列
  dom.filterBar.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      dom.filterBar.scrollBy({ left: e.deltaY, behavior: 'smooth' });
    }
  }, { passive: false });
  // 初始化（分類若未超出寬度則不顯示右側漸層）
  updateFilterBarFade();

  // --- Card Grid (event delegation) ---
  dom.cardGrid.addEventListener('click', (e) => {
    // \u6279\u91cf\u9078\u53d6\u6a21\u5f0f\uff1a\u9ede\u64ca\u5361\u7247\u5207\u63db\u9078\u53d6\u72c0\u614b
    if (state.selectionMode) {
      const card = e.target.closest('.prompt-card');
      if (!card) return;
      // \u8df3\u904e\u7dca\u63a5\u5728\u9577\u6309\u5f8c\u89f8\u767c\u7684 click \u4e8b\u4ef6\uff08\u907f\u514d\u91cd\u8907\u5207\u63db\uff09
      if (card.dataset.id === _longPressCardId) {
        _longPressCardId = null;
        return;
      }
      toggleCardSelection(card.dataset.id);
      return;
    }

    // Send button
    const sendBtn = e.target.closest('.card-send-btn');
    if (sendBtn) {
      e.stopPropagation();
      const id = sendBtn.dataset.sendId;
      const prompt = state.prompts.find((p) => p.id === id);
      if (prompt) {
        sendPromptContent(prompt.content);
      }
      return;
    }

    // Copy button
    const copyBtn = e.target.closest('.card-copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      const id = copyBtn.dataset.copyId;
      const prompt = state.prompts.find((p) => p.id === id);
      if (prompt) {
        copyPromptContent(prompt.content);
      }
      return;
    }

    // Card click → open detail
    const card = e.target.closest('.prompt-card');
    if (card) {
      openDetail(card.dataset.id);
    }
  });

  // --- Card long-press → enter selection mode ---
  {
    const _clearLP = () => {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    };
    dom.cardGrid.addEventListener('pointerdown', (e) => {
      if (state.selectionMode) return;
      const card = e.target.closest('.prompt-card');
      if (!card) return;
      _longPressTimer = setTimeout(() => {
        _longPressCardId = card.dataset.id;
        enterSelectionMode(card.dataset.id);
        _longPressTimer = null;
      }, 500);
    }, { passive: true });
    dom.cardGrid.addEventListener('pointerup', _clearLP, { passive: true });
    dom.cardGrid.addEventListener('pointercancel', _clearLP, { passive: true });
    dom.cardGrid.addEventListener('pointermove', (e) => {
      if (_longPressTimer && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) _clearLP();
    }, { passive: true });
  }

  // --- Card right-click context menu ---
  dom.cardGrid.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.prompt-card');
    if (!card) return;
    e.preventDefault();
    if (state.selectionMode) return; // \u9078\u53d6\u6a21\u5f0f\u4e0b\u4e0d\u986f\u793a\u53f3\u9375\u9078\u55ae
    showContextMenu(e.clientX, e.clientY, card.dataset.id);
  });

  // Close context menu on click outside / scroll / Escape
  document.addEventListener('click', () => hideContextMenu());
  document.addEventListener('scroll', () => hideContextMenu(), true);

  // --- Add Prompt ---
  $('#btn-add-prompt').addEventListener('click', () => openEditor(null));

  // --- Settings ---
  $('#btn-settings').addEventListener('click', () => {
    renderCategoryList();
    showPanel('settings');
  });

  // --- File import handler ---
  dom.fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
      e.target.value = '';
    }
  });

  // --- Editor ---
  $('#btn-editor-back').addEventListener('click', () => showPanel('main'));
  $('#btn-editor-cancel').addEventListener('click', () => showPanel('main'));
  $('#btn-editor-save').addEventListener('click', () => saveEditor());
  dom.btnEditorDelete.addEventListener('click', () => {
    showConfirm('刪除提示詞', '確定要刪除這個提示詞嗎？此操作無法復原。', () => {
      deletePrompt(state.editingPromptId);
    });
  });

  // --- New category button in editor ---
  $('#btn-new-category').addEventListener('click', () => {
    dom.dialogCatName.value = '';
    dom.dialogCatIcon.value = 'label';
    dom.categoryDialog.classList.remove('hidden');
    dom.dialogCatName.focus();
  });

  // --- Category Dialog ---
  $('#btn-dialog-cancel').addEventListener('click', () => {
    dom.categoryDialog.classList.add('hidden');
  });
  $('#btn-dialog-confirm').addEventListener('click', async () => {
    const ok = await addCategory(dom.dialogCatName.value, dom.dialogCatIcon.value);
    if (ok) {
      dom.categoryDialog.classList.add('hidden');
      // Select the newly created category
      const newCat = state.categories[state.categories.length - 1];
      if (newCat) {
        dom.fieldCategory.value = newCat.id;
      }
    }
  });

  // --- Detail ---
  $('#btn-detail-back').addEventListener('click', () => showPanel('main'));
  $('#btn-detail-edit').addEventListener('click', () => {
    if (currentDetailId) openEditor(currentDetailId);
  });
  dom.btnDetailFav.addEventListener('click', () => {
    if (currentDetailId) toggleFavorite(currentDetailId);
  });
  $('#btn-detail-copy').addEventListener('click', () => {
    const prompt = state.prompts.find((p) => p.id === currentDetailId);
    if (prompt) {
      copyPromptContent(prompt.content);
    }
  });
  $('#btn-detail-send').addEventListener('click', () => {
    const prompt = state.prompts.find((p) => p.id === currentDetailId);
    if (prompt) {
      sendPromptContent(prompt.content);
    }
  });

  // --- Settings ---
  $('#btn-settings-back').addEventListener('click', () => showPanel('main'));

  // Add category in settings
  $('#btn-add-category').addEventListener('click', async () => {
    const ok = await addCategory(dom.newCategoryName.value, dom.newCategoryIcon.value);
    if (ok) {
      dom.newCategoryName.value = '';
      dom.newCategoryIcon.value = 'label';
    }
  });

  // Category list: edit / save / cancel / delete (event delegation)
  dom.categoryList.addEventListener('click', (e) => {
    // Edit button → switch to inline edit mode
    const editBtn = e.target.closest('.btn-edit-cat');
    if (editBtn) {
      const catId = editBtn.dataset.catId;
      const cat = state.categories.find((c) => c.id === catId);
      if (!cat) return;
      const item = editBtn.closest('.category-item');
      item.classList.add('cat-editing');
      item.innerHTML = `
        <input class="cat-edit-icon field-input field-icon" value="${sanitize(cat.icon)}" maxlength="20" placeholder="圖示">
        <input class="cat-edit-name field-input" value="${sanitize(cat.name)}" maxlength="30" placeholder="分類名稱">
        <button class="btn-icon btn-save-cat" data-cat-id="${sanitize(cat.id)}" title="儲存">
          <span class="material-symbols-outlined">check</span>
        </button>
        <button class="btn-icon btn-cancel-edit-cat" title="取消">
          <span class="material-symbols-outlined">close</span>
        </button>
      `;
      item.querySelector('.cat-edit-name').focus();
      return;
    }

    // Save button → persist edits
    const saveBtn = e.target.closest('.btn-save-cat');
    if (saveBtn) {
      const catId = saveBtn.dataset.catId;
      const item = saveBtn.closest('.category-item');
      const newName = item.querySelector('.cat-edit-name').value;
      const newIcon = item.querySelector('.cat-edit-icon').value;
      editCategory(catId, newName, newIcon);
      return;
    }

    // Cancel button → revert to normal view
    const cancelBtn = e.target.closest('.btn-cancel-edit-cat');
    if (cancelBtn) {
      renderCategoryList();
      return;
    }

    // Delete button
    const deleteBtn = e.target.closest('.btn-delete-cat');
    if (!deleteBtn) return;
    const catId = deleteBtn.dataset.catId;
    const cat = state.categories.find((c) => c.id === catId);
    if (!cat) return;
    showConfirm('刪除分類', `確定要刪除「${cat.name}」分類嗎？該分類下的提示詞不會被刪除。`, () => {
      deleteCategory(catId);
    });
  });

  // Allow pressing Enter in the category name/icon edit inputs to save
  dom.categoryList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const saveBtn = e.target.closest('.category-item.cat-editing')?.querySelector('.btn-save-cat');
    if (saveBtn) saveBtn.click();
  });

  // Settings import/export
  $('#btn-settings-import').addEventListener('click', () => dom.fileImport.click());
  $('#btn-settings-export').addEventListener('click', () => exportData());

  // Clear all data
  $('#btn-settings-clear').addEventListener('click', () => {
    showConfirm('清除所有資料', '確定要刪除所有提示詞和分類嗎？此操作無法復原。', async () => {
      state.prompts = [];
      state.categories = [...DEFAULT_CATEGORIES];
      await savePrompts(state.prompts);
      await saveCategories(state.categories);
      renderAll();
      renderCategoryList();
      showToast('所有資料已清除');
    });
  });

  // --- Batch Select Toggle ---
  $('#btn-batch-select').addEventListener('click', () => {
    if (state.selectionMode) exitSelectionMode();
    else enterSelectionMode();
  });

  // --- Batch Action Bar ---
  $('#btn-batch-select-all').addEventListener('click', () => toggleSelectAll());
  $('#btn-batch-cancel').addEventListener('click', () => exitSelectionMode());
  $('#btn-batch-assign-cat').addEventListener('click', () => {
    if (state.selectedIds.size > 0) showBatchCatDialog();
  });
  $('#btn-batch-delete').addEventListener('click', () => batchDelete());

  // --- Batch Category Dialog ---
  $('#btn-batch-cat-cancel').addEventListener('click', () => {
    dom.batchCatDialog.classList.add('hidden');
  });
  $('#btn-batch-cat-none').addEventListener('click', () => batchAssignCategory(''));
  dom.batchCatDialog.addEventListener('click', (e) => {
    if (e.target === dom.batchCatDialog) dom.batchCatDialog.classList.add('hidden');
  });

  // --- Variable Modal 事件已在 _buildVariableModal() 內部建立，此處無需再綁定 ---

  // --- Confirm Dialog ---
  $('#btn-confirm-cancel').addEventListener('click', () => {
    dom.confirmDialog.classList.add('hidden');
    confirmCallback = null;
  });
  $('#btn-confirm-ok').addEventListener('click', () => {
    dom.confirmDialog.classList.add('hidden');
    if (typeof confirmCallback === 'function') {
      confirmCallback();
      confirmCallback = null;
    }
  });

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Escape to go back
    if (e.key === 'Escape') {
      if (state.selectionMode) {
        exitSelectionMode();
      } else if (!dom.batchCatDialog.classList.contains('hidden')) {
        dom.batchCatDialog.classList.add('hidden');
      } else if (_ctxMenuEl && _ctxMenuEl.style.display !== 'none') {
        hideContextMenu();
      } else if (isVariableModalOpen()) {
        _closeModal();
      } else if (!dom.confirmDialog.classList.contains('hidden')) {
        dom.confirmDialog.classList.add('hidden');
        confirmCallback = null;
      } else if (!dom.categoryDialog.classList.contains('hidden')) {
        dom.categoryDialog.classList.add('hidden');
      } else if (!dom.editor.classList.contains('hidden')) {
        showPanel('main');
      } else if (!dom.detail.classList.contains('hidden')) {
        showPanel('main');
      } else if (!dom.settings.classList.contains('hidden')) {
        showPanel('main');
      }
    }
  });
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  const data = await loadData();
  state.prompts = data.prompts;
  state.categories = data.categories;

  renderAll();
  bindEvents();
  showPanel('main');
}

document.addEventListener('DOMContentLoaded', init);
