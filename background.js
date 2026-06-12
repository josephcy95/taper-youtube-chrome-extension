chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-picture-in-picture") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/[^/]*youtube\.com\//.test(tab.url)) return;

  chrome.tabs.sendMessage(tab.id, { type: "taper-toggle-picture-in-picture" }).catch(() => {});
});
