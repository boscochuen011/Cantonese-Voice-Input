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
      setOverlayStatus('此頁面不支援語音辨識。', 'warn', true);
      return { ok: false, reason: 'speech_unsupported' };
    }

    if (state.listening) {
      stopCurrentRecognition();
      setOverlayStatus('已停止。', 'warn', true);
      return { ok: true, reason: 'stopped' };
    }

    const target = getPreferredTarget();
    if (!target) {
      setOverlayStatus('呢個位置唔支援輸入（例如主介面或無輸入欄）。請先點選文字欄，再連按兩下 Control。', 'warn', true);
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
      setOverlayStatus('錄音中\n請開始說話', 'ok', false);
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
        setOverlayStatus(`錄音中\n${preview}`, 'ok', false);
      }
    };

    recognition.onerror = (event) => {
      state.lastError = event.error || '';
      const messageMap = {
        'not-allowed': '麥克風權限被拒絕。',
        'service-not-allowed': '瀏覽器設定封鎖了語音服務。',
        'audio-capture': '找不到麥克風。',
        'no-speech': '未偵測到語音。',
        network: '網路錯誤。',
        aborted: '錄音已中止。'
      };
      setOverlayStatus(messageMap[event.error] || `語音錯誤：${event.error}`, 'warn', true);
    };

    recognition.onend = () => {
      state.listening = false;
      const payload = (state.finalText || state.interimText).trim();
      state.recognition = null;

      if (payload) {
        void insertViaBackground(payload);
        return;
      }

      if (!state.lastError) {
        setOverlayStatus('未擷取到語音。', 'warn', true);
      }
    };

    state.recognition = recognition;

    try {
      recognition.start();
      return { ok: true };
    } catch (error) {
      setOverlayStatus(`開始失敗：${error.message}`, 'warn', true);
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
      setOverlayStatus('此頁面無法要求麥克風權限。', 'warn', true);
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
        setOverlayStatus('麥克風權限被拒絕，請改為允許。', 'warn', true);
      } else if (error?.name === 'NotFoundError') {
        setOverlayStatus('找不到可用麥克風。', 'warn', true);
      } else {
        setOverlayStatus(`麥克風請求失敗：${error?.message || '未知錯誤'}`, 'warn', true);
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

  async function insertViaBackground(payload) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'insertTextIntoActiveContext',
        text: payload
      });

      if (response?.ok) {
        setOverlayStatus('已插入文字。', 'ok', true);
        return;
      }

      const reasonToMessage = {
        no_target: '請先點選文字輸入欄，再連按兩下 Control。',
        unsupported_target: '目前焦點位置不支援插字。',
        unsupported_page: '此頁面不支援輸入，請切換到一般網站。',
        selection_missing: '無法定位游標，請重新點選輸入欄。',
        tab_not_found: '找不到作用中的分頁。',
        empty_text: '沒有可插入的文字。'
      };

      setOverlayStatus(reasonToMessage[response?.reason] || '插入失敗，請再試一次。', 'warn', true);
    } catch (_error) {
      setOverlayStatus('插入失敗，請再試一次。', 'warn', true);
    }
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

    setOverlayStatus('快捷鍵已啟動\n再按一次 Control 開始錄音（要先揀文字輸入欄）', 'neutral', true);
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
        <div class="quick-voice-body">
          <span class="quick-voice-chip">2x Ctrl</span>
          <span class="quick-voice-text">準備就緒</span>
        </div>
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
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: 8px;
        width: min(86vw, 360px);
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid #d7deea;
        background: rgba(255, 255, 255, 0.96);
        color: #172033;
        font-size: 12px;
        line-height: 1.35;
        box-shadow: 0 10px 20px rgba(17, 25, 40, 0.12);
      }
      #${OVERLAY_ID} .quick-voice-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #7a869f;
        flex: 0 0 auto;
        margin-top: 5px;
      }
      #${OVERLAY_ID} .quick-voice-body {
        min-width: 0;
        display: grid;
        gap: 5px;
      }
      #${OVERLAY_ID} .quick-voice-chip {
        justify-self: start;
        border: 1px solid #cad4e7;
        border-radius: 999px;
        background: #f6f9ff;
        color: #4a5980;
        padding: 1px 8px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      #${OVERLAY_ID} .quick-voice-text {
        display: block;
        overflow-y: auto;
        max-height: 88px;
        white-space: pre-wrap;
        word-break: break-word;
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
