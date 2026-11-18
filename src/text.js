// Pure text helpers: normalisation, option matching (states, degrees, yes/no, "decline"),
// and date parsing/formatting. No DOM access here so it can be unit-tested in Node.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const STATES = [
    ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
    ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
    ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
    ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
    ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
    ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
    ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
    ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
    ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
    ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
    ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ];
  const STATE_BY_ABBR = {};
  const ABBR_BY_STATE = {};
  STATES.forEach(([a, n]) => {
    STATE_BY_ABBR[a] = n;
    ABBR_BY_STATE[n.toLowerCase()] = a;
  });

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // lower-case, split camelCase, drop punctuation: "first_name" / "firstName" -> "first name"
  function normalize(s) {
    if (s == null) return '';
    return String(s)
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function cleanText(s, max) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 300);
  }

  const isYes = (v) => /^(y|yes|true)$/i.test(String(v == null ? '' : v).trim());
  const isNo = (v) => /^(n|no|false)$/i.test(String(v == null ? '' : v).trim());

  // All the spellings we are willing to accept for a desired value, best first (normalised).
  function candidates(desired) {
    const raw = String(desired == null ? '' : desired).trim();
    if (!raw) return [];
    const n = normalize(raw);
    const out = [n];
    const add = (...xs) =>
      xs.forEach((x) => {
        const nx = normalize(x);
        if (nx && !out.includes(nx)) out.push(nx);
      });

    if (isYes(raw)) add('yes');
    if (isNo(raw)) add('no');

    // US states: "CA" <-> "California"
    if (STATE_BY_ABBR[raw.toUpperCase()]) add(STATE_BY_ABBR[raw.toUpperCase()]);
    if (ABBR_BY_STATE[n]) add(ABBR_BY_STATE[n]);

    // United States
    if (/^(us|usa|u s|u s a|united states|united states of america|america)$/.test(n)) {
      add('United States', 'United States of America', 'USA', 'US');
    }

    // Degrees
    if (/bachelor|\bb\.?\s?(s|a|sc|e|eng|tech)\b|undergrad/i.test(raw)) {
      add('Bachelors Degree', 'Bachelors', 'Bachelor', 'Bachelor of Science', 'Bachelor of Arts', 'BS', 'BA', 'Undergraduate');
    }
    if (/master|\bm\.?\s?(s|a|sc|eng)\b|\bmba\b/i.test(raw)) {
      add('Masters Degree', 'Masters', 'Master', 'Master of Science', 'Master of Arts', 'MS', 'MA', 'Graduate');
    }
    if (/ph\.?\s?d|doctor/i.test(raw)) {
      add('Doctorate', 'Doctor of Philosophy', 'PhD', 'Doctoral');
    }
    if (/associate/i.test(raw)) add('Associates Degree', 'Associates', 'Associate', 'AA', 'AS');
    if (/high school|\bged\b|secondary/i.test(raw)) add('High School', 'High School Diploma', 'GED');

    // Gender wording
    if (n === 'male') add('man');
    if (n === 'female') add('woman');
    if (/^non ?binary/.test(n)) add('non binary', 'nonbinary', 'genderqueer');

    // "Decline to answer" family
    if (/^(decline|prefer not|choose not|i dont wish|i do not wish|not to say|rather not)/.test(n)) {
      add(
        'decline to self identify', 'decline to answer', 'decline', 'prefer not to say',
        'prefer not to answer', 'prefer not to disclose', 'i dont wish to answer',
        'i do not wish to answer', 'choose not to disclose', 'do not wish to disclose',
        'i dont wish to disclose', 'not wish to answer'
      );
    }
    return out;
  }

  // options: [{text, value}] -> index of best match for `desired`, or -1.
  function pickOption(options, desired, minScore) {
    const cands = candidates(desired);
    if (!cands.length) return -1;
    const floor = minScore || 50;
    let best = -1;
    let bestScore = 0;
    options.forEach((o, i) => {
      const t = normalize(o.text);
      const v = normalize(o.value);
      if (!t && !v) return;
      let score = 0;
      cands.forEach((c, ci) => {
        let s = 0;
        if (t === c || v === c) s = 100;
        else if (t.startsWith(c + ' ') || v.startsWith(c + ' ')) s = 80;
        else if ((' ' + t + ' ').includes(' ' + c + ' ')) s = 70;
        else if (t.length >= 3 && (' ' + c + ' ').includes(' ' + t + ' ')) s = 55;
        if (s && ci === 0) s += 5; // prefer the literal wording over a synonym
        if (s > score) score = s;
      });
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return bestScore >= floor ? best : -1;
  }

  // ---- ordered name lists (Degree / Field of Study) ------------------------------------
  // "Master of Science (MS)" -> "Master of Science"
  const stripParen = (s) => String(s == null ? '' : s).replace(/\s*\([^)]*\)\s*$/, '');

  // options: [{text, value}]; list: names in the order they should be tried; stems: last-resort words.
  // For each name, in order, the first option that IS that name wins (capitals, punctuation, apostrophes
  // and a trailing "(...)" are ignored). Nothing fuzzy: "Master of Arts" never matches "Master of Science".
  // Stems only count when exactly one option contains the word ("master" also covers "masters").
  // Returns { index, name, rank, via } or null. rank is the position in `list` (0 = the saved name).
  function pickFromList(options, list, stems) {
    const opts = options.map((o) => {
      const text = normalize(o.text);
      return { text, bare: normalize(stripParen(o.text)), value: normalize(o.value) };
    });
    const names = Array.isArray(list) ? list : [];
    for (let r = 0; r < names.length; r++) {
      const full = normalize(names[r]);
      const bare = normalize(stripParen(names[r]));
      if (!full) continue;
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        if (!o.text && !o.value) continue;
        if (o.text === full || o.bare === bare || (o.value && o.value === full)) {
          return { index: i, name: names[r], rank: r, via: 'name' };
        }
      }
    }
    for (const stem of Array.isArray(stems) ? stems : []) {
      const w = normalize(stem);
      if (!w) continue;
      const hits = [];
      opts.forEach((o, i) => {
        if (o.text.split(' ').some((x) => x === w || x === w + 's')) hits.push(i);
      });
      if (hits.length === 1) return { index: hits[0], name: stem, rank: names.length, via: 'stem' };
    }
    return null;
  }

  // Try several desired spellings in order (used for months: "January", "Jan", "01", "1").
  function pickOptionAny(options, desiredList) {
    for (const d of desiredList) {
      const i = pickOption(options, d, 70);
      if (i >= 0) return i;
    }
    return -1;
  }

  // ---- dates -------------------------------------------------------------------------
  function parseDate(s) {
    if (s == null || s === '') return null;
    const str = String(s).trim();
    if (/^(present|current|now|ongoing)$/i.test(str)) return { present: true };
    let m;
    if ((m = str.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : 1 };
    if ((m = str.match(/^(\d{1,2})\/(\d{4})$/))) return { y: +m[2], m: +m[1], d: 1 };
    if ((m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { y: +m[3], m: +m[1], d: +m[2] };
    if ((m = str.match(/^(\d{4})$/))) return { y: +m[1], m: 1, d: 1, yearOnly: true };
    if ((m = str.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
      const idx = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
      if (idx >= 0) return { y: +m[2], m: idx + 1, d: 1 };
    }
    return null;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function formatDate(p, style) {
    if (!p || p.present) return '';
    switch (style) {
      case 'YYYY-MM': return `${p.y}-${pad2(p.m)}`;
      case 'YYYY-MM-DD': return `${p.y}-${pad2(p.m)}-${pad2(p.d || 1)}`;
      case 'MM/DD/YYYY': return `${pad2(p.m)}/${pad2(p.d || 1)}/${p.y}`;
      case 'DD/MM/YYYY': return `${pad2(p.d || 1)}/${pad2(p.m)}/${p.y}`;
      case 'Mon YYYY': return `${MONTH_NAMES[p.m - 1].slice(0, 3)} ${p.y}`;
      case 'Month YYYY': return `${MONTH_NAMES[p.m - 1]} ${p.y}`;
      case 'YYYY': return String(p.y);
      case 'MM/YYYY':
      default: return `${pad2(p.m)}/${p.y}`;
    }
  }

  // Choose a text format from the input type and placeholder / label hints (raw, un-normalised).
  function dateStyleFrom(type, hint) {
    if (type === 'month') return 'YYYY-MM';
    if (type === 'date') return 'YYYY-MM-DD';
    const h = String(hint || '').toLowerCase();
    if (/mm\s*\/\s*dd\s*\/\s*yyyy/.test(h)) return 'MM/DD/YYYY';
    if (/dd\s*\/\s*mm\s*\/\s*yyyy/.test(h)) return 'DD/MM/YYYY';
    if (/mm\s*[\/-]\s*yyyy/.test(h)) return 'MM/YYYY';
    if (/yyyy\s*-\s*mm/.test(h)) return 'YYYY-MM';
    if (/mmm\s*yyyy|month\s*year/.test(h)) return 'Mon YYYY';
    if (/(^|\s)yyyy(\s|$)/.test(h)) return 'YYYY';
    return 'MM/YYYY';
  }

  function monthCandidates(m) {
    const name = MONTH_NAMES[m - 1];
    return [name, name.slice(0, 3), pad2(m), String(m)];
  }

  JA.text = {
    STATES, MONTH_NAMES, normalize, cleanText, isYes, isNo,
    candidates, pickOption, pickOptionAny, pickFromList, stripParen,
    parseDate, formatDate, dateStyleFrom, monthCandidates,
  };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
