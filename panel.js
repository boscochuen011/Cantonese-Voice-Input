const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const BLOCKED_URL_SCHEMES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
const FIRST_RUN_SETUP_KEY = 'firstRunSetupDone';
const ONBOARDING_PAGE_URL = chrome.runtime.getURL('onboarding.html');

const ui = {
  speakInsertBtn: document.getElementById('speakInsertBtn'),
  status: document.getElementById('status'),
  shortcutHint: document.getElementById('shortcutHint'),
  firstRunSetup: document.getElementById('firstRunSetup'),
  openSetupWizardBtn: document.getElementById('openSetupWizardBtn'),
  finishSetupBtn: document.getElementById('finishSetupBtn')
};

const state = {
  recognition: null,
  listening: false,
  starting: false,
  manualStop: false,
  finalText: '',
  interimText: '',
  lastError: ''
};

init();

function init() {
  ui.speakInsertBtn.addEventListener('click', handleSpeakInsertClick);
  wireSetupActions();
  setShortcutHint();
  void refreshFirstRunSetup();

  if (!SpeechRecognition) {
    ui.speakInsertBtn.disabled = true;
    setStatus('此 Chrome 版本不支援語音辨識 API。', 'bad');
    return;
  }

  updateButton();
  setStatus('先在網頁點選文字輸入欄，再按「語音輸入」。', 'neutral');
}

function wireSetupActions() {
  ui.openSetupWizardBtn?.addEventListener('click', () => {
    void openSetupWizard();
  });

  ui.finishSetupBtn?.addEventListener('click', () => {
    void markSetupAsCompleted();
  });
}

async function refreshFirstRunSetup() {
  if (!ui.firstRunSetup) {
    return;
  }

  let done = false;
  try {
    const saved = await chrome.storage.local.get({ [FIRST_RUN_SETUP_KEY]: false });
    done = Boolean(saved[FIRST_RUN_SETUP_KEY]);
  } catch (_error) {
    done = false;
  }

  ui.firstRunSetup.hidden = done;
}

async function markSetupAsCompleted() {
  try {
    await chrome.storage.local.set({
      [FIRST_RUN_SETUP_KEY]: true,
      onboardingCompletedAt: new Date().toISOString()
    });
  } catch (_error) {
    // Ignore storage failures and still allow user to close setup card in this session.
  }

  if (ui.firstRunSetup) {
    ui.firstRunSetup.hidden = true;
  }

  setStatus('已標記為完成設定。', 'ok');
}

async function openSetupWizard() {
  try {
    await chrome.tabs.create({ url: ONBOARDING_PAGE_URL });
    setStatus('已在新分頁開啟設定精靈。', 'neutral');
  } catch (_error) {
    window.open(ONBOARDING_PAGE_URL, '_blank', 'noopener');
    setStatus('已在新分頁開啟設定精靈。', 'neutral');
  }
}

function setShortcutHint() {
  if (!ui.shortcutHint) {
    return;
  }

  ui.shortcutHint.textContent = '快速操作：在網頁內連按兩下 Control。';
}

async function handleSpeakInsertClick() {
  if (state.listening || state.starting) {
    stopListening();
    return;
  }

  const granted = await ensureMicrophonePermission();
  if (!granted) {
    return;
  }

  const target = await ensureInsertTargetReady();
  if (!target.ok) {
    setStatus(target.message, 'warn');
    return;
  }

  await startListening();
}

async function startListening() {
  state.manualStop = false;
  state.lastError = '';
  state.finalText = '';
  state.interimText = '';
  state.starting = true;
  updateButton();

  const language = await getRecognitionLang();
  const recognition = buildRecognition(language);
  state.recognition = recognition;

  try {
    recognition.start();
  } catch (error) {
    state.starting = false;
    state.recognition = null;
    updateButton();
    setStatus(`開始失敗：${error.message}`, 'bad');
  }
}

function stopListening() {
  if (!state.recognition) {
    return;
  }

  state.manualStop = true;

  try {
    state.recognition.stop();
    setStatus('正在停止...', 'neutral');
  } catch (error) {
    setStatus(`停止失敗：${error.message}`, 'warn');
  }
}

