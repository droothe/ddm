const MENU_ID = "ddm-download-link";

function openDesktopApp(url) {
  const deepLink = `ddm://download?url=${encodeURIComponent(url)}`;
  chrome.tabs.create({ url: deepLink }, () => {
    if (chrome.runtime.lastError) {
      console.error("Could not open the DDM desktop app.", chrome.runtime.lastError.message);
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.error("Could not reset the DDM context menu.", chrome.runtime.lastError.message);
      return;
    }

    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: "Download with DDM",
        contexts: ["link"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Could not create the DDM context menu.", chrome.runtime.lastError.message);
        }
      },
    );
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || typeof info.linkUrl !== "string") return;

  let url;
  try {
    url = new URL(info.linkUrl);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error("Could not find open browser tabs.", chrome.runtime.lastError.message);
      return;
    }

    const candidates = tabs.filter((tab) => typeof tab.id === "number");
    Promise.all(
      candidates.map(
        (tab) =>
          new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: "ddm:probe" }, (response) => {
              resolve(!chrome.runtime.lastError && response?.isDdmPage ? tab : null);
            });
          }),
      ),
    ).then((matches) => {
      const ddmTab = matches.find((tab) => tab !== null);
      if (!ddmTab) {
        openDesktopApp(url.href);
        return;
      }

      chrome.tabs.sendMessage(ddmTab.id, { type: "ddm:relay-download", url: url.href }, () => {
        if (chrome.runtime.lastError) {
          console.error("Could not send the link to the DDM tab.", chrome.runtime.lastError.message);
        }
      });
    });
  });
});
