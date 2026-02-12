const FIRST_RUN_SETUP_KEY = 'firstRunSetupDone';
const ONBOARDING_PAGE = 'onboarding.html';
const BLOCKED_URL_SCHEMES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];

async function enablePanelOnIconClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to enable side panel behavior', error);
  }
}

async function openOnboardingTabIfNeeded(reason) {
  if (reason !== 'install') {
    return;
  }

  try {
    const saved = await chrome.storage.local.get({ [FIRST_RUN_SETUP_KEY]: false });
    if (saved[FIRST_RUN_SETUP_KEY]) {
      return;
    }

    await chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) });
  } catch (error) {
    console.error('Failed to open onboarding page', error);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void enablePanelOnIconClick();
  void openOnboardingTabIfNeeded(details?.reason || '');
});

chrome.runtime.onStartup.addListener(() => {
  void enablePanelOnIconClick();
});

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

async function getCurrentActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function insertTextInTab(tabId, payload) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (text) => {
      const active = document.activeElement;
      if (!active) {
        return { ok: false, reason: 'no_target' };
      }

      const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);
      const isTextArea = active instanceof HTMLTextAreaElement;
      const isTextInput = active instanceof HTMLInputElement && textInputTypes.has(active.type);

      const emitInput = () => {
        try {
          active.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
          }));
        } catch (_error) {
          active.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };

      if (isTextArea || isTextInput) {
        active.focus();
        const start = typeof active.selectionStart === 'number' ? active.selectionStart : active.value.length;
        const end = typeof active.selectionEnd === 'number' ? active.selectionEnd : active.value.length;

        if (typeof active.setRangeText === 'function') {
          active.setRangeText(text, start, end, 'end');
        } else {
          active.value = `${active.value.slice(0, start)}${text}${active.value.slice(end)}`;
          const cursor = start + text.length;
          active.selectionStart = cursor;
          active.selectionEnd = cursor;
        }

        emitInput();
        active.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }

      if (!active.isContentEditable) {
        return { ok: false, reason: 'unsupported_target' };
      }

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
          insertedByCommand = document.execCommand('insertText', false, text);
        } catch (_error) {
          insertedByCommand = false;
        }
      }

      if (!insertedByCommand) {
        if (selection.rangeCount === 0) {
          ensureCaretInsideTarget();
        }

        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      emitInput();
      return { ok: true };
    },
    args: [payload]
  });

  return result || { ok: false, reason: 'script_failed' };
}

async function handleInsertTextRequest(message, sender) {
  const payload = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!payload) {
    return { ok: false, reason: 'empty_text' };
  }

  let tab = null;
  if (typeof message?.tabId === 'number') {
    tab = await chrome.tabs.get(message.tabId).catch(() => null);
  } else if (sender?.tab?.id) {
    tab = sender.tab;
  } else {
    tab = await getCurrentActiveTab();
  }

  if (!tab || typeof tab.id !== 'number') {
    return { ok: false, reason: 'tab_not_found' };
  }

  if (isBrowserInternalTab(tab)) {
    return { ok: false, reason: 'unsupported_page' };
  }

  try {
    return await insertTextInTab(tab.id, payload);
  } catch (_error) {
    return { ok: false, reason: 'insert_failed' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'insertTextIntoActiveContext') {
    return;
  }

  void handleInsertTextRequest(message, sender).then(sendResponse);
  return true;
});
