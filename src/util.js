// DOM + async helpers shared by the matcher, filler and adapters.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Poll `fn` until it returns something truthy (returned) or `timeout` ms pass (null).
  async function waitFor(fn, timeout, interval) {
    const end = Date.now() + (timeout == null ? 2000 : timeout);
    const step = interval || 60;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(step);
    }
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const win = el.ownerDocument.defaultView;
    if (!win) return false;
    const st = win.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false; // collapsed, e.g. react-select's hidden "required" mirror input
    if (r.right <= 0) return false; // parked off-screen to the left: honeypot
    // Invisible and not tabbable: a validation shim or honeypot, never something a person fills in
    if (st.opacity === '0' && el.tabIndex === -1) return false;
    return true;
  }

  // Find an element by id in the same tree (document or shadow root) as `el`.
  function byId(el, id) {
    const rootNode = el.getRootNode && el.getRootNode();
    return (rootNode && rootNode.getElementById && rootNode.getElementById(id)) || el.ownerDocument.getElementById(id);
  }

  // querySelectorAll that also walks into open shadow roots.
  function deepQueryAll(rootNode, selector) {
    const out = Array.from(rootNode.querySelectorAll(selector));
    rootNode.querySelectorAll('*').forEach((n) => {
      if (n.shadowRoot) out.push(...deepQueryAll(n.shadowRoot, selector));
    });
    return out;
  }

  // Set a value the way a user's typing would, so React/Vue/Angular notice it. The native
  // setter bypasses the framework's own value tracking, which is what makes this work.
  function setNativeValue(el, value) {
    const win = el.ownerDocument.defaultView;
    let proto = win.HTMLInputElement.prototype;
    if (el instanceof win.HTMLTextAreaElement) proto = win.HTMLTextAreaElement.prototype;
    else if (el instanceof win.HTMLSelectElement) proto = win.HTMLSelectElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInputEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setText(el, value, keepFocus) {
    if (typeof el.focus === 'function') el.focus();
    setNativeValue(el, value);
    fireInputEvents(el);
    if (!keepFocus && typeof el.blur === 'function') el.blur();
  }

  // Full pointer sequence; many custom widgets listen for mousedown rather than click.
  // Enter text the way a keyboard would: one key at a time, with key and input events for each,
  // for widgets that ignore a value that was simply assigned.
  function typeKeys(el, text) {
    const win = el.ownerDocument.defaultView;
    if (typeof el.focus === 'function') el.focus();
    if (typeof el.select === 'function') { try { el.select(); } catch (e) { /* not selectable */ } }
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of String(text)) {
      const key = { key: ch, code: /\d/.test(ch) ? 'Digit' + ch : '', bubbles: true, cancelable: true, composed: true };
      el.dispatchEvent(new win.KeyboardEvent('keydown', key));
      el.dispatchEvent(new win.InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true, composed: true }));
      setNativeValue(el, el.value + ch);
      el.dispatchEvent(new win.InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true, composed: true }));
      el.dispatchEvent(new win.KeyboardEvent('keyup', key));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof el.blur === 'function') el.blur();
  }

  function realClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true }));
    });
  }

  function base64ToFile(b64, name, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name || 'resume.pdf', { type: type || 'application/pdf' });
  }

  function attachFile(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    fireInputEvents(input);
  }

  JA.util = {
    sleep, waitFor, isVisible, byId, deepQueryAll, typeKeys,
    setNativeValue, fireInputEvents, setText, realClick, base64ToFile, attachFile,
  };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
