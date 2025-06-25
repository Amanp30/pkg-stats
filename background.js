chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    columns: { daily: true, weekly: true, monthly: true, yearly: true },
    defaultService: "npm",
  });
  chrome.storage.local.set({
    trackedPackages: [],
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) {
    console.warn("No tab ID or URL");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scripts/inject.js"],
    });
  } catch (e) {
    console.error("Injection failed:", e);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openOptionsPage") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  }
});
