const FIRST_RUN_SETUP_KEY = 'firstRunSetupDone';
const ONBOARDING_PAGE = 'onboarding.html';

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
