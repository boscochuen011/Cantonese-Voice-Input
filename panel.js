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
    setStatus('This Chrome build does not support speech recognition API.', 'bad');
    return;
  }

  updateButton();
  setStatus('Click a text box on page, then press Speak & Insert.', 'neutral');
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

  setStatus('Setup marked as complete.', 'ok');
}

async function openSetupWizard() {
  try {
    await chrome.tabs.create({ url: ONBOARDING_PAGE_URL });
    setStatus('Setup wizard opened in a new tab.', 'neutral');
  } catch (_error) {
    window.open(ONBOARDING_PAGE_URL, '_blank', 'noopener');
    setStatus('Setup wizard opened in a new tab.', 'neutral');
  }
}

function setShortcutHint() {
  if (!ui.shortcutHint) {
    return;
  }

  ui.shortcutHint.textContent = 'Quick flow: double-press Control on page.';
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
    setStatus(`Failed to start: ${error.message}`, 'bad');
  }
}

function stopListening() {
  if (!state.recognition) {
    return;
  }

  state.manualStop = true;

  try {
    state.recognition.stop();
    setStatus('Stopping...', 'neutral');
  } catch (error) {
    setStatus(`Failed to stop: ${error.message}`, 'warn');
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
    setStatus('Listening... speak now.', 'ok');
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
      'not-allowed': 'Microphone permission denied. Enable it from the lock icon.',
      'service-not-allowed': 'Speech recognition service was blocked by browser settings.',
      'audio-capture': 'No working microphone was found.',
      'no-speech': 'No speech was detected.',
      network: 'Network error interrupted speech recognition.',
      aborted: 'Speech recognition was aborted.'
    };

    setStatus(messages[event.error] || `Speech recognition error: ${event.error}`, 'warn');
  };

  recognition.onend = () => {
    state.starting = false;
    state.listening = false;
    state.recognition = null;
    updateButton();

    const payload = (state.finalText || state.interimText).trim();
    if (payload) {
      void insertTextIntoActiveTab(payload, { successMessage: 'Done. Inserted into page.' });
      return;
    }

    if (state.lastError && !state.manualStop) {
      return;
    }

    if (state.manualStop) {
      setStatus('Stopped.', 'neutral');
      return;
    }

    setStatus('No speech captured. Try again.', 'warn');
  };

  return recognition;
}

function updateButton() {
  const busy = state.listening || state.starting;
  ui.speakInsertBtn.classList.toggle('is-listening', busy);
  ui.speakInsertBtn.textContent = busy ? 'Stop & Insert' : 'Speak & Insert';
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
    setStatus('This Chrome context cannot request microphone access.', 'bad');
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
      NotAllowedError: 'Microphone permission denied. Allow microphone in site settings.',
      SecurityError: 'Microphone access was blocked by browser security settings.',
      NotFoundError: 'No working microphone was found.'
    };

    const message = messages[error?.name] || `Microphone request failed: ${error?.message || 'unknown error'}`;
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
      return { ok: false, message: 'Active tab was not found.' };
    }

    if (isBrowserInternalTab(tab)) {
      return { ok: false, message: 'Browser internal pages are not supported. Open a normal website tab.' };
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
      no_target: 'Click inside a text field on the page first.',
      unsupported_target: 'Current focus is not a supported text field.'
    };

    return { ok: false, message: reasonToMessage[result?.reason] || 'Insert target is not ready.' };
  } catch (error) {
    if (/Cannot access a chrome:\/\//i.test(error?.message || '')) {
      return { ok: false, message: 'Browser internal pages are not supported. Open a normal website tab.' };
    }

    return { ok: false, message: `Cannot access page target: ${error.message}` };
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
    setStatus('No text to insert.', 'warn');
    return false;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') {
      setStatus('Active tab was not found.', 'bad');
      return false;
    }

    if (isBrowserInternalTab(tab)) {
      setStatus('Browser internal pages are not supported. Open a normal website tab.', 'warn');
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

          if (selection.rangeCount === 0) {
            const range = document.createRange();
            range.selectNodeContents(active);
            range.collapse(false);
            selection.addRange(range);
          }

          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(payload));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          return { ok: true };
        }

        return { ok: false, reason: 'unsupported_target' };
      },
      args: [text]
    });

    if (result?.ok) {
      setStatus(options.successMessage || 'Inserted into page.', 'ok');
      return true;
    }

    const reasonToMessage = {
      no_target: 'Click inside a text field on the page first.',
      selection_missing: 'Failed to read caret position in editable content.',
      unsupported_target: 'Current focus is not a supported text field.'
    };

    setStatus(reasonToMessage[result?.reason] || 'Insert failed.', 'warn');
    return false;
  } catch (error) {
    const message = error?.message || '';
    if (/Cannot access a chrome:\/\//i.test(message)) {
      setStatus('Browser internal pages are not supported. Open a normal website tab.', 'warn');
      return false;
    }

    if (/must request permission to access the respective host/i.test(message)) {
      setStatus('Site permission unavailable. Reload extension and retry.', 'warn');
      return false;
    }

    setStatus(`Insert failed: ${message}`, 'bad');
    return false;
  }
}
