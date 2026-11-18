// The filling engine: turns a saved profile into values and writes them into the page.
//
// Safety rules baked in: it never submits a form, never ticks agreement / consent boxes,
// never guesses answers it has no profile data for, and flags required fields it left empty.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});
  const T = JA.text;
  const U = JA.util;
  const M = JA.matcher;

  // ---- adapters ------------------------------------------------------------------------
  JA.adapters = [];
  JA.registerAdapter = (a) => JA.adapters.unshift(a); // later registrations win
  JA.pickAdapter = () => {
    const found = JA.adapters.find((a) => {
      try { return a.match(location, document); } catch (e) { return false; }
    });
    return found || JA.defaultAdapter;
  };

  // ---- profile -> value ----------------------------------------------------------------
  function resolveValue(key, p, idx) {
    const b = p.basics || {};
    const a = p.application || {};
    const e = p.eeo || {};
    const exp = Array.isArray(p.experience) ? p.experience : [];

    switch (key) {
      case 'basics.fullName': return [b.firstName, b.lastName].filter(Boolean).join(' ');
      case 'basics.location': return [b.city, b.state].filter(Boolean).join(', ');
      case 'basics.currentCompany': return (exp[0] && exp[0].company) || '';
      case 'basics.currentTitle': return (exp[0] && exp[0].title) || '';
      case 'basics.skills': return Array.isArray(p.skills) ? p.skills.join(', ') : p.skills || '';
      case 'basics.coverLetter': return p.coverLetter || '';
      case 'application.authorizedWithoutSponsorship':
        if (!a.authorizedToWork || !a.requiresSponsorship) return '';
        return T.isYes(a.authorizedToWork) && T.isNo(a.requiresSponsorship) ? 'Yes' : 'No';
      default: break;
    }

    const [group, field] = key.split('.');
    if (group === 'experience' || group === 'education') {
      const list = Array.isArray(p[group]) ? p[group] : [];
      const item = list[idx];
      return item ? item[field] : undefined;
    }
    if (group === 'basics') return b[field];
    if (group === 'application') return a[field];
    if (group === 'eeo') return e[field];
    return undefined;
  }

  // Education is locked (src/education.js): whatever the saved profile says about it is ignored.
  function withLockedEducation(p, resume) {
    const E = JA.education;
    const B = JA.basics;
    const out = Object.assign({}, p);
    if (E && E.locked) out.education = E.entries;
    if (B && B.locked) out.basics = B.values;
    const X = JA.experience;
    if (X && X.locked) {
      // Descriptions come from the bullets read out of the uploaded PDF resume (by company), never from storage.
      const parsed = (resume && resume.parsed) || [];
      out.experience = X.entries.map((e) => {
        const hit = parsed.find((x) => x && x.company === e.company);
        return Object.assign({}, e, { description: hit ? hit.description || '' : '' });
      });
    }
    const A = JA.answers;
    if (A && A.locked) { out.application = A.application; out.eeo = A.eeo; }
    return out;
  }

  // Ordered names for a Degree / Field of Study control: the saved name first, then the fallbacks.
  function wantedFor(key, item) {
    const m = /^education\.(degree|field)$/.exec(key || '');
    return m && item && JA.education ? JA.education.wanted(item, m[1]) : null;
  }

  const DATE_KEY = /\.(startDate|endDate)$/;
  const FREE_TEXT_COMBOS = new Set(['basics.location', 'basics.city', 'basics.address', 'experience.company', 'experience.title']);

  // Text to type for a key. Dates adapt to month/year splits and to the field's format hint.
  function toText(c, desired) {
    if (desired == null || desired === '') return '';
    if (DATE_KEY.test(c.key)) {
      const p = T.parseDate(desired);
      if (!p || p.present) return '';
      if (c.part === 'year') return String(p.y);
      if (c.part === 'month') return String(p.m).padStart(2, '0');
      if (c.part === 'day') return String(p.d || 1).padStart(2, '0');
      const hint = (c.el.getAttribute('placeholder') || '') + ' ' + (c.label || '');
      return T.formatDate(p, T.dateStyleFrom((c.el.getAttribute('type') || '').toLowerCase(), hint));
    }
    return String(desired);
  }

  // ---- individual control writers ---------------------------------------------------------
  function listOptions(el) {
    const ids = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')].filter(Boolean);
    let list = [];
    ids.forEach((id) => {
      const box = U.byId(el, id);
      if (box) list.push(...box.querySelectorAll('[role="option"]'));
    });
    if (!list.length) {
      list = U.deepQueryAll(
        el.ownerDocument,
        '[role="listbox"] [role="option"], [class*="select__option" i], .pac-item, [class*="dropdown-results" i] li, [class*="autocomplete" i] li'
      ).filter((opt) => !belongsToAnotherControl(opt, el));
    }
    return list.filter(U.isVisible);
  }

  // A menu left open by a previous field (nothing matched, Escape ignored) must never be mistaken for
  // the current control's suggestions: that would click an option that belongs to a different field.
  // Menus rendered in a portal on <body> (Google Places, react-select with a portal) belong to nobody
  // and stay eligible.
  function belongsToAnotherControl(opt, el) {
    const box = opt.closest('[role="listbox"]');
    if (box && box.id) {
      const sel = '[aria-controls~="' + box.id + '"], [aria-owns~="' + box.id + '"]';
      const owner = Array.from(opt.ownerDocument.querySelectorAll(sel)).find((x) => x !== el);
      if (owner && !el.contains(owner)) return true;
    }
    let anc = opt.parentElement;
    for (let i = 0; i < 4 && anc; i++, anc = anc.parentElement) {
      if (anc.contains(el)) return false; // our own widget
      if (anc.querySelector('[role="combobox"], input.select__input')) return true; // another widget
    }
    return false;
  }

  // After typing into an autocomplete, click the matching suggestion if one shows up.
  async function pickSuggestion(el, desired, acceptFirst) {
    const found = await U.waitFor(() => { const o = listOptions(el); return o.length ? o : null; }, 1300);
    if (!found) return false;
    const options = found.map((o) => ({ text: o.textContent, value: o.getAttribute('data-value') || '' }));
    let idx = T.pickOption(options, desired);
    if (idx < 0 && acceptFirst) idx = 0;
    if (idx < 0) return false;
    U.realClick(found[idx]);
    await U.sleep(120);
    return true;
  }

  function selectHasValue(el) {
    if (el.selectedIndex < 0) return false;
    const o = el.options[el.selectedIndex];
    if (!o || !o.value) return false;
    if (el.selectedIndex === 0 && /^\s*(select|choose|please|--|—)/i.test(o.text)) return false;
    return true;
  }

  function comboHasValue(el) {
    const ctl = el.closest('[class*="control" i]');
    const sv = ctl && ctl.querySelector('[class*="single-value" i], [class*="singleValue" i]');
    return !!(sv && sv.textContent.trim());
  }

  // Workday fills in the year by itself as soon as the month is entered (month 01 gives year 2001).
  // A date box that was empty when we started and whose neighbour we just wrote is not something the
  // user typed, so it must not be "kept".
  function filledItself(c, ctx) {
    if (!DATE_KEY.test(c.key) || !c.part) return false;
    if (ctx.initiallyFilled && ctx.initiallyFilled.has(c.el)) return false;
    const group = c.el.closest('[role="group"], fieldset, [data-automation-id^="formField"]');
    return !!group && Array.from(group.querySelectorAll('[data-ja-filled="1"]')).some((x) => x !== c.el);
  }

  async function fillText(c, desired, ctx) {
    const el = c.el;
    let text = toText(c, desired);
    if (!text) return 'no-value';
    if ((el.getAttribute('type') || '') === 'number') text = text.replace(/[^0-9.]/g, '');
    if (el.maxLength > 0 && text.length > el.maxLength) text = text.slice(0, el.maxLength);
    if (!ctx.overwrite && el.value && el.value.trim() && el.dataset.jaFilled !== '1' && !filledItself(c, ctx)) return 'kept';
    const suggest = c.key === 'basics.location';
    U.setText(el, text, suggest);
    el.dataset.jaFilled = '1';
    if (DATE_KEY.test(c.key) && c.part && ctx.dateIntents) ctx.dateIntents.set(el, { c, text });
    if (suggest) {
      await pickSuggestion(el, text, true);
      if (typeof el.blur === 'function') el.blur();
    }
    return 'filled';
  }

  // ---- date parts that did not stick ------------------------------------------------------
  // Some sites (Workday) keep month and year in separate boxes and rebuild the whole date from their
  // own state on every edit, so writing one box quickly after another can wipe the first. After the
  // ordinary fields are in, read every date box back, and rewrite the ones that are wrong or empty.
  function dateBoxOk(el, c, text) {
    const v = String(el.value || '').trim();
    if (!v) return false;
    return c.part === 'year' ? v === text : /^\d+$/.test(v) && Number(v) === Number(text);
  }

  async function settleDates(ctx) {
    const intents = ctx.dateIntents;
    if (!intents || !intents.size) return [];
    const wrong = () => Array.from(intents.entries()).filter(([el, i]) => el.isConnected && !dateBoxOk(el, i.c, i.text));
    for (let round = 0; round < 3; round++) {
      await U.sleep(round === 0 ? 300 : 250); // let the page finish its own re-rendering first
      const bad = wrong();
      if (!bad.length) return [];
      for (const [el, i] of bad) {
        // First retry: plain write. Later retries: type it digit by digit like a keyboard would.
        if (round === 0) U.setText(el, i.text, false);
        else U.typeKeys(el, i.text);
        await U.sleep(150);
      }
    }
    await U.sleep(250);
    return wrong().map(([el, i]) => {
      flag(el);
      const part = i.c.part === 'month' ? 'month' : i.c.part === 'day' ? 'day' : 'year';
      return {
        label: (i.c.label || i.c.key) + ' (' + part + ')',
        reason: 'the page did not keep ' + i.text + ', please enter it yourself',
      };
    });
  }

  async function fillSelect(c, desired, ctx) {
    const el = c.el;
    if (desired == null || desired === '') return 'no-value';
    if (!ctx.overwrite && selectHasValue(el) && el.dataset.jaFilled !== '1') return 'kept';
    const options = Array.from(el.options).map((o) => ({ text: o.text, value: o.value }));
    let idx = -1;
    if (DATE_KEY.test(c.key)) {
      const p = T.parseDate(desired);
      if (!p || p.present) return 'no-value';
      if (c.part === 'month') idx = T.pickOptionAny(options, T.monthCandidates(p.m));
      else if (c.part === 'year') idx = T.pickOptionAny(options, [String(p.y)]);
      else idx = T.pickOption(options, toText(c, desired));
    } else if (c.wanted) {
      // Degree / Field of Study: only the names on the list, in order. No fuzzy fallback.
      const hit = T.pickFromList(options, c.wanted.list, c.wanted.stems);
      idx = hit ? hit.index : -1;
    } else {
      idx = T.pickOption(options, String(desired));
    }
    if (idx < 0) return 'no-option';
    el.focus();
    el.selectedIndex = idx;
    U.fireInputEvents(el);
    el.dataset.jaFilled = '1';
    return 'filled';
  }

  async function fillCombo(c, desired, ctx) {
    const el = c.el;
    const adapterOpts = ctx.adapter.comboOptions ? ctx.adapter.comboOptions(c.key) : {};
    const free = FREE_TEXT_COMBOS.has(c.key) || adapterOpts.free;
    const acceptFirst = c.key === 'basics.location' || adapterOpts.acceptFirst;
    const isInput = el.tagName === 'INPUT';

    let text = toText(c, desired);
    if (!text) return 'no-value';
    if (!ctx.overwrite && (comboHasValue(el) || (isInput && el.value && el.dataset.jaFilled !== '1'))) return 'kept';

    const control = el.closest('[class*="control" i]') || el;
    if (isInput) el.focus();
    U.realClick(control); // opens the menu

    const pickFrom = (options, typed) => {
      if (DATE_KEY.test(c.key) && c.part === 'month') {
        const p = T.parseDate(desired);
        return p ? T.pickOptionAny(options, T.monthCandidates(p.m)) : -1;
      }
      if (c.wanted) {
        const hit = T.pickFromList(options, c.wanted.list, c.wanted.stems);
        return hit ? hit.index : -1;
      }
      const idx = T.pickOption(options, text);
      return idx < 0 && acceptFirst && typed ? 0 : idx;
    };

    // Attempt 1: read the open menu as-is (so synonyms like "Master's Degree" can match).
    // Attempt 2+: type to filter / trigger a typeahead lookup, then read the menu again.
    const attempts = [null];
    if (isInput) {
      attempts.push(text);
      if (c.wanted) c.wanted.list.slice(1, 4).forEach((n) => attempts.push(n)); // type each fallback name too
      const firstWord = text.split(/\s+/)[0];
      if (!c.wanted && firstWord && firstWord.length >= 3 && firstWord !== text) attempts.push(firstWord);
    }

    let chosen = null;
    for (const q of attempts) {
      if (q != null) U.setText(el, q, true);
      const found = await U.waitFor(() => { const o = listOptions(el); return o.length ? o : null; }, q == null ? 500 : 1500);
      if (!found) continue;
      const options = found.map((o) => ({ text: o.textContent, value: o.getAttribute('data-value') || '' }));
      const idx = pickFrom(options, q != null);
      if (idx >= 0) { chosen = found[idx]; break; }
    }

    if (!chosen) {
      if (isInput && free) {
        // Free-text typeahead (company, city...): the typed text itself is a valid answer.
        U.setText(el, text, false);
        el.dataset.jaFilled = '1';
        return 'filled';
      }
      if (isInput) U.setText(el, '', false);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'no-option';
    }
    U.realClick(chosen);
    await U.sleep(150);
    el.dataset.jaFilled = '1';
    return 'filled';
  }

  function toggleClick(el) {
    if (U.isVisible(el)) el.click();
    else {
      const lab = (el.labels && el.labels[0]) || el.closest('label');
      if (lab) lab.click();
      else el.click();
    }
  }

  async function fillCheckbox(c, desired) {
    // Only the "I currently work here" box is ever touched. Consent boxes are left to the user.
    if (c.key !== 'experience.current') return 'skipped';
    const want = desired === true || T.isYes(desired);
    if (c.el.checked !== want) toggleClick(c.el);
    return 'filled';
  }

  function radioLabel(el) {
    const labels = Array.from(el.labels || []).map((l) => T.cleanText(l.textContent, 120));
    return labels.find(Boolean) || T.cleanText(el.getAttribute('aria-label') || '', 120) || el.value || '';
  }

  async function fillRadioGroup(group, desired, ctx) {
    if (desired == null || desired === '') return 'no-value';
    if (!ctx.overwrite && group.some((c) => c.el.checked)) return 'kept';
    const options = group.map((c) => ({ text: radioLabel(c.el), value: c.el.value }));
    const idx = T.pickOption(options, String(desired));
    if (idx < 0) return 'no-option';
    toggleClick(group[idx].el);
    return 'filled';
  }

  // ---- repeated sections ("Add another" experience / education blocks) --------------------
  function countKey(key) {
    return M.collectControls(document).map(M.classifyControl).filter((c) => c && c.key === key).length;
  }

  const ADD_BTN_TEXT = /^\+?\s*(add|new)\b.{0,30}$/i;
  const ADD_BTN_NOT = /resume|cover|file|attach|link|skill|language|certif|reference|website|photo/i;

  function findAddButton(section) {
    const cands = U.deepQueryAll(document, 'button, a, [role="button"]')
      .filter(U.isVisible)
      .filter((b) => {
        const t = T.cleanText(b.textContent, 60);
        return ADD_BTN_TEXT.test(t) && !ADD_BTN_NOT.test(t) && M.sectionOf(b) === section;
      });
    return cands.length ? cands[cands.length - 1] : null;
  }

  async function ensureRepeatables(profile) {
    const plan = [
      ['experience', 'experience.company'],
      ['education', 'education.school'],
    ];
    for (const [section, anchor] of plan) {
      const need = Array.isArray(profile[section]) ? profile[section].length : 0;
      if (need <= 1) continue;
      for (let guard = 0; guard < need + 1; guard++) {
        const have = countKey(anchor);
        if (have === 0 || have >= need) break;
        const btn = findAddButton(section);
        if (!btn) break;
        U.realClick(btn);
        const grew = await U.waitFor(() => countKey(anchor) > have, 2500, 100);
        if (!grew) break;
        await U.sleep(150);
      }
    }
  }

  // ---- websites -----------------------------------------------------------------------
  // Pages with dedicated LinkedIn / GitHub boxes get those filled by their own key. A list of generic
  // "Website / URL" boxes (Workday's Websites section with an Add button) gets every link that has no
  // box of its own, one per box, adding boxes as needed.
  const ADD_ONLY = /^\+?\s*add( website| url| link)?$/i; // plain "Add": never "Add another" (education / jobs)
  async function fillWebsites(ctx) {
    const b = ctx.profile.basics || {};
    const generic = () => M.collectControls(document).map(M.classifyControl)
      .filter((c) => c && c.key === 'basics.portfolio' && (c.kind === 'text') && /url|website|link|web/.test(c.hints.parts.join(' ')));
    let boxes = generic();
    if (!boxes.length) return;
    const keys = new Set(M.collectControls(document).map(M.classifyControl).filter(Boolean).map((c) => c.key));
    const sites = [['portfolio', b.portfolio], ['github', b.github], ['linkedin', b.linkedin]]
      .filter(([k, v]) => v && (k === 'portfolio' || !keys.has('basics.' + k)))
      .map(([, v]) => String(v));
    if (sites.length < 2) return; // a single link: the normal fill did it
    for (let guard = 0; guard < sites.length && boxes.length < sites.length; guard++) {
      const last = boxes[boxes.length - 1].el;
      if (/^(education|experience)$/.test(M.sectionOf(last) || '')) break;
      let btn = null;
      for (let n = last.parentElement, i = 0; n && i < 7 && !btn; n = n.parentElement, i++) {
        btn = Array.from(n.querySelectorAll('button, [role="button"]'))
          .find((x) => U.isVisible(x) && ADD_ONLY.test(T.cleanText(x.textContent, 40)) && !x.closest('[data-automation-id="selectedItem"]'));
      }
      if (!btn) break;
      const have = boxes.length;
      U.realClick(btn);
      const grew = await U.waitFor(() => generic().length > have, 2500, 100);
      if (!grew) break;
      boxes = generic();
      await U.sleep(150);
    }
    sites.forEach((url, i) => {
      const c = boxes[i];
      if (!c) return; // the page has no box for this link
      const el = c.el;
      const ours = !el.value || el.dataset.jaFilled === '1';
      if (!ours && !ctx.overwrite) return;
      U.setText(el, url, false);
      el.dataset.jaFilled = '1';
      ctx.log('Website ' + (i + 1) + ': ' + url, 'basics.portfolio', 'filled');
    });
  }

  // ---- review flags --------------------------------------------------------------------
  function clearFlags() {
    document.querySelectorAll('[data-ja-flag]').forEach((n) => {
      n.style.outline = n.dataset.jaPrevOutline || '';
      delete n.dataset.jaFlag;
      delete n.dataset.jaPrevOutline;
    });
  }

  function flag(el) {
    const target = el.closest('[class*="control" i]') || el;
    if (target.dataset.jaFlag) return;
    target.dataset.jaFlag = '1';
    target.dataset.jaPrevOutline = target.style.outline || '';
    target.style.outline = '2px dashed #f59e0b';
    target.style.outlineOffset = '2px';
  }

  function isEmptyControl(c) {
    const el = c.el;
    switch (c.kind) {
      case 'text':
      case 'textarea': return !el.value || !el.value.trim();
      case 'select': return !selectHasValue(el);
      case 'combobox': return !comboHasValue(el) && !(el.value && el.value.trim());
      case 'checkbox': return !el.checked;
      default: return false;
    }
  }

  // ---- main entry ----------------------------------------------------------------------
  // Sections the user can switch on / off in the panel. Anything not listed (or true) is filled.
  const SECTION_OF_HEAD = { basics: 'basics', education: 'education', experience: 'experience', application: 'application', eeo: 'eeo' };
  function sectionOf(key) {
    if (!key) return null;
    if (key === 'file.resume') return 'resume';
    if (key === 'file.cover' || key === 'basics.coverLetter') return 'cover';
    if (key === 'basics.skills') return 'skills';
    return SECTION_OF_HEAD[key.split('.')[0]] || null;
  }

  async function fillAll(opts) {
    const sections = opts.sections || {};
    const sectionOn = (s) => !s || sections[s] !== false;
    let profile = withLockedEducation(opts.profile || {}, opts.resume);
    if (!sectionOn('experience') || !sectionOn('education')) {
      profile = { ...profile };
      if (!sectionOn('experience')) profile.experience = [];
      if (!sectionOn('education')) profile.education = [];
    }
    const resume = opts.resume || null;
    const overwrite = !!opts.overwrite;
    const adapter = JA.pickAdapter();
    const fields = [];
    const log = (label, key, status) => fields.push({ label: label || key, key, status });
    // handled: controls an adapter filled itself (so the final check does not flag them a second time).
    // reviewExtra: things for the user to look at that an adapter found (shown in the popup).
    const ctx = { profile, overwrite, adapter, log, sectionOn, dateIntents: new Map(), handled: new WeakSet(), reviewExtra: [], flag };
    // Optional adapter hook: controls the adapter fills itself (for example Workday's skills picker).
    const skip = (c) => {
      if (ctx.handled.has(c.el)) return true;
      if (!sectionOn(sectionOf(c.key))) return true;
      try { return !!(adapter.skipControl && adapter.skipControl(c, ctx)); } catch (e) { return false; }
    };

    const initial = M.collectControls(document).map(M.classifyControl).filter(Boolean);
    if (!initial.some((c) => c.key)) return { touched: false, filled: 0, review: 0, skipped: 0, fields: [] };

    ctx.initiallyFilled = new WeakSet(
      initial.filter((c) => c.el.value && String(c.el.value).trim()).map((c) => c.el)
    );

    clearFlags();
    if (adapter.beforeFill) await adapter.beforeFill(ctx);

    // 1. Resume first: some sites parse it and pre-fill fields, which we then fill around.
    const fileInputs = initial.filter((c) => c.kind === 'file');
    let resumeInputs = fileInputs.filter((c) => c.key === 'file.resume');
    if (
      !resumeInputs.length && fileInputs.length === 1 && !fileInputs[0].key &&
      fileInputs[0].hints.parts.every((p) => !/cover|photo|image|portfolio|transcript|letter/.test(p))
    ) {
      resumeInputs = fileInputs;
    }
    if (!sectionOn('resume')) {
      // resume upload switched off
    } else if (resume && resume.data && resumeInputs.length) {
      let uploaded = false;
      for (const c of resumeInputs) {
        if (c.el.files && c.el.files.length && !overwrite) { log('Resume', 'file.resume', 'kept'); continue; }
        try {
          U.attachFile(c.el, U.base64ToFile(resume.data, resume.name, resume.type));
          log('Resume', 'file.resume', 'filled');
          uploaded = true;
        } catch (e) {
          log('Resume', 'file.resume', 'error');
        }
      }
      if (uploaded) await adapter.afterResumeUpload(ctx);
    } else if (resumeInputs.length && !resume) {
      log('Resume', 'file.resume', 'no-value');
    }

    // 2. Make enough experience / education blocks for the profile.
    await ensureRepeatables(profile);

    // 3. Fill in up to two passes (answers can reveal follow-up fields).
    const done = new WeakSet();
    for (let pass = 0; pass < 2; pass++) {
      const classified = M.collectControls(document).map(M.classifyControl).filter((c) => c && c.kind !== 'file');
      const occ = new Map();
      const groups = new Map();
      let progressed = 0;

      for (const c of classified) {
        let idx = 0;
        if (c.key && /^(experience|education)\./.test(c.key)) {
          const id = c.key + '|' + (c.part || '');
          idx = occ.get(id) || 0;
          occ.set(id, idx + 1);
        }
        if (done.has(c.el) || !c.key) continue;
        if (skip(c)) continue;

        if (c.kind === 'radio') {
          const gk = c.el.name || 'radio-' + groups.size;
          if (!groups.has(gk)) groups.set(gk, []);
          groups.get(gk).push(c);
          continue;
        }

        done.add(c.el);
        const item =
          /^(experience|education)\./.test(c.key) ? (profile[c.key.split('.')[0]] || [])[idx] : null;
        let value = resolveValue(c.key, profile, idx);
        if (c.key === 'experience.current') value = !!(item && item.current);
        if (c.key === 'experience.endDate' && item && item.current) { log(c.label, c.key, 'skipped'); continue; }
        if (c.key === 'basics.coverLetter' && c.kind !== 'textarea') continue;
        c.wanted = wantedFor(c.key, item);

        let status;
        try {
          if (c.kind === 'text' || c.kind === 'textarea') status = await fillText(c, value, ctx);
          else if (c.kind === 'select') status = await fillSelect(c, value, ctx);
          else if (c.kind === 'combobox') status = await fillCombo(c, value, ctx);
          else if (c.kind === 'checkbox') status = await fillCheckbox(c, value, ctx);
          else status = 'skipped';
        } catch (err) {
          status = 'error';
        }
        if (status === 'filled') progressed++;
        log(c.label, c.key, status);
        await U.sleep(c.key && DATE_KEY.test(c.key) && c.part ? 120 : 25);
      }

      for (const group of groups.values()) {
        const first = group[0];
        group.forEach((c) => done.add(c.el));
        let status;
        try {
          status = await fillRadioGroup(group, resolveValue(first.key, profile, 0), ctx);
        } catch (err) {
          status = 'error';
        }
        if (status === 'filled') progressed++;
        log(first.hints.group || first.label, first.key, status);
      }

      if (!progressed) break;
      await U.sleep(300);
    }

    // 3a. Make sure every date box really holds what we wrote.
    const dateProblems = await settleDates(ctx);

    // 3a2. Websites: one box per link (LinkedIn, GitHub, portfolio) where the page only has generic URL boxes.
    try { if (sectionOn('basics')) await fillWebsites(ctx); } catch (e) { log('Websites', 'basics.portfolio', 'error'); }

    // 3b. Anything the adapter fills with its own logic (runs after the ordinary fields are in place).
    if (adapter.fillExtras) {
      try { await adapter.fillExtras(ctx); } catch (e) { log('Site-specific fields', null, 'error'); }
    }

    // 4. Flag whatever required fields are still empty so the user knows where to look.
    const review = [];
    const seenRadio = new Set();
    for (const c of M.collectControls(document).map(M.classifyControl).filter(Boolean)) {
      if (!c.required || c.kind === 'file') continue;
      if (!c.label && !c.hints.group) continue; // nothing a person could recognise as a question
      if (skip(c)) continue;
      if (c.kind === 'radio') {
        const gk = c.el.name || c.label;
        if (seenRadio.has(gk)) continue;
        seenRadio.add(gk);
        const anyChecked = Array.from(
          document.querySelectorAll('input[type=radio]')
        ).some((r) => r.name === c.el.name && r.checked);
        if (!anyChecked) { review.push({ label: c.hints.group || c.label, reason: 'needs an answer' }); flag(c.el); }
        continue;
      }
      if (isEmptyControl(c)) {
        review.push({
          label: c.label,
          reason: c.kind === 'checkbox' ? 'needs your confirmation' : 'needs an answer',
        });
        flag(c.el);
      }
    }

    dateProblems.forEach((p) => review.push(p));
    ctx.reviewExtra.forEach((p) => review.push(p));

    return {
      touched: true,
      filled: fields.filter((f) => f.status === 'filled').length,
      skipped: fields.filter((f) => f.status === 'kept').length,
      review: review.length,
      fields: fields.concat(review.map((r) => ({ label: r.label, key: null, status: 'review', reason: r.reason }))),
    };
  }

  function looksLikeApplication() {
    const cls = M.collectControls(document).map(M.classifyControl).filter(Boolean);
    const keys = new Set(cls.map((c) => c.key).filter(Boolean));
    const strong = ['basics.firstName', 'basics.lastName', 'basics.fullName', 'basics.email', 'basics.phone', 'file.resume']
      .filter((k) => keys.has(k)).length;
    const extra = Array.from(keys).some((k) => /^(education|experience|application)\.|^basics\.(linkedin|github|portfolio)$/.test(k));
    const names = keys.has('basics.firstName') && keys.has('basics.lastName');
    return (keys.has('file.resume') && strong >= 2) || (strong >= 3 && extra) || (names && cls.length >= 5);
  }

  JA.fillAll = fillAll;
  JA.filler = { sectionOf, resolveValue, toText, ensureRepeatables, looksLikeApplication, listOptions, withLockedEducation, wantedFor };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
