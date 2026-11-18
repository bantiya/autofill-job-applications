// Service worker. Fans a "fill" request out to every frame of a tab (application
// forms are often inside iframes, e.g. embedded Greenhouse) and merges the results.

async function fillAllFrames(tabId, options) {
  let frames = [];
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  } catch (e) {
    frames = [{ frameId: 0 }];
  }

  const replies = await Promise.all(
    frames.map((f) =>
      chrome.tabs
        .sendMessage(tabId, { type: 'JA_FILL', options: options || {} }, { frameId: f.frameId })
        .catch(() => null) // frame without our content script (about:blank, blocked, etc.)
    )
  );

  const merged = { filled: 0, review: 0, skipped: 0, fields: [], error: null, frames: 0 };
  for (const r of replies) {
    if (!r) continue;
    if (r.error && !merged.error) merged.error = r.error;
    if (!r.touched) continue; // frame had nothing that looks like a form
    merged.frames += 1;
    merged.filled += r.filled || 0;
    merged.review += r.review || 0;
    merged.skipped += r.skipped || 0;
    merged.fields.push(...(r.fields || []));
  }
  return merged;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'JA_FILL_TAB') {
    const tabId = msg.tabId != null ? msg.tabId : sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ error: 'No tab to fill.' });
      return false;
    }
    fillAllFrames(tabId, msg.options).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true; // async response
  }

  // A frame found an application form; ask the top frame to show the floating button.
  if (msg.type === 'JA_FORM_DETECTED' && sender.tab) {
    chrome.tabs
      .sendMessage(sender.tab.id, { type: 'JA_SHOW_BUTTON' }, { frameId: 0 })
      .catch(() => {});
    return false;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-panel') {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (t && t.id != null) chrome.tabs.sendMessage(t.id, { type: 'JA_TOGGLE_PANEL' }, { frameId: 0 }).catch(() => {});
    return;
  }
  if (command !== 'fill-application') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const result = await fillAllFrames(tab.id, {});
  chrome.tabs.sendMessage(tab.id, { type: 'JA_TOAST', result }, { frameId: 0 }).catch(() => {});
});
