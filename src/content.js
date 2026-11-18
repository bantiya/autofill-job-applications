// Content script entry point (runs in every frame). Responsibilities:
//  - answer "fill" requests from the popup / floating button / keyboard shortcut
//  - detect application forms and ask the top frame to show a floating "Autofill" button
(function () {
  'use strict';
  const JA = self.JA;
  if (!JA || !JA.fillAll || window.__jobAutofillLoaded) return;
  window.__jobAutofillLoaded = true;

  const isTop = window.top === window;

  async function runFill(options) {
    const store = await chrome.storage.local.get(['profile', 'resume', 'sections']);
    return JA.fillAll({
      profile: store.profile || {}, // basics, education, experience and answers are locked in src/*.js
      resume: store.resume || null,
      overwrite: !!(options && options.overwrite),
      sections: store.sections || {},
    });
  }

  // ---- docked side panel (top frame only, inside a shadow root so page CSS can't touch it) ----
  // Right-hand panel that shows the same UI as the toolbar popup (popup.html in an iframe). It pushes the
  // page to the left while open, and collapses into a small round button on the right edge.
  const PANEL_W = 360;
  let host = null;
  let shadow = null;
  let toastEl = null;
  let toastTimer = null;
  let open = true;
  let savedWidth = null;

  function applyOpen() {
    if (!shadow) return;
    shadow.getElementById('panel').style.display = open ? 'block' : 'none';
    shadow.getElementById('launch').style.display = open ? 'none' : 'flex';
    shadow.getElementById('toast').style.right = (open ? PANEL_W + 16 : 20) + 'px';
    const root = document.documentElement;
    if (open) {
      if (savedWidth === null) savedWidth = [root.style.getPropertyValue('width'), root.style.getPropertyPriority('width')];
      root.style.setProperty('width', `calc(100% - ${PANEL_W}px)`, 'important');
    } else if (savedWidth !== null) {
      if (savedWidth[0]) root.style.setProperty('width', savedWidth[0], savedWidth[1]);
      else root.style.removeProperty('width');
      savedWidth = null;
    }
  }

  function setOpen(v) {
    open = !!v;
    applyOpen();
    try { chrome.storage.local.set({ panelOpen: open }); } catch (e) { /* extension reloaded */ }
  }

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = 'job-autofill-root';
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}
        #panel{position:fixed;top:0;right:0;width:${PANEL_W}px;height:100vh;background:#fff;border-left:1px solid #e5e7eb;box-shadow:-4px 0 16px rgba(0,0,0,.12)}
        #panel iframe{width:100%;height:100%;border:0;display:block}
        #launch{position:fixed;top:160px;right:0;width:46px;height:46px;border-radius:23px 0 0 23px;background:#4f46e5;color:#fff;border:0;cursor:pointer;align-items:center;justify-content:center;font:700 18px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:-2px 2px 10px rgba(0,0,0,.25);padding:0}
        #launch:hover{background:#4338ca;width:52px}
        .toast{position:fixed;bottom:20px;right:20px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#111827;color:#f9fafb;border-radius:10px;padding:10px 14px;max-width:300px;box-shadow:0 4px 14px rgba(0,0,0,.3);display:none}
        .toast.show{display:block}
        .toast b{color:#a5b4fc}
      </style>
      <div class="toast" id="toast"></div>
      <div id="panel"><iframe id="frame" title="Job Autofill" src="${chrome.runtime.getURL('popup.html')}?embedded=1"></iframe></div>
      <button id="launch" type="button" title="Open Job Autofill" aria-label="Open Job Autofill">J</button>`;
    toastEl = shadow.getElementById('toast');
    shadow.getElementById('launch').addEventListener('click', () => setOpen(true));
    window.addEventListener('message', (ev) => {
      const fr = shadow.getElementById('frame');
      if (fr && ev.source === fr.contentWindow && ev.data && ev.data.ja === 'minimize') setOpen(false);
    });
    document.documentElement.appendChild(host);
    applyOpen();
    return host;
  }

  async function showPanel() {
    if (!isTop || host) return;
    try {
      const { panelOpen } = await chrome.storage.local.get('panelOpen');
      open = panelOpen !== false;
    } catch (e) { open = true; }
    ensureHost();
  }

  function showToast(result) {
    ensureHost();
    let html;
    if (typeof result === 'string') html = result;
    else if (!result || result.error) html = (result && result.error) || 'Nothing to fill on this page.';
    else if (!result.filled && !result.review) html = 'No matching fields found on this page.';
    else {
      html = `Filled <b>${result.filled}</b> field${result.filled === 1 ? '' : 's'}`;
      if (result.review) html += ` · <b>${result.review}</b> need${result.review === 1 ? 's' : ''} your attention (outlined in orange)`;
      html += '<br>Review everything before you submit.';
    }
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('show'), 7000);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'JA_FILL') {
      runFill(msg.options).then(sendResponse, (e) => sendResponse({ touched: false, error: String(e) }));
      return true;
    }
    if (msg.type === 'JA_SHOW_BUTTON' && isTop) showPanel();
    if (msg.type === 'JA_TOGGLE_PANEL' && isTop) { ensureHost(); setOpen(!open); }
    if (msg.type === 'JA_TOAST' && isTop) showToast(msg.result);
    return false;
  });

  // ---- application-form detection (cheap, debounced, gives up after a while) -------------------
  let checks = 0;
  let timer = null;
  let observer = null;
  let announced = false;

  function check() {
    timer = null;
    if (announced || ++checks > 40) return stop();
    let found = false;
    try { found = JA.filler.looksLikeApplication(); } catch (e) { found = false; }
    if (found) {
      announced = true;
      chrome.runtime.sendMessage({ type: 'JA_FORM_DETECTED' }).catch(() => {});
      stop();
    }
  }

  function schedule(delay) {
    if (timer || announced) return;
    timer = setTimeout(check, delay);
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
  }

  // Known application sites show the panel straight away (their early steps, such as Workday's
  // "My Information", have too few recognisable fields for the form check below).
  const APPLY_HOSTS = /(^|\.)(myworkdayjobs|myworkdaysite|workday|greenhouse|lever|ashbyhq|icims|smartrecruiters|taleo|jobvite|bamboohr|workable|breezy|recruitee|successfactors|oraclecloud|dayforcehcm|paylocity|ultipro)\./i;
  const APPLY_PATH = /\/(apply|application|applynow|apply-now)(\/|$|\?)/i;
  if (isTop && (APPLY_HOSTS.test(location.hostname) || APPLY_PATH.test(location.pathname))) {
    announced = true;
    showPanel();
    return;
  }

  schedule(1200);
  observer = new MutationObserver(() => schedule(900));
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