function buildRecognition(language) {
  const recognition = new SpeechRecognition();
  recognition.lang = language;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.starting = false;
    state.listening = true;
    updateButton();
    setStatus('正在聆聽，請開始說話。', 'ok');
  };

  recognition.onresult = (event) => {
    let confirmed = '';
    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        confirmed += chunk;
      } else {
        interim += chunk;
      }
    }

    if (confirmed.trim()) {
      state.finalText = joinTranscript(state.finalText, confirmed);
    }

    state.interimText = interim.trim();
  };

  recognition.onerror = (event) => {
    state.lastError = event.error || '';

    const messages = {
      'not-allowed': '未授權麥克風。請在網址列鎖頭圖示中允許。',
      'service-not-allowed': '瀏覽器設定封鎖了語音辨識服務。',
      'audio-capture': '找不到可用的麥克風。',
      'no-speech': '偵測不到語音輸入。',
      network: '網路錯誤中斷了語音辨識。',
      aborted: '語音辨識已中止。'
    };

    setStatus(messages[event.error] || `語音辨識錯誤：${event.error}`, 'warn');
  };

  recognition.onend = () => {
    state.starting = false;
    state.listening = false;
    state.recognition = null;
    updateButton();

    const payload = (state.finalText || state.interimText).trim();
    if (payload) {
      void insertTextIntoActiveTab(payload, { successMessage: '完成，已插入文字。' });
      return;
    }

    if (state.lastError && !state.manualStop) {
      return;
    }

    if (state.manualStop) {
      setStatus('已停止。', 'neutral');
      return;
    }

    setStatus('未擷取到語音，請再試一次。', 'warn');
  };

  return recognition;
}

function updateButton() {
  const busy = state.listening || state.starting;
  ui.speakInsertBtn.classList.toggle('is-listening', busy);
  ui.speakInsertBtn.textContent = busy ? '停止並插入' : '語音輸入';
  ui.speakInsertBtn.disabled = !SpeechRecognition;
}

function setStatus(text, tone) {
  ui.status.textContent = text;
  ui.status.className = `status status-${tone}`;
}

async function getRecognitionLang() {
  try {
    const saved = await chrome.storage.local.get({ lang: 'yue-Hant-HK' });
    return saved.lang || 'yue-Hant-HK';
  } catch (_error) {
    return 'yue-Hant-HK';
  }
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setStatus('此 Chrome 環境無法要求麥克風權限。', 'bad');
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch (error) {
    const messages = {
      NotAllowedError: '麥克風權限被拒絕，請在網站權限中設為允許。',
      SecurityError: '瀏覽器安全設定封鎖了麥克風。',
      NotFoundError: '找不到可用的麥克風。'
    };

    const message = messages[error?.name] || `麥克風請求失敗：${error?.message || '未知錯誤'}`;
    setStatus(message, 'warn');
    return false;
  }
}

function getTabUrl(tab) {
  if (!tab) {
    return '';
  }

  if (typeof tab.url === 'string' && tab.url) {
    return tab.url;
  }

  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl) {
    return tab.pendingUrl;
  }

  return '';
}

function isBrowserInternalTab(tab) {
  const url = getTabUrl(tab);
  return Boolean(url) && BLOCKED_URL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

async function ensureInsertTargetReady() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') {
      return { ok: false, message: '找不到目前作用中的分頁。' };
    }

    if (isBrowserInternalTab(tab)) {
      return { ok: false, message: '不支援瀏覽器內部頁面，請開啟一般網站分頁。' };
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const active = document.activeElement;
        if (!active) {
          return { ok: false, reason: 'no_target' };
        }

        const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);
        const isTextArea = active instanceof HTMLTextAreaElement;
        const isTextInput = active instanceof HTMLInputElement && textInputTypes.has(active.type);
        const supported = isTextArea || isTextInput || active.isContentEditable;
        return supported ? { ok: true } : { ok: false, reason: 'unsupported_target' };
      }
    });

    if (result?.ok) {
      return { ok: true };
    }

    const reasonToMessage = {
      no_target: '請先在網頁點選文字輸入欄；主介面或無輸入欄位置唔支援插入。',
      unsupported_target: '目前焦點不是可支援的文字輸入欄。'
    };

    return { ok: false, message: reasonToMessage[result?.reason] || '插入目標尚未準備好。' };
  } catch (error) {
    if (/Cannot access a chrome:\/\//i.test(error?.message || '')) {
      return { ok: false, message: '不支援瀏覽器內部頁面，請開啟一般網站分頁。' };
    }

    return { ok: false, message: `無法存取目標頁面：${error.message}` };
  }
}

