(() => {
  if (window.__quickVoiceInjected) {
    return;
  }
  window.__quickVoiceInjected = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);
  const STYLE_ID = 'quick-voice-style';
  const OVERLAY_ID = 'quick-voice-overlay';
  const DOUBLE_CONTROL_WINDOW_MS = 450;

  const state = {
    recognition: null,
    listening: false,
    lastError: '',
    finalText: '',
    interimText: '',
    target: null,
    controlTapStartedAt: 0,
    controlTapResetTimer: 0
  };

  setupDoubleControlTrigger();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'quickVoice:start') {
      return;
    }

    void startQuickVoice().then(sendResponse);
    return true;
  });

  function isSupportedTarget(element) {
    if (!element) {
      return false;
    }

    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }

    if (element instanceof HTMLInputElement) {
      const type = (element.type || 'text').toLowerCase();
      return INPUT_TYPES.has(type) && !element.disabled && !element.readOnly;
    }

    return Boolean(element.isContentEditable);
  }

  function getPreferredTarget() {
    const active = document.activeElement;
    if (isSupportedTarget(active)) {
      return active;
    }

    return null;
  }

  async function startQuickVoice() {
    ensureOverlay();

    if (!SpeechRecognition) {
      setOverlayStatus('This page does not support voice recognition.', 'warn', true);
      return { ok: false, reason: 'speech_unsupported' };
    }

    if (state.listening) {
      stopCurrentRecognition();
      setOverlayStatus('Stopped.', 'warn', true);
      return { ok: true, reason: 'stopped' };
    }

    const target = getPreferredTarget();
    if (!target) {
      setOverlayStatus('Click inside a text box, then double-press Control again.', 'warn', true);
      return { ok: false, reason: 'no_target' };
    }

    state.target = target;
    state.finalText = '';
    state.interimText = '';
    state.lastError = '';

    const micGranted = await ensureMicrophonePermission();
    if (!micGranted) {
      return { ok: false, reason: 'mic_denied' };
    }

    const lang = await getRecognitionLang();
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      state.listening = true;
      setOverlayStatus('Recording... speak now', 'ok', false);
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

      const preview = state.interimText || state.finalText;
      if (preview) {
        setOverlayStatus(`Recording... ${clipText(preview, 40)}`, 'ok', false);
      }
    };

    recognition.onerror = (event) => {
      state.lastError = event.error || '';
      const messageMap = {
        'not-allowed': 'Microphone permission denied.',
        'service-not-allowed': 'Speech service was blocked by browser settings.',
        'audio-capture': 'No microphone detected.',
        'no-speech': 'No speech detected.',
        network: 'Network error.',
        aborted: 'Recording aborted.'
      };
      setOverlayStatus(messageMap[event.error] || `Voice error: ${event.error}`, 'warn', true);
    };

    recognition.onend = () => {
      state.listening = false;
      const payload = (state.finalText || state.interimText).trim();
      state.recognition = null;

      if (payload) {
        const inserted = insertIntoTarget(state.target, payload) || insertIntoTarget(getPreferredTarget(), payload);
        if (inserted) {
          setOverlayStatus('Inserted.', 'ok', true);
        } else {
          setOverlayStatus('No valid text target to insert.', 'warn', true);
        }
        return;
      }

      if (!state.lastError) {
        setOverlayStatus('No speech captured.', 'warn', true);
      }
    };

    state.recognition = recognition;

    try {
      recognition.start();
      return { ok: true };
    } catch (error) {
      setOverlayStatus(`Failed to start: ${error.message}`, 'warn', true);
      return { ok: false, reason: 'start_failed' };
    }
  }

  async function getRecognitionLang() {
    try {
      const stored = await chrome.storage.local.get({ lang: 'yue-Hant-HK' });
      return stored.lang || 'yue-Hant-HK';
    } catch (_error) {
      return 'yue-Hant-HK';
    }
  }

  async function ensureMicrophonePermission() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setOverlayStatus('This page cannot request microphone access.', 'warn', true);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch (error) {
      if (error?.name === 'NotAllowedError') {
        setOverlayStatus('Microphone access denied. Please allow microphone.', 'warn', true);
      } else if (error?.name === 'NotFoundError') {
        setOverlayStatus('No microphone found.', 'warn', true);
      } else {
        setOverlayStatus(`Microphone request failed: ${error?.message || 'unknown error'}`, 'warn', true);
      }
      return false;
    }
  }

  function stopCurrentRecognition() {
    if (!state.recognition || !state.listening) {
      return;
    }

    try {
      state.recognition.stop();
    } catch (_error) {
      // no-op
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

  function insertIntoTarget(target, payload) {
    if (!isSupportedTarget(target) || !payload) {
      return false;
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.focus();
      const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
      target.value = `${target.value.slice(0, start)}${payload}${target.value.slice(end)}`;
      const cursor = start + payload.length;
      target.selectionStart = cursor;
      target.selectionEnd = cursor;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (target.isContentEditable) {
      target.focus();
      const selection = window.getSelection();
      if (!selection) {
        return false;
      }

      if (selection.rangeCount === 0) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(payload));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    return false;
  }

  function clipText(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength - 1)}...`;
  }

  function setupDoubleControlTrigger() {
    window.addEventListener('keydown', handleDoubleControlKeydown, true);
    window.addEventListener('blur', clearPendingControlTap, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
  }

  function handleDoubleControlKeydown(event) {
    if (event.repeat) {
      return;
    }

    if (event.key !== 'Control') {
      clearPendingControlTap();
      return;
    }

    if (event.altKey || event.metaKey || event.shiftKey) {
      clearPendingControlTap();
      return;
    }

    const now = Date.now();
    const withinWindow = state.controlTapStartedAt > 0 && (now - state.controlTapStartedAt) <= DOUBLE_CONTROL_WINDOW_MS;

    if (withinWindow) {
      clearPendingControlTap();
      void startQuickVoice();
      return;
    }

    rememberControlTap(now);
  }

  function rememberControlTap(timestamp) {
    state.controlTapStartedAt = timestamp;
    if (state.controlTapResetTimer) {
      window.clearTimeout(state.controlTapResetTimer);
      state.controlTapResetTimer = 0;
    }

    state.controlTapResetTimer = window.setTimeout(() => {
      state.controlTapStartedAt = 0;
      state.controlTapResetTimer = 0;
    }, DOUBLE_CONTROL_WINDOW_MS);
  }

  function clearPendingControlTap() {
    state.controlTapStartedAt = 0;
    if (state.controlTapResetTimer) {
      window.clearTimeout(state.controlTapResetTimer);
      state.controlTapResetTimer = 0;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearPendingControlTap();
    }
  }

  function ensureOverlay() {
    ensureOverlayStyle();
    if (document.getElementById(OVERLAY_ID)) {
      return;
    }

    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.innerHTML = `
      <div class="quick-voice-pill quick-voice-neutral">
        <span class="quick-voice-dot" aria-hidden="true"></span>
        <span class="quick-voice-text">Ready</span>
      </div>
    `;

    document.documentElement.appendChild(root);
  }

  function ensureOverlayStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "Segoe UI", "PingFang HK", "Microsoft JhengHei", sans-serif;
      }
      #${OVERLAY_ID} .quick-voice-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: min(80vw, 320px);
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid #d7deea;
        background: rgba(255, 255, 255, 0.96);
        color: #172033;
        font-size: 12px;
        line-height: 1.2;
        box-shadow: 0 10px 20px rgba(17, 25, 40, 0.12);
      }
      #${OVERLAY_ID} .quick-voice-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #7a869f;
        flex: 0 0 auto;
      }
      #${OVERLAY_ID} .quick-voice-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${OVERLAY_ID} .quick-voice-ok .quick-voice-dot {
        background: #d83b20;
        animation: quickVoicePulse 1s infinite;
      }
      #${OVERLAY_ID} .quick-voice-warn .quick-voice-dot {
        background: #cc8f00;
      }
      #${OVERLAY_ID} .quick-voice-neutral .quick-voice-dot {
        background: #7a869f;
      }
      @keyframes quickVoicePulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.35; transform: scale(1.1); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;

    document.documentElement.appendChild(style);
  }

  let hideOverlayTimer = 0;

  function setOverlayStatus(message, tone, autoHide) {
    ensureOverlay();
    const root = document.getElementById(OVERLAY_ID);
    if (!root) {
      return;
    }

    const pill = root.querySelector('.quick-voice-pill');
    const text = root.querySelector('.quick-voice-text');
    if (!pill || !text) {
      return;
    }

    pill.classList.remove('quick-voice-neutral', 'quick-voice-ok', 'quick-voice-warn');
    if (tone === 'ok') {
      pill.classList.add('quick-voice-ok');
    } else if (tone === 'warn') {
      pill.classList.add('quick-voice-warn');
    } else {
      pill.classList.add('quick-voice-neutral');
    }

    text.textContent = message;
    root.style.display = 'block';

    if (hideOverlayTimer) {
      window.clearTimeout(hideOverlayTimer);
      hideOverlayTimer = 0;
    }

    if (autoHide) {
      hideOverlayTimer = window.setTimeout(() => {
        root.style.display = 'none';
      }, 1800);
    }
  }
})();
