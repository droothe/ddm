(() => {
  const DDM_TITLE = "droothe download manager";

  function isDdmPage() {
    return document.title.toLowerCase().includes(DDM_TITLE);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ddm:probe") {
      sendResponse({ isDdmPage: isDdmPage() });
      return;
    }

    if (message?.type !== "ddm:relay-download" || !isDdmPage()) return;

    let url;
    try {
      url = new URL(message.url);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    window.postMessage({ type: "ddm:add-download", url: url.href }, "*");
    sendResponse({ delivered: true });
  });
})();
