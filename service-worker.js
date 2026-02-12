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
      const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);
      const editableSelector = [
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]',
        'textarea',
        'input[type="text"]',
        'input[type="search"]',
        'input[type="url"]',
        'input[type="tel"]',
        'input[type="password"]',
        'input[type="email"]',
        'input[type="number"]',
        'input:not([type])'
      ].join(', ');

      const isTextEntryInput = (element) => {
        if (element instanceof HTMLTextAreaElement) {
          return !element.disabled && !element.readOnly;
        }

        if (element instanceof HTMLInputElement) {
          return textInputTypes.has(element.type) && !element.disabled && !element.readOnly;
        }

        return false;
      };

      const isEditableElement = (element) => {
        if (!element) {
          return false;
        }

        return isTextEntryInput(element) || Boolean(element.isContentEditable);
      };

      const isVisibleElement = (element) => {
        if (!(element instanceof Element)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const findLikelyEditableTarget = () => {
        const candidates = document.querySelectorAll(editableSelector);
        let fallback = null;

        for (const candidate of candidates) {
          if (!isEditableElement(candidate)) {
            continue;
          }

          if (!fallback) {
            fallback = candidate;
          }

          if (isVisibleElement(candidate)) {
            return candidate;
          }
        }

        return fallback;
      };

      const active = isEditableElement(document.activeElement)
        ? document.activeElement
        : findLikelyEditableTarget();

      if (!active) {
        return { ok: false, reason: 'no_target' };
      }

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

      const editRoot = active.closest?.('[data-slate-editor="true"]') || active;
      const isSlateEditor = Boolean(
        editRoot?.getAttribute?.('data-slate-editor') === 'true'
        || editRoot?.closest?.('[data-slate-editor="true"]')
      );
      const getSlateValueRoot = () => editRoot.querySelector?.('[data-slate-node="value"]') || editRoot;
      const getSlatePlainText = () => {
        if (!isSlateEditor) {
          return '';
        }

        const slateValue = getSlateValueRoot();
        const textParts = Array.from(slateValue.querySelectorAll?.('[data-slate-string]') || [])
          .map((node) => node.textContent || '');
        return textParts.join('');
      };
      const getAnchorElement = (node) => {
        if (!node) {
          return null;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
          return node;
        }

        return node.parentElement;
      };
      const isSelectionInSlateZeroWidth = () => {
        if (!isSlateEditor || selection.rangeCount === 0) {
          return false;
        }

        const anchorElement = getAnchorElement(selection.anchorNode);
        return Boolean(anchorElement?.closest?.('[data-slate-zero-width]'));
      };

      const ensureCaretInsideTarget = () => {
        const range = document.createRange();
        if (isSlateEditor) {
          const slateValue = getSlateValueRoot();
          const slateStrings = Array.from(slateValue.querySelectorAll?.('[data-slate-string]') || []);
          let caretNode = null;

          for (let i = slateStrings.length - 1; i >= 0; i -= 1) {
            const element = slateStrings[i];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let lastText = null;
            while (walker.nextNode()) {
              lastText = walker.currentNode;
            }

            if (lastText && typeof lastText.nodeValue === 'string') {
              caretNode = lastText;
              break;
            }
          }

          if (!caretNode) {
            const zeroWidthNodes = Array.from(slateValue.querySelectorAll?.('[data-slate-zero-width]') || []);
            for (let i = zeroWidthNodes.length - 1; i >= 0; i -= 1) {
              const walker = document.createTreeWalker(zeroWidthNodes[i], NodeFilter.SHOW_TEXT);
              let lastText = null;
              while (walker.nextNode()) {
                lastText = walker.currentNode;
              }

              if (lastText && typeof lastText.nodeValue === 'string') {
                caretNode = lastText;
                break;
              }
            }
          }

          if (caretNode) {
            range.setStart(caretNode, caretNode.nodeValue.length);
            range.collapse(true);
          } else {
            range.selectNodeContents(slateValue);
            range.collapse(false);
          }
        } else {
          range.selectNodeContents(editRoot);
          range.collapse(false);
        }

        selection.removeAllRanges();
        selection.addRange(range);
      };

      if (
        selection.rangeCount === 0
        || !editRoot.contains(selection.anchorNode)
        || isSelectionInSlateZeroWidth()
      ) {
        ensureCaretInsideTarget();
      }

      const dispatchSlateBeforeInput = () => {
        if (!isSlateEditor || typeof InputEvent !== 'function') {
          return false;
        }

        try {
          const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
          });
          active.dispatchEvent(event);
          return true;
        } catch (_error) {
          return false;
        }
      };
      const dispatchSlateInput = () => {
        if (!isSlateEditor) {
          return;
        }

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
      const slateTextBefore = getSlatePlainText();
      if (isSlateEditor) {
        ensureCaretInsideTarget();
        const dispatched = dispatchSlateBeforeInput();
        if (dispatched) {
          const slateTextAfterBeforeInput = getSlatePlainText();
          if (slateTextAfterBeforeInput !== slateTextBefore) {
            return { ok: true };
          }
        }
      }

      let insertedByCommand = false;
      const tryInsertText = () => {
        if (typeof document.execCommand !== 'function') {
          return false;
        }

        try {
          return document.execCommand('insertText', false, text);
        } catch (_error) {
          return false;
        }
      };

      insertedByCommand = tryInsertText();
      if (!insertedByCommand && isSlateEditor) {
        ensureCaretInsideTarget();
        insertedByCommand = tryInsertText();
      }

      if (!insertedByCommand) {
        if (!isSlateEditor) {
          const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

          if (typeof document.execCommand === 'function') {
            try {
              insertedByCommand = document.execCommand('insertHTML', false, escaped);
            } catch (_error) {
              insertedByCommand = false;
            }
          }
        }
      }

      if (!insertedByCommand) {
        return { ok: false, reason: 'editor_insert_failed' };
      }

      if (isSlateEditor) {
        dispatchSlateInput();
        const slateTextAfterInsert = getSlatePlainText();
        if (slateTextAfterInsert === slateTextBefore) {
          return { ok: false, reason: 'editor_insert_failed' };
        }
      }

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
