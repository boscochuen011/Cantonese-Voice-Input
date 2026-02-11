async function enablePanelOnIconClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to enable side panel behavior', error);
  }
}

chrome.runtime.onInstalled.addListener(enablePanelOnIconClick);
chrome.runtime.onStartup.addListener(enablePanelOnIconClick);
