// Forwards keyboard shortcuts to the content script in the active tab.

const COMMAND_MESSAGES = {
  "increase-text": { type: "adjust-scale", delta: 10 },
  "decrease-text": { type: "adjust-scale", delta: -10 },
  "reset-text": { type: "reset-scale" },
  "toggle-highlighter": { type: "toggle-highlighter" },
};

chrome.commands.onCommand.addListener(async (command) => {
  const message = COMMAND_MESSAGES[command];
  if (!message) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script on this page (chrome://, Web Store, etc.) - ignore.
  }
});
