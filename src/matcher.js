// Works out WHAT each form control is asking for (first name, company, school, ...).
//
// For every control we gather hints (label, aria-label, placeholder, name, id, enclosing
// fieldset/legend, nearest section heading) and run them through an ordered rule list.
// The first rule that matches wins, so more specific rules come first.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});
  const { normalize, cleanText } = JA.text;
  const { isVisible, byId, deepQueryAll } = JA.util;

  const R = (key, re, o) => Object.assign({ key, re }, o || {});
  const YES_NO_KINDS = ['select', 'combobox', 'radio'];

  // ---- rules --------------------------------------------------------------------------
  // Only consulted when the control sits under an Education / Work-experience heading.
  const SECTION_RULES = {
    education: [
      R('education.description', /description|activities|honou?rs|notes|achievements/),
      R('education.gpa', /\bgpa\b|grade point|\bgrade\b|\bcgpa\b/),
      R('education.degree', /degree|qualification|\blevel\b|\btype\b/, { not: /field|major/ }),
      R('education.field', /field|major|discipline|study|concentration|specializ|subject|program/),
      R('education.school', /school|universit|college|institution|academy|^name$/, {
        not: /high school|city|state|country|location|year|date/,
      }),
      R('education.startDate', /\bstart|\bfrom\b|\bbegin|\bbegan|\benroll|\bentered/),
      R('education.endDate', /\bend\b|\bto\b|\buntil\b|\bthru\b|\bthrough\b|graduat|complet|finish|expected/),
      R('education.location', /location|\bcity\b|country/),
    ],
    experience: [
      R('experience.current', /current|present|\bstill\b|ongoing|i work here/, { types: ['checkbox'] }),
      R('experience.description', /description|responsibilit|duties|summary|achievement|accomplish/),
      R('experience.title', /job title|position|\brole\b|\btitle\b|designation/, { not: /company|employer/ }),
      R('experience.company', /company|employer|organi[sz]ation|business|workplace|\bfirm\b|^name$/),
      R('experience.startDate', /\bstart|\bfrom\b|\bbegin|\bbegan|\bjoined/),
      R('experience.endDate', /\bend\b|\bto\b|\buntil\b|\bthru\b|\bthrough\b|\bleft\b|\bleaving\b/),
      R('experience.location', /location|\bcity\b|\bwhere\b|country/),
    ],
  };

  const GLOBAL_RULES = [
    // Work authorisation and common screening questions (long, specific phrasing first)
    // Yes/No questions: only ever answered through a select, dropdown or radio. A free-text box whose
    // long label merely mentions "relocate" or "sponsorship" must not receive "Yes".
    R('application.authorizedWithoutSponsorship',
      /(authori[sz]ed|eligible|legally|right|permitted|able) to work.*(without|not (require|need)).*sponsor|without.*sponsor.*(authori[sz]ed|work)/, { types: YES_NO_KINDS }),
    R('application.requiresSponsorship', /sponsor|work visa|require.*visa|need.*visa/, { types: YES_NO_KINDS }),
    R('application.authorizedToWork',
      /(authori[sz]ed|eligible|legally|legal right|right|permitted|allowed|able) to work|work authori[sz]ation|employment eligibility|legally (eligible|entitled)/, { types: YES_NO_KINDS }),
    R('application.willingToRelocate', /relocat/, { types: YES_NO_KINDS }),
    R('application.over18', /(at least|over|older than) 18|18 years|legal age|age of majority/, { types: YES_NO_KINDS }),
    R('application.previouslyWorkedHere',
      /(previously|ever|formerly|before) (been )?(employed|worked|work)( at| for| with)?|former employee/, { types: YES_NO_KINDS }),
    R('application.noticePeriod', /notice period|how much notice/),
    R('application.availableStartDate',
      /earliest.*start|available (to|for) start|when (can|could|would|are) you.*(start|join|begin|available)|availability date|date available/),
    R('application.salaryExpectation', /salary|compensation|pay expectation|expected pay|desired pay|expected (base|total)/),
    R('application.referralSource',
      /how did you (hear|find|learn)|where did you (hear|find|learn)|source of (application|referral)|hear about (us|this|the)/),
    R('application.yearsExperience', /years? of (relevant |professional |work )?experience|how many years/),

    // Voluntary self-identification
    R('eeo.hispanic', /hispanic|latino|latinx/),
    R('eeo.race', /\brace\b|ethnic/),
    R('eeo.gender', /\bgender\b|\bsex\b/),
    R('eeo.veteran', /veteran|military service/),
    R('eeo.disability', /disabilit/),
    R('eeo.lgbtq', /lgbt|sexual orientation|transgender/),

    // Links
    R('basics.linkedin', /linked\s*in/),
    R('basics.github', /git\s*hub/),
    R('basics.portfolio', /portfolio|personal (web)?site|website|web site|\burl\b|\blink\b|blog/, {
      not: /linked\s*in|git\s*hub|twitter|facebook|instagram|company|employer/,
    }),

    // Contact
    R('basics.phoneCountryCode', /(phone|mobile|tel\w*)\s*(country\s*)?code|country\s*(phone\s*)?code|dial/),
    R('basics.phone', /phone|mobile|\bcell\b|\btel\b|telephone/, {
      not: /extension|\bext\b|device|\btype\b|fax|emergency|reference/,
    }),
    R('basics.email', /e\s*mail/, {
      not: /refer|manager|supervisor|reference|recruiter|friend|colleague|emergency|subscribe|newsletter|alert/,
    }),

    // Names
    R('basics.preferredName', /preferred (first )?name|nick\s*name|name you go by/),
    R('basics.middleName', /middle (name|initial)|\bmi\b/),
    R('basics.firstName', /first\s*name|given name|fore\s*name|\bfname\b|\bf name\b/),
    R('basics.lastName', /last\s*name|family name|sur\s*name|\blname\b|\bl name\b/),
    R('basics.fullName', /full name|legal name|your name|^name$|candidate name|applicant name|\bname$/, {
      not: /company|employer|organi[sz]ation|school|universit|college|institution|file|user|referr|reference|manager|supervisor|emergency|business|job|position|degree|cover/,
    }),

    // Address
    R('basics.address2', /address (line )?2|\bapt\b|apartment|\bsuite\b|\bunit\b/),
    R('basics.address', /street|address line 1|address 1|mailing address|home address|^address$|^address /, {
      not: /e\s*mail|web|\burl\b|address 2/,
    }),
    // "Location (City)" is one typeahead for the whole place, so location is checked before city
    R('basics.location',
      /current location|^location$|location city|where are you (located|based)|where do you (live|reside)|city (and|or)? ?state|your location|^location /),
    R('basics.city', /\bcity\b|\btown\b|municipality/),
    R('basics.state', /\bstate\b|province|\bregion\b/, { not: /united states|country/ }),
    R('basics.zip', /\bzip\b|postal|post\s*code/),
    R('basics.country', /\bcountry\b/, { not: /code|phone|dial|citizen/ }),

    // Profile-ish
    R('basics.currentCompany', /current (company|employer|organi[sz]ation)|present employer|most recent (company|employer)/),
    R('basics.currentTitle', /current (job |position |role )?title|current (position|role)|most recent (job )?title/),
    R('education.gpa', /\bgpa\b|grade point/),
    R('education.degree', /\bdegree\b|highest (level of )?education|education level|level of education/),
    R('education.school', /^(school|university|college|institution)( name)?$|school or university|name of (school|university|college|institution)/),
    R('education.endDate', /graduation (year|date)|year of graduation|grad year/),
    R('basics.headline', /headline/),
    R('basics.summary', /\bsummary\b|about (you|yourself|me)|tell us about yourself|professional (summary|profile)|\bbio\b/),
    R('basics.skills', /\bskills?\b|technologies|tech stack|expertise/),
    R('basics.coverLetter', /cover letter|motivation letter|letter of interest/),
  ];

  // autocomplete="" tokens are the most reliable signal when present
  const AC_MAP = {
    'given-name': 'basics.firstName',
    'family-name': 'basics.lastName',
    'additional-name': 'basics.middleName',
    name: 'basics.fullName',
    email: 'basics.email',
    tel: 'basics.phone',
    'tel-national': 'basics.phone',
    'street-address': 'basics.address',
    'address-line1': 'basics.address',
    'address-line2': 'basics.address2',
    'address-level2': 'basics.city',
    'address-level1': 'basics.state',
    'postal-code': 'basics.zip',
    country: 'basics.country',
    'country-name': 'basics.country',
    organization: 'basics.currentCompany',
    'organization-title': 'basics.currentTitle',
  };

  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search', 'range', 'color']);
  const SKIP_HINTS = /captcha|honeypot|\bsearch\b|coupon|promo|password/;
  const CTRL_SEL = 'input:not([type=hidden]):not([type=file]), select, textarea';

  // ---- text rule matching --------------------------------------------------------------
  function matchText(text, section, type) {
    if (!text) return null;
    const lists = [];
    if (section && SECTION_RULES[section] && text.length <= 60) lists.push(SECTION_RULES[section]);
    lists.push(GLOBAL_RULES);
    for (const list of lists) {
      for (const r of list) {
        if (r.types && !r.types.includes(type)) continue;
        if (r.not && r.not.test(text)) continue;
        if (r.re.test(text)) return r;
      }
    }
    return null;
  }

  // ---- control discovery ---------------------------------------------------------------
  function isCombobox(el) {
    return (
      el.getAttribute('role') === 'combobox' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      /select__input/.test(el.className || '')
    );
  }

  function controlKind(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'file') return 'file';
      if (t === 'radio') return 'radio';
      if (t === 'checkbox') return 'checkbox';
      if (SKIP_INPUT_TYPES.has(t)) return null;
      return isCombobox(el) ? 'combobox' : 'text';
    }
    if (el.getAttribute && el.getAttribute('role') === 'combobox') return 'combobox';
    return null;
  }

  function hasVisibleLabel(el) {
    return Array.from(el.labels || []).some((l) => isVisible(l));
  }

  function collectControls(rootNode) {
    const all = deepQueryAll(rootNode || document, 'input, select, textarea, [role="combobox"]');
    const out = [];
    const seen = new Set();
    for (const el of all) {
      if (seen.has(el)) continue;
      seen.add(el);
      const kind = controlKind(el);
      if (!kind || el.disabled) continue;
      if (el.readOnly && kind !== 'combobox') continue;
      if (kind === 'file') out.push(el);
      else if (kind === 'radio' || kind === 'checkbox') {
        if (isVisible(el) || hasVisibleLabel(el)) out.push(el);
      } else if (isVisible(el) || isDateSectionBox(el)) out.push(el);
    }
    return out;
  }

  // Workday draws a date as plain digits and puts the real <input> on top of them with opacity 0 and
  // tabindex -1. It is the box the page reads from, so it is a real field even though it looks hidden.
  function isDateSectionBox(el) {
    if (!/dateSection(Month|Day|Year)-input/.test(el.getAttribute('data-automation-id') || '')) return false;
    return isVisible(el.closest('[data-automation-id="dateInputWrapper"]') || el.parentElement);
  }

  // ---- hints ---------------------------------------------------------------------------
  // A <label> without the text of any form control nested inside it.
  function labelOwnText(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, option').forEach((n) => n.remove());
    return cleanText(clone.textContent, 200);
  }

  function nearbyLabel(el) {
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      if (node.querySelectorAll(CTRL_SEL).length > 1) return '';
      const lab = node.querySelector('label, legend, [class*="label" i]');
      if (lab && !lab.contains(el)) {
        const t = cleanText(lab.textContent, 200);
        if (t) return t;
      }
      const prev = node.previousElementSibling;
      if (prev && !prev.querySelector('input, select, textarea')) {
        const t = cleanText(prev.textContent, 120);
        if (t && t.length < 100) return t;
      }
    }
    return '';
  }

  function labelTexts(el) {
    const out = [];
    if (el.labels && el.labels.length) Array.from(el.labels).forEach((l) => out.push(labelOwnText(l)));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      lb.split(/\s+/).forEach((id) => {
        const n = byId(el, id);
        if (n) out.push(cleanText(n.textContent, 200));
      });
    }
    const al = el.getAttribute('aria-label');
    if (al) out.push(cleanText(al, 200));
    if (!out.some(Boolean)) {
      const wrap = el.closest('label');
      if (wrap) out.push(labelOwnText(wrap));
    }
    if (!out.some(Boolean)) out.push(nearbyLabel(el));
    return out.filter(Boolean);
  }

  // Question text for a group of options (radios / checkboxes) or a multi-part field (dates).
  function groupText(el, kind) {
    const out = [];
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) out.push(lg.textContent);
    }
    const rg = el.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const lb = rg.getAttribute('aria-labelledby');
      if (lb) lb.split(/\s+/).forEach((id) => { const n = byId(el, id); if (n) out.push(n.textContent); });
      const al = rg.getAttribute('aria-label');
      if (al) out.push(al);
    }
    // A bare list of options with no fieldset/legend: only a NAMED group of 2+ inputs counts,
    // so a lone checkbox ("Current role") never borrows the text of whatever precedes it.
    if (!out.some(Boolean) && (kind === 'radio' || kind === 'checkbox') && el.name) {
      let node = el.parentElement;
      for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
        const same = Array.from(node.querySelectorAll('input[type=' + kind + ']'));
        const names = new Set(same.map((r) => r.name || ''));
        if (names.size > 1) break; // we have climbed into a different question
        if (same.length < 2) continue; // not a group of options yet
        const qs = node.querySelectorAll(
          'legend, [class*="question" i], [class*="label" i]:not(label), h1, h2, h3, h4, h5, h6, p, strong'
        );
        let found = null;
        for (const q of qs) {
          if (q.closest('label') || q.contains(el)) continue;
          if (!(q.compareDocumentPosition(el) & 4)) break;
          const t = cleanText(q.textContent, 300);
          if (t.length >= 3) found = t;
        }
        if (found) { out.push(found); break; }
      }
    }
    return normalize(out.join(' '));
  }

  // ---- section detection (Education vs Work experience) ----------------------------------
  const HEAD_SEL =
    'h1, h2, h3, h4, h5, h6, legend, [role="heading"], [class*="section-title" i], [class*="section-header" i], [class*="sectionHeader" i], [class*="heading" i]';
  const SUBLABEL = /^(start|end|from|to|date|dates|month|year|start date|end date)$/;
  const SECTION_TESTS = [
    ['experience', /work experience|employment|work history|professional experience|job history|\bexperience\b|\bemployer\b|positions? held/],
    ['education', /education|academic|school|universit|\bdegree\b|college/],
  ];

  function sectionFromText(t) {
    for (const [k, re] of SECTION_TESTS) if (re.test(t)) return k;
    return null;
  }

  function sectionOf(el) {
    let node = el;
    for (let depth = 0; depth < 14 && node && node.parentElement; depth++) {
      node = node.parentElement;
      const attr = normalize(
        [node.getAttribute('data-automation-id'), node.getAttribute('data-section'), node.id].filter(Boolean).join(' ')
      );
      if (attr) {
        const s = sectionFromText(attr);
        if (s) return s;
      }
      // Headings inside this ancestor that come before the control, nearest first. The first
      // one that is decisive wins. Legends are field-group labels ("Start date"), so they only
      // count when they name a section themselves; sub-labels like "Start date" are skipped.
      const before = [];
      for (const h of node.querySelectorAll(HEAD_SEL)) {
        if (h.contains(el) || h.textContent.length > 120) continue;
        if (h.compareDocumentPosition(el) & 4) before.push(h);
        else break;
      }
      for (let i = before.length - 1; i >= 0; i--) {
        const h = before[i];
        const t = normalize(h.textContent).slice(0, 80);
        if (!t || SUBLABEL.test(t)) continue;
        const s = sectionFromText(t);
        if (h.tagName === 'LEGEND') {
          if (s && t.length <= 40) return s;
          continue;
        }
        return s; // a real heading: it decides, even when it names neither section
      }
      if (node.tagName === 'FORM' || node.tagName === 'BODY') break;
    }
    return null;
  }

  // ---- classification ------------------------------------------------------------------
  function getHints(el, kind) {
    const labels = labelTexts(el);
    const placeholder = el.getAttribute('placeholder') || '';
    const parts = [
      ...labels,
      el.getAttribute('aria-label') || '',
      placeholder,
      el.getAttribute('name') || '',
      el.id || '',
      el.getAttribute('data-automation-id') || '',
      el.getAttribute('data-qa') || '',
      el.getAttribute('data-testid') || '',
    ].map(normalize).filter(Boolean);
    const labelRaw = labels[0] || placeholder || el.getAttribute('name') || el.id || '';
    const required =
      el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\(required\)/i.test(labelRaw);
    return {
      parts: Array.from(new Set(parts)),
      group: groupText(el, kind),
      label: cleanText(labelRaw.replace(/\s*\*\s*$/, ''), 120),
      placeholderRaw: placeholder,
      required,
    };
  }

  // Month / year / day part of a split date field ("Start date: [Month] [Year]").
  // The input's own attributes decide first (Workday's data-automation-id "dateSectionYear-input",
  // placeholder "YYYY", aria-label "Month"). Label and group text only decide when it names exactly
  // one part: a shared hint such as "MM/YYYY" names both and must not turn the year box into a month box.
  function wordsOf(text) {
    const t = normalize(text);
    return {
      month: /\bmonth\b|\bmm\b/.test(t),
      year: /\byear\b|\byyyy\b/.test(t),
      day: /\bday\b|\bdd\b/.test(t),
    };
  }
  function onlyPart(w) {
    const hits = ['month', 'year', 'day'].filter((k) => w[k]);
    return hits.length === 1 ? hits[0] : null;
  }
  function datePart(el, hints) {
    const attr = (n) => el.getAttribute(n) || '';
    const own = onlyPart(wordsOf([
      attr('data-automation-id'), attr('data-uxi-element-id'), attr('id'), attr('name'), attr('placeholder'), attr('aria-label'),
    ].join(' ')));
    if (own) return own;
    const fromHints = onlyPart(wordsOf(hints.parts.join(' ')));
    if (fromHints) return fromHints;
    if (el.tagName === 'SELECT') {
      const texts = Array.from(el.options).map((o) => normalize(o.text));
      if (texts.some((t) => /^(january|jan)$/.test(t))) return 'month';
      if (texts.filter((t) => /^(19|20)\d\d$/.test(t)).length >= 5) return 'year';
    }
    return null;
  }

  function classifyControl(el) {
    const kind = controlKind(el);
    if (!kind) return null;
    const hints = getHints(el, kind);
    if (hints.parts.some((p) => SKIP_HINTS.test(p))) return null;

    const base = { el, kind, label: hints.label, required: hints.required, hints, key: null, part: null };

    if (kind === 'file') {
      const text = hints.parts.join(' ');
      if (/cover letter/.test(text)) base.key = 'file.cover';
      else if (/resume|\bcv\b|curriculum/.test(text)) base.key = 'file.resume';
      return base;
    }

    // 0. autocomplete token
    const ac = (el.getAttribute('autocomplete') || '').trim().split(/\s+/).pop();
    if (ac && AC_MAP[ac]) {
      base.key = AC_MAP[ac];
    } else {
      const section = sectionOf(el);
      // Radios/checkboxes: the question is the group text; the element's own label is just an option.
      // A lone checkbox is described by its own label; a radio's own label is just one option.
      const stages =
        kind === 'radio' && hints.group
          ? [[hints.group], hints.parts]
          : [hints.parts, hints.parts.map((p) => (hints.group ? hints.group + ' ' + p : null)).filter(Boolean)];
      outer: for (const stage of stages) {
        for (const text of stage) {
          const r = matchText(text, section, kind);
          if (r) { base.key = r.key; break outer; }
        }
      }
    }

    if (base.key && /\.(startDate|endDate)$/.test(base.key)) base.part = datePart(el, hints);
    return base;
  }

  JA.matcher = {
    SECTION_RULES, GLOBAL_RULES, AC_MAP,
    matchText, controlKind, isCombobox, collectControls, hasVisibleLabel,
    getHints, groupText, sectionOf, classifyControl,
  };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