function joinTranscript(existing, chunk) {
  const next = chunk.trim();
  if (!next) {
    return existing;
  }

  if (!existing.trim()) {
    return next;
  }

  const endChar = existing.trimEnd().slice(-1);
  const needsNewline = !/[\u3002\uFF01\uFF1F.!?\n]/.test(endChar);
  return needsNewline ? `${existing.trimEnd()}\n${next}` : `${existing.trimEnd()}${next}`;
}

async function insertTextIntoActiveTab(text, options = {}) {
  if (!text) {
    setStatus('沒有可插入的文字。', 'warn');
    return false;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') {
      setStatus('找不到目前作用中的分頁。', 'bad');
      return false;
    }

    if (isBrowserInternalTab(tab)) {
      setStatus('不支援瀏覽器內部頁面，請開啟一般網站分頁。', 'warn');
      return false;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => {
        const active = document.activeElement;
        if (!active) {
          return { ok: false, reason: 'no_target' };
        }

        const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);
        const isTextArea = active instanceof HTMLTextAreaElement;
        const isTextInput = active instanceof HTMLInputElement && textInputTypes.has(active.type);

        if (isTextArea || isTextInput) {
          const start = typeof active.selectionStart === 'number' ? active.selectionStart : active.value.length;
          const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : active.value.length;

          active.value = `${active.value.slice(0, start)}${payload}${active.value.slice(end)}`;
          const cursor = start + payload.length;
          active.selectionStart = cursor;
          active.selectionEnd = cursor;
          active.focus();
          active.dispatchEvent(new Event('input', { bubbles: true }));
          active.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }

        if (active.isContentEditable) {
          active.focus();
          const selection = window.getSelection();
          if (!selection) {
            return { ok: false, reason: 'selection_missing' };
          }

          const ensureCaretInsideTarget = () => {
            const range = document.createRange();
            range.selectNodeContents(active);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          };

          if (selection.rangeCount === 0 || !active.contains(selection.anchorNode)) {
            ensureCaretInsideTarget();
          }

          let insertedByCommand = false;
          if (typeof document.execCommand === 'function') {
            try {
              insertedByCommand = document.execCommand('insertText', false, payload);
            } catch (_error) {
              insertedByCommand = false;
            }
          }

          if (insertedByCommand) {
            return { ok: true };
          }

          if (selection.rangeCount === 0) {
            ensureCaretInsideTarget();
          }

          const range = selection.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(payload);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);

          try {
            active.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: payload
            }));
          } catch (_error) {
            active.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { ok: true };
        }

        return { ok: false, reason: 'unsupported_target' };
      },
      args: [text]
    });

    if (result?.ok) {
      setStatus(options.successMessage || '已插入到頁面。', 'ok');
      return true;
    }

    const reasonToMessage = {
      no_target: '請先在網頁點選文字輸入欄；主介面或無輸入欄位置唔支援插入。',
      selection_missing: '無法讀取可編輯區域的游標位置。',
      unsupported_target: '目前焦點不是可支援的文字輸入欄。'
    };

    setStatus(reasonToMessage[result?.reason] || '插入失敗。', 'warn');
    return false;
  } catch (error) {
    const message = error?.message || '';
    if (/Cannot access a chrome:\/\//i.test(message)) {
      setStatus('不支援瀏覽器內部頁面，請開啟一般網站分頁。', 'warn');
      return false;
    }

    if (/must request permission to access the respective host/i.test(message)) {
      setStatus('網站權限不足，請重新載入擴充功能後再試。', 'warn');
      return false;
    }

    setStatus(`插入失敗：${message}`, 'bad');
    return false;
  }
}
