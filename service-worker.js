async function enablePanelOnIconClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to enable side panel behavior', error);
  }
}

chrome.runtime.onInstalled.addListener(enablePanelOnIconClick);
chrome.runtime.onStartup.addListener(enablePanelOnIconClick);

const BLOCKED_URL_SCHEMES = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];

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

function isBlockedTab(tab) {
  const url = getTabUrl(tab);
  return Boolean(url) && BLOCKED_URL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

async function ensureQuickVoiceScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js']
  });
}

async function startQuickSpeakInsertForActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') {
    return;
  }

  if (isBlockedTab(tab)) {
    return;
  }

  try {
    await ensureQuickVoiceScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'quickVoice:start' });
  } catch (error) {
    const message = error?.message || '';
    if (/Cannot access a chrome:\/\//i.test(message)) {
      return;
    }

    throw error;
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'quick-speak-insert') {
    return;
  }

  startQuickSpeakInsertForActiveTab().catch((error) => {
    console.error('quick-speak-insert failed', error);
  });
});
