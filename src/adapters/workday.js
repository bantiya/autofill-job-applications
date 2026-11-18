// Workday career sites (*.myworkdayjobs.com, *.myworkdaysite.com and company-branded domains).
//
// Most of a Workday application is ordinary fields that the generic filler already handles. The
// "Skills" box on the My Experience page is not: it is a search-and-tick picker.
//   - you type a skill and press Enter (some tenants also search while you type),
//   - Workday lists matching skills from the company's catalogue, each row with a checkbox,
//   - only ticking the checkbox selects the skill (clicking the row does nothing),
//   - the selection appears as a pill, and the search also returns loose relatives
//     ("React" also lists "React VR"), so a result is only accepted if its name matches exactly.
//
// This adapter fills that picker one skill at a time, adds only skills that really exist in the
// catalogue, never removes anything, and reports which skills the site did not offer.
//
// It also fills the Education block's Degree (a button that opens a list, not a form field) and Field of
// Study (a search-and-pick box like Skills). Both come with an ordered list of names (src/education.js):
// the first name the page really offers is the one chosen, and the popup says what the page offered when
// none matched.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});
  const U = JA.util;
  const M = JA.matcher;
  const T = JA.text;

  const TIME_BUDGET_MS = 100000; // stop adding skills after this long and say so
  const SEARCH_TIMEOUT_MS = 3000;

  // Other names a catalogue may use for the same skill. The first alias is also searched for.
  const ALIASES = {
    'reactjs': ['React', 'React.js'],
    'react.js': ['React', 'ReactJS'],
    'node.js': ['NodeJS', 'Node'],
    'express.js': ['Express', 'ExpressJS'],
    'rest apis': ['REST API', 'RESTful API'],
    'apache kafka': ['Kafka'],
    'gcp': ['Google Cloud Platform'],
    'aws': ['Amazon Web Services'],
    'html5': ['HTML'],
    'css3': ['CSS'],
    'postgresql': ['Postgres'],
    'dynamodb': ['Amazon DynamoDB'],
    'cosmos db': ['Azure Cosmos DB'],
    'gcp pub/sub': ['Google Cloud Pub/Sub'],
    'oauth': ['OAuth 2.0'],
    'jwt': ['JSON Web Token'],
    'tdd': ['Test-Driven Development'],
    'sdlc': ['Software Development Life Cycle'],
    'ci/cd': ['Continuous Integration'],
  };

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  // Lower-case and collapse spaces, but keep symbols: "C#" must never equal "C".
  const norm = (s) => clean(s).toLowerCase();

  function expandSkills(list) {
    const out = [];
    const seen = new Set();
    const add = (s) => {
      const k = norm(s);
      if (k && !seen.has(k)) { seen.add(k); out.push(clean(s)); }
    };
    (Array.isArray(list) ? list : []).forEach((s) => {
      if (norm(s) === 'agile/scrum') { add('Agile'); add('Scrum'); } else add(s);
    });
    return out;
  }

  const targetsFor = (skill) => [skill].concat(ALIASES[norm(skill)] || []);

  // ---- finding things on the page --------------------------------------------------------
  const BOX = '[data-automation-id*="skill" i]';

  function searchInputs(doc) {
    const found = [];
    const add = (el) => { if (el && !found.includes(el) && U.isVisible(el)) found.push(el); };
    doc.querySelectorAll(BOX).forEach((box) => {
      if (box.matches('input[type="text"], input:not([type])')) return add(box);
      add(box.querySelector('input[data-automation-id="searchBox"]') || box.querySelector('input[type="text"], input:not([type])'));
    });
    M.collectControls(doc).map(M.classifyControl).forEach((c) => {
      if (c && c.key === 'basics.skills' && (c.kind === 'text' || c.kind === 'combobox')) add(c.el);
    });
    return found;
  }

  // The element holding this picker's selected pills (but not other pickers' pills).
  function pillScope(input) {
    let el = input.parentElement;
    let fallback = null;
    for (let i = 0; i < 7 && el; i++, el = el.parentElement) {
      const boxes = el.querySelectorAll('input[data-automation-id="searchBox"]').length;
      if (boxes > 1) break;
      if (!fallback && /formField|skill|multiselect/i.test(el.getAttribute('data-automation-id') || '')) fallback = el;
      if (el.querySelector('[data-automation-id="selectedItem"]')) return el;
    }
    return fallback || input.parentElement;
  }

  function pillText(pill) {
    const c = pill.cloneNode(true);
    c.querySelectorAll('button, [role="button"], [aria-label*="delete" i], [aria-label*="remove" i]').forEach((n) => n.remove());
    return norm(c.textContent);
  }

  function selectedSkills(input) {
    return Array.from(pillScope(input).querySelectorAll('[data-automation-id="selectedItem"]')).map(pillText);
  }

  function listRows(input) {
    const doc = input.ownerDocument;
    const sel = '[data-automation-id="promptOption"], [role="option"]';
    const rows = new Set();
    [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean).forEach((id) => {
      const box = U.byId(input, id);
      if (box) box.querySelectorAll(sel).forEach((r) => rows.add(r));
    });
    if (!rows.size) {
      doc.querySelectorAll('[data-automation-activepopup="true"] [data-automation-id="promptOption"], [data-automation-activepopup="true"] [role="option"]')
        .forEach((r) => rows.add(r));
    }
    if (!rows.size) doc.querySelectorAll('[data-automation-id="promptOption"]').forEach((r) => rows.add(r));
    // A selected pill can itself be a "promptOption"; it is not a search result.
    return Array.from(rows).filter((r) => !r.closest('[data-automation-id="selectedItem"]') && U.isVisible(r));
  }

  function rowLabel(row) {
    const lines = String(row.innerText || row.textContent || '').split(/\n+/).map(clean).filter(Boolean);
    return lines[0] || '';
  }

  // Accept a result only when its name IS the skill (or the skill plus a parenthetical, e.g.
  // "Python (Programming Language)"). Prefer the exact name. Never take a near miss.
  function pickRow(rows, targets) {
    const t = targets.map(norm);
    let withParen = null;
    for (const row of rows) {
      const lab = norm(rowLabel(row));
      if (!lab) continue;
      if (t.includes(lab)) return row;
      if (!withParen && t.some((x) => lab.startsWith(x + ' ('))) withParen = row;
    }
    return withParen;
  }

  const signature = (rows) => rows.map(rowLabel).join('|');

  // ---- keyboard / clicking -----------------------------------------------------------------
  function press(el, type, key, code, kc) {
    el.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true }));
  }
  function pressEnter(el) {
    press(el, 'keydown', 'Enter', 'Enter', 13);
    press(el, 'keypress', 'Enter', 'Enter', 13);
    press(el, 'keyup', 'Enter', 'Enter', 13);
  }

  const checkboxOf = (row) => row.querySelector('input[type="checkbox"], [role="checkbox"], [data-automation-id*="checkbox" i]');
  const isChecked = (cb) => !!cb && (cb.checked === true || cb.getAttribute('aria-checked') === 'true');

  // Search for one skill. Returns the matching result row, or null if the catalogue has none.
  async function search(input, query, targets, state) {
    // Close the previous list first, so a stale "No Items" (or the last search's rows) cannot be mistaken
    // for the answer to this search while the new results are still on their way.
    if (state.closeFirst) { press(input, 'keydown', 'Escape', 'Escape', 27); await U.sleep(60); }
    U.setText(input, query, true);
    pressEnter(input);
    const started = Date.now();
    let sig = null;
    let since = Date.now();
    while (Date.now() - started < SEARCH_TIMEOUT_MS) {
      const rows = listRows(input);
      if (state.seen) rows.forEach((r) => state.seen.add(rowLabel(r)));
      const hit = pickRow(rows, targets);
      if (hit) return hit;
      const s = signature(rows);
      // A list identical to the previous skill's has probably not refreshed yet; do not trust it.
      if (rows.length && s !== state.lastSig) {
        if (s !== sig) { sig = s; since = Date.now(); }
        else if (Date.now() - since > 700) return null; // a fresh list that settled without our skill
      }
      if (!rows.length && Date.now() - started > 450) {
        const popup = input.ownerDocument.querySelector('[data-automation-activepopup="true"]');
        if (popup && /no (items|results|matches|options)/i.test(popup.textContent)) return null;
      }
      await U.sleep(80);
    }
    return null;
  }

  async function tick(row, input, targets) {
    const done = (cb) => U.waitFor(
      () => isChecked(cb) || selectedSkills(input).some((p) => targets.map(norm).includes(p)),
      800, 60
    );
    const cb = checkboxOf(row);
    if (cb) {
      if (isChecked(cb)) return 'already';
      U.realClick(cb);
      if (await done(cb)) return 'added';
      const wrap = cb.closest('label') || cb.parentElement;
      if (wrap) { U.realClick(wrap); if (await done(cb)) return 'added'; }
      return 'failed';
    }
    U.realClick(row);
    return (await done(null)) ? 'added' : 'failed';
  }

  async function addOne(input, skill, targets, state) {
    const queries = [skill].concat(targets.slice(1, 2));
    for (const q of queries) {
      const row = await search(input, q, targets, state);
      state.lastSig = signature(listRows(input));
      if (row) return tick(row, input, targets);
    }
    return 'missing';
  }

  async function fillSkills(ctx) {
    const skills = expandSkills(ctx.profile.skills);
    if (!skills.length || !searchInputs(document).length) return;

    const added = [];
    const already = [];
    const missing = [];
    const state = { lastSig: '' };
    const started = Date.now();
    let notTried = [];

    for (let i = 0; i < skills.length; i++) {
      if (Date.now() - started > TIME_BUDGET_MS) { notTried = skills.slice(i); break; }
      const input = searchInputs(document)[0];
      if (!input) { notTried = skills.slice(i); break; }
      const targets = targetsFor(skills[i]);
      if (selectedSkills(input).some((p) => targets.map(norm).includes(p))) { already.push(skills[i]); continue; }
      let result;
      try { result = await addOne(input, skills[i], targets, state); } catch (e) { result = 'failed'; }
      if (result === 'added') added.push(skills[i]);
      else if (result === 'already') already.push(skills[i]);
      else missing.push(skills[i]);
    }

    // Leave the box clean and the list closed so the pills are visible.
    const input = searchInputs(document)[0];
    if (input) {
      U.setText(input, '', true);
      press(input, 'keydown', 'Escape', 'Escape', 27);
      if (typeof input.blur === 'function') input.blur();
    }

    ctx.log('Skills: ' + added.length + ' added' + (already.length ? ', ' + already.length + ' already there' : ''), 'basics.skills',
      added.length ? 'filled' : already.length ? 'kept' : 'no-option');
    if (missing.length) ctx.log('Skills this site did not offer: ' + missing.join(', '), 'basics.skills', 'no-option');
    if (notTried.length) ctx.log('Skills not tried (ran out of time): ' + notTried.join(', '), 'basics.skills', 'no-option');
  }

  // ---- Education: Degree dropdown and Field of Study picker --------------------------------
  const DEGREE_LABEL = /\bdegree\b/;
  const FIELD_LABEL = /field of study|\bmajor\b|\bdiscipline\b/;
  const TEXT_INPUT = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';
  const ROW_SEL = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]';
  const FORM_FIELD = '[data-automation-id^="formField"]';

  // Everything that names a control: its aria-label, id, automation id, label and the form field's label.
  function labelBlob(el) {
    const parts = [el.getAttribute('aria-label'), el.id, el.getAttribute('data-automation-id'), el.getAttribute('name')];
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const n = U.byId(el, id); if (n) parts.push(n.textContent); });
    if (el.labels) Array.from(el.labels).forEach((l) => parts.push(l.textContent));
    const ff = el.closest(FORM_FIELD);
    if (ff) { const l = ff.querySelector('label, legend'); if (l) parts.push(l.textContent); }
    return T.normalize(parts.filter(Boolean).join(' '));
  }

  // The Degree / Field of Study controls on the page, in page order (one per Education block).
  function eduControls(kind) {
    const doc = document;
    const mine = kind === 'degree' ? DEGREE_LABEL : FIELD_LABEL;
    const other = kind === 'degree' ? FIELD_LABEL : DEGREE_LABEL;
    const sel = kind === 'degree'
      ? 'select, button, [role="combobox"], [aria-haspopup="listbox"], ' + TEXT_INPUT
      : TEXT_INPUT + ', [role="combobox"]';
    const out = [];
    for (const el of U.deepQueryAll(doc, sel)) {
      if (el.disabled || el.closest('[data-automation-id="selectedItem"]') || !U.isVisible(el)) continue;
      const blob = labelBlob(el);
      if (!mine.test(blob) || other.test(blob)) continue;
      if (M.sectionOf(el) === 'experience') continue;
      const ff = el.closest(FORM_FIELD);
      if (out.some((x) => x.contains(el) || el.contains(x) || (ff && x.closest(FORM_FIELD) === ff))) continue;
      out.push(el);
    }
    // A wrapper with role=combobox: the box to type into is the input inside it.
    return kind === 'field' ? out.map((el) => (el.tagName === 'INPUT' ? el : el.querySelector(TEXT_INPUT) || el)) : out;
  }

  // A search-and-pick box (type, Enter, choose a row, a pill appears) as opposed to a plain text box.
  function isSearchPicker(el) {
    if (el.tagName !== 'INPUT') return false;
    if (el.matches('[data-automation-id="searchBox"]') || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) return true;
    if (el.closest('[data-automation-id*="multiSelect" i], [data-uxi-widget-type="multiselect"]')) return true;
    const ff = el.closest(FORM_FIELD);
    return !!(ff && ff.querySelector('[data-automation-id="selectedItem"], [data-automation-id*="multiSelect" i]'));
  }

  const isPlaceholder = (t) => !t || /^(select one|select|choose one|choose|-+|—)$/i.test(t);

  function dropdownText(el) {
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      return o && o.value ? clean(o.text) : '';
    }
    if (el.tagName === 'INPUT') return clean(el.value);
    return clean(el.innerText || el.textContent);
  }

  function menuRows(el) {
    const doc = el.ownerDocument;
    const rows = new Set();
    const add = (box) => { if (box) box.querySelectorAll(ROW_SEL).forEach((r) => rows.add(r)); };
    [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')].filter(Boolean).forEach((id) => add(U.byId(el, id)));
    if (!rows.size) doc.querySelectorAll('[data-automation-activepopup="true"]').forEach(add);
    if (!rows.size) doc.querySelectorAll('[role="listbox"]').forEach(add);
    return Array.from(rows).filter((r) => !r.closest('[data-automation-id="selectedItem"]') && U.isVisible(r));
  }

  const rowText = (row) => clean(row.getAttribute('data-automation-label')) || rowLabel(row);
  const offeredText = (list) => list.filter(Boolean).slice(0, 14).join(' | ') + (list.length > 14 ? ' | …' : '');
  const triedText = (wanted) => {
    const first = wanted.list.slice(0, 3).map((n) => '"' + n + '"').join(', ');
    return first + (wanted.list.length > 3 ? ' and ' + (wanted.list.length - 3) + ' more' : '');
  };

  function closeMenus(el) {
    [el, el.ownerDocument.body].forEach((t) => press(t, 'keydown', 'Escape', 'Escape', 27));
  }

  // Degree: a native <select>, or a button / combobox that opens a list.
  async function fillDegree(el, wanted, n, ctx) {
    const label = 'Degree (Education ' + (n + 1) + ')';
    ctx.handled.add(el);
    const current = dropdownText(el);
    if (!isPlaceholder(current) && !ctx.overwrite && el.dataset.jaFilled !== '1') { ctx.log(label, 'education.degree', 'kept'); return; }

    let options;
    let rows = null;
    if (el.tagName === 'SELECT') {
      options = Array.from(el.options).map((o) => ({ text: o.text, value: o.value }));
    } else {
      closeMenus(el);
      U.realClick(el);
      rows = await U.waitFor(() => { const r = menuRows(el); return r.length ? r : null; }, 1800);
      if (!rows && el.tagName === 'INPUT') {
        press(el, 'keydown', 'ArrowDown', 'ArrowDown', 40);
        rows = await U.waitFor(() => { const r = menuRows(el); return r.length ? r : null; }, 1200);
      }
      if (!rows) {
        ctx.reviewExtra.push({ label, reason: 'the list would not open, please choose it yourself' });
        ctx.flag(el);
        return;
      }
      options = rows.map((r) => ({ text: rowText(r), value: r.getAttribute('data-value') || '' }));
    }

    const hit = T.pickFromList(options, wanted.list, wanted.stems);
    if (!hit) {
      if (rows) closeMenus(el);
      ctx.reviewExtra.push({ label, reason: 'none of ' + triedText(wanted) + ' is offered. The page offers: ' + offeredText(options.map((o) => o.text)) });
      ctx.flag(el);
      return;
    }

    const chosenText = options[hit.index].text;
    if (el.tagName === 'SELECT') {
      el.focus();
      el.selectedIndex = hit.index;
      U.fireInputEvents(el);
    } else {
      const changed = () => { const t = dropdownText(el); return !isPlaceholder(t) && t !== current; };
      U.realClick(rows[hit.index]);
      let ok = await U.waitFor(changed, 1500, 60);
      if (!ok) {
        const inner = rows[hit.index].querySelector('div, span, label');
        if (inner) U.realClick(inner);
        else if (typeof rows[hit.index].click === 'function') rows[hit.index].click();
        ok = await U.waitFor(changed, 1500, 60);
      }
      if (!ok) {
        closeMenus(el);
        ctx.reviewExtra.push({ label, reason: 'could not choose "' + chosenText + '", please choose it yourself' });
        ctx.flag(el);
        return;
      }
    }
    el.dataset.jaFilled = '1';
    ctx.log(label + ': ' + chosenText, 'education.degree', 'filled');
  }

  // Field of Study: type a name, press Enter, pick the row that IS that name. One name after another.
  async function fillFieldPicker(input, wanted, n, ctx, state) {
    const label = 'Field of Study (Education ' + (n + 1) + ')';
    ctx.handled.add(input);
    if (selectedSkills(input).length && !ctx.overwrite) { ctx.log(label, 'education.field', 'kept'); return; }

    const seen = new Set();
    state.seen = seen;
    const picked = () => selectedSkills(input);
    let done = null;

    for (const name of wanted.list) {
      const row = await search(input, name, [name], state);
      state.lastSig = signature(listRows(input));
      if (!row) continue;
      const before = picked().length;
      const text = rowText(row);
      const ok = () => picked().length > before || picked().some((x) => x === norm(text) || x === norm(name));
      let good = false;
      const cb = checkboxOf(row);
      if (cb) {
        if (isChecked(cb)) good = true;
        else {
          U.realClick(cb);
          good = !!(await U.waitFor(ok, 900, 60));
          if (!good) {
            const wrap = cb.closest('label') || cb.parentElement;
            if (wrap) { U.realClick(wrap); good = !!(await U.waitFor(ok, 900, 60)); }
          }
        }
      } else {
        U.realClick(row);
        good = !!(await U.waitFor(ok, 900, 60));
        if (!good) {
          const inner = row.querySelector('div, span, label');
          if (inner) { U.realClick(inner); good = !!(await U.waitFor(ok, 900, 60)); }
        }
      }
      if (good) { done = text; break; }
    }

    // Leave the box clean and the list closed (typed text that was never picked would be thrown away).
    U.setText(input, '', true);
    press(input, 'keydown', 'Escape', 'Escape', 27);
    if (typeof input.blur === 'function') input.blur();
    state.seen = null;

    if (done) {
      input.dataset.jaFilled = '1';
      ctx.log(label + ': ' + done, 'education.field', 'filled');
    } else {
      const shown = Array.from(seen);
      ctx.reviewExtra.push({
        label,
        reason: 'none of ' + triedText(wanted) + ' is offered' + (shown.length ? '. The searches showed: ' + offeredText(shown) : ''),
      });
      ctx.flag(input);
    }
  }

  async function fillEducation(ctx) {
    const entries = Array.isArray(ctx.profile.education) ? ctx.profile.education : [];
    if (!entries.length || !JA.education) return;
    const degrees = eduControls('degree');
    const fields = eduControls('field').filter(isSearchPicker);
    const state = { lastSig: '', seen: null, closeFirst: true };
    for (let i = 0; i < entries.length; i++) {
      const wd = JA.education.wanted(entries[i], 'degree');
      const wf = JA.education.wanted(entries[i], 'field');
      if (degrees[i] && wd) {
        try { await fillDegree(degrees[i], wd, i, ctx); } catch (e) { ctx.log('Degree (Education ' + (i + 1) + ')', 'education.degree', 'error'); }
      }
      if (fields[i] && wf) {
        try { await fillFieldPicker(fields[i], wf, i, ctx, state); } catch (e) { ctx.log('Field of Study (Education ' + (i + 1) + ')', 'education.field', 'error'); }
      }
    }
  }

  JA.workday = { expandSkills, pickRow, norm, targetsFor };

  JA.registerAdapter({
    name: 'workday',
    match(loc, doc) {
      if (/(^|\.)(myworkdayjobs|myworkdaysite|workdayjobs)\.com$/.test(loc.hostname) || /(^|\.)workday\.com$/.test(loc.hostname)) return true;
      // Branded career domains that run on Workday still carry its data attributes.
      return !!doc.querySelector('[data-uxi-widget-type]') && doc.querySelectorAll('[data-automation-id]').length > 10;
    },
    async afterResumeUpload() {
      // Workday parses the resume in the background and fills fields; wait so we fill after it.
      await U.sleep(2500);
    },
    comboOptions() {
      return {};
    },
    // The skills picker and the Field of Study picker are filled by fillExtras; the generic filler must
    // not type into them (typed text that is never picked from the list is thrown away by the page).
    skipControl(c) {
      if (c.key === 'education.field') return isSearchPicker(c.el);
      return c.key === 'basics.skills' && c.kind !== 'textarea' && c.kind !== 'select';
    },
    async fillExtras(ctx) {
      if (!ctx.sectionOn || ctx.sectionOn('education')) {
        try { await fillEducation(ctx); } catch (e) { ctx.log('Education', null, 'error'); }
      }
      if (!ctx.sectionOn || ctx.sectionOn('skills')) await fillSkills(ctx);
    },
  });
})(typeof self !== 'undefined' ? self : globalThis);
