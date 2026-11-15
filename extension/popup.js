const status = document.getElementById("status");

chrome.tabs.query({}, (tabs) => {
  if (chrome.runtime.lastError) {
    status.textContent = "Could not check open tabs.";
    console.error("Could not check for a DDM tab.", chrome.runtime.lastError.message);
    return;
  }

  const candidates = tabs.filter((tab) => typeof tab.id === "number");
  if (candidates.length === 0) {
    status.textContent = "Open the DDM web app in a tab to get started.";
    return;
  }

  let remaining = candidates.length;
  let foundDdm = false;

  for (const tab of candidates) {
    chrome.tabs.sendMessage(tab.id, { type: "ddm:probe" }, (response) => {
      if (!chrome.runtime.lastError && response?.isDdmPage) foundDdm = true;
      remaining -= 1;
      if (remaining === 0) {
        status.textContent = foundDdm
          ? "DDM is open and ready."
          : "Open the DDM web app in a tab to get started.";
      }
    });
  }
});
