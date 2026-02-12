const FIRST_RUN_SETUP_KEY = 'firstRunSetupDone';
const SETUP_PROGRESS_KEY = 'setupProgress';
const MICROPHONE_SETTINGS_URL = 'chrome://settings/content/microphone';
const NORMAL_URL_PROTOCOLS = new Set(['http:', 'https:']);
const STEP_IDS = ['extensions', 'permission', 'shortcut'];

const ui = {
  openExtensionsBtn: document.getElementById('openExtensionsBtn'),
  openSitePermissionBtn: document.getElementById('openSitePermissionBtn'),
  openMicrophoneSettingsBtn: document.getElementById('openMicrophoneSettingsBtn'),
  openShortcutsBtn: document.getElementById('openShortcutsBtn'),
  currentSiteLabel: document.getElementById('currentSiteLabel'),
  progressText: document.getElementById('progressText'),
  completeSetupBtn: document.getElementById('completeSetupBtn'),
  skipSetupBtn: document.getElementById('skipSetupBtn'),
  finishMessage: document.getElementById('finishMessage'),
  stepChecks: Array.from(document.querySelectorAll('[data-step-check]')),
  stepCards: Array.from(document.querySelectorAll('.step-card'))
};

init();

async function init() {
  wireActions();
  await restoreSavedProgress();
  await updateCurrentSiteLabel();
  updateProgressUI();
}

function wireActions() {
  ui.openExtensionsBtn?.addEventListener('click', async () => {
    await openChromeTab('chrome://extensions/');
    markStepDone('extensions');
  });

  ui.openSitePermissionBtn?.addEventListener('click', async () => {
    await openCurrentSitePermission();
    markStepDone('permission');
  });

  ui.openMicrophoneSettingsBtn?.addEventListener('click', async () => {
    await openChromeTab(MICROPHONE_SETTINGS_URL);
  });

  ui.openShortcutsBtn?.addEventListener('click', async () => {
    await openChromeTab('chrome://extensions/shortcuts');
    markStepDone('shortcut');
  });

  ui.stepChecks.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      updateProgressUI();
      void saveStepProgress();
    });
  });

  ui.completeSetupBtn?.addEventListener('click', () => {
    void completeSetup();
  });

  ui.skipSetupBtn?.addEventListener('click', () => {
    setFinishMessage('你已暫時略過設定，可稍後在側邊面板重新開啟設定精靈。');
  });
}

function markStepDone(stepId) {
  const checkbox = ui.stepChecks.find((item) => item.dataset.stepCheck === stepId);
  if (!checkbox) {
    return;
  }

  checkbox.checked = true;
  updateProgressUI();
  void saveStepProgress();
}

async function restoreSavedProgress() {
  try {
    const saved = await chrome.storage.local.get({
      [SETUP_PROGRESS_KEY]: {},
      [FIRST_RUN_SETUP_KEY]: false
    });

    const progress = saved[SETUP_PROGRESS_KEY] || {};
    ui.stepChecks.forEach((checkbox) => {
      const stepId = checkbox.dataset.stepCheck || '';
      checkbox.checked = Boolean(progress[stepId]);
    });

    if (saved[FIRST_RUN_SETUP_KEY]) {
      ui.stepChecks.forEach((checkbox) => {
        checkbox.checked = true;
      });
      setFinishMessage('你之前已完成設定，可以檢查後直接關閉此分頁。');
    }
  } catch (_error) {
    // Keep default unchecked state.
  }
}

async function saveStepProgress() {
  const progress = {};
  ui.stepChecks.forEach((checkbox) => {
    const stepId = checkbox.dataset.stepCheck || '';
    progress[stepId] = checkbox.checked;
  });

  try {
    await chrome.storage.local.set({ [SETUP_PROGRESS_KEY]: progress });
  } catch (_error) {
    // Ignore storage errors; UI still works in current session.
  }
}

function updateProgressUI() {
  let doneCount = 0;

  ui.stepCards.forEach((card) => {
    const stepId = card.dataset.step || '';
    const checkbox = ui.stepChecks.find((item) => item.dataset.stepCheck === stepId);
    const done = Boolean(checkbox?.checked);
    if (done) {
      doneCount += 1;
    }
    card.classList.toggle('is-done', done);
  });

  if (ui.progressText) {
    ui.progressText.textContent = `已完成 ${doneCount} / ${STEP_IDS.length} 步。`;
  }

  if (ui.completeSetupBtn) {
    ui.completeSetupBtn.disabled = doneCount < STEP_IDS.length;
  }
}

async function completeSetup() {
  if (!ui.completeSetupBtn || ui.completeSetupBtn.disabled) {
    return;
  }

  const allDone = STEP_IDS.reduce((acc, stepId) => {
    acc[stepId] = true;
    return acc;
  }, {});

  try {
    await chrome.storage.local.set({
      [FIRST_RUN_SETUP_KEY]: true,
      onboardingCompletedAt: new Date().toISOString(),
      [SETUP_PROGRESS_KEY]: allDone
    });
  } catch (_error) {
    // Keep UX responsive even when storage is temporarily unavailable.
  }

  setFinishMessage('設定已完成並儲存，你可以關閉此分頁並開始使用插件。');
}

function setFinishMessage(message) {
  if (!ui.finishMessage) {
    return;
  }

  ui.finishMessage.textContent = message;
  ui.finishMessage.hidden = false;
}

async function openCurrentSitePermission() {
  const origin = await getActiveTabOrigin();
  if (!origin) {
    await openChromeTab(MICROPHONE_SETTINGS_URL);
    setFinishMessage('未偵測到一般網站分頁，已改為開啟全域麥克風設定。');
    await updateCurrentSiteLabel();
    return;
  }

  const permissionUrl = `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`;
  await openChromeTab(permissionUrl);
  setFinishMessage(`已開啟 ${origin} 的網站權限設定，請把麥克風設為「允許」。`);
  await updateCurrentSiteLabel(origin);
}

async function updateCurrentSiteLabel(originOverride) {
  if (!ui.currentSiteLabel) {
    return;
  }

  const origin = originOverride || await getActiveTabOrigin();
  ui.currentSiteLabel.textContent = origin
    ? `已偵測網站：${origin}`
    : '未偵測到一般網站分頁，請先開啟任何 https/http 網頁再重試。';
}

async function openChromeTab(url) {
  try {
    await chrome.tabs.create({ url });
    return;
  } catch (_error) {
    window.open(url, '_blank', 'noopener');
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

function isSupportedPageUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return NORMAL_URL_PROTOCOLS.has(parsed.protocol);
  } catch (_error) {
    return false;
  }
}

async function getActiveTabOrigin() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const candidates = tabs.filter((tab) => isSupportedPageUrl(getTabUrl(tab)));
    if (!candidates.length) {
      return '';
    }

    candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return new URL(getTabUrl(candidates[0])).origin;
  } catch (_error) {
    return '';
  }
}
