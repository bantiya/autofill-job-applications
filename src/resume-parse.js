// Finds each job's bullet points in the text of a resume. Pure text in, text out (no PDF or DOM code), so it
// can be unit-tested. `lines` are the resume's text lines in reading order.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const BULLET = /^\s*([•●▪■◦‣▸►·*]|-|–|—)\s+/;
  const SECTION_START = /^\s*(professional |work |relevant |employment |industry )?(experience|work history|employment( history)?)\s*$/i;
  // The next all-capitals (or well known) heading ends the experience section.
  const SECTION_END = /^\s*(projects?|education|technical skills|skills|certifications?|awards?|publications?|summary|professional summary|achievements|languages|interests|volunteer(ing)?( experience)?|leadership|activities)\b[^a-z]{0,20}$/i;
  const DATE_RANGE = /(?:[A-Za-z]{3,9}\.?\s+)?\d{4}\s*[-–—to]+\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?\d{4}|present|current|now)/i;

  function names(entry) {
    return [entry.company].concat(entry.aliases || []).map(norm).filter(Boolean);
  }

  // Which job does this line start (a heading like "Example Corporation   Jan 2024 - Sep 2026")?
  function headerOf(line, entries) {
    if (BULLET.test(line)) return -1;
    const n = norm(line);
    if (!n) return -1;
    for (let i = 0; i < entries.length; i++) {
      for (const name of names(entries[i])) {
        if (n === name || n.startsWith(name + ' ') || (' ' + n + ' ').includes(' ' + name + ' ')) {
          if (DATE_RANGE.test(line) || line.trim().length <= 60) return i;
        }
      }
    }
    return -1;
  }

  // -> [{ company, bullets: [...], description }] in the same order as `entries`.
  function extractExperience(lines, entries) {
    const out = entries.map((e) => ({ company: e.company, bullets: [], description: '' }));
    let start = lines.findIndex((l) => SECTION_START.test(l));
    const scan = start >= 0 ? lines.slice(start + 1) : lines; // no heading found: look everywhere
    let job = -1;
    let open = false; // is the last bullet still being continued on the next line?
    for (const raw of scan) {
      const line = String(raw).replace(/\s+/g, ' ').trim();
      if (!line) { open = false; continue; }
      if (start >= 0 && SECTION_END.test(line)) break;
      const h = headerOf(line, entries);
      if (h >= 0 && !(open && h === job && !DATE_RANGE.test(line))) { job = h; open = false; continue; }
      if (job < 0) continue;
      if (BULLET.test(line)) {
        out[job].bullets.push(line.replace(BULLET, ''));
        open = true;
      } else if (open && out[job].bullets.length) {
        const i = out[job].bullets.length - 1;
        const prev = out[job].bullets[i];
        out[job].bullets[i] = /[a-z]-$/.test(prev) ? prev.slice(0, -1) + line : prev + ' ' + line;
      } // else: a title / location line under the heading
    }
    out.forEach((o) => { o.description = o.bullets.map((b) => '• ' + b).join('\n'); });
    return out;
  }

  // ---- technical skills ------------------------------------------------------------------------
  // Heading of the skills section ("TECHNICAL SKILLS", "Skills & Tools", "Core Competencies" ...).
  const SKILLS_START = /^\s*(technical |core |key |relevant |professional )?(skills|technologies|competencies|tech stack)(\s*(&|and|\/)\s*[A-Za-z ]{2,30})?\s*:?\s*$/i;
  const OTHER_HEADING = /^\s*(professional |work |relevant |employment |industry )?(experience|work history|employment( history)?)\s*$|^\s*(projects?|education|certifications?|awards?|publications?|summary|professional summary|achievements|languages|interests|volunteer(ing)?( experience)?|leadership|activities|references)\b[^a-z]{0,20}$/i;
  const ALL_CAPS_HEADING = /^[A-Z][A-Z &\/]{3,38}$/;
  const CATEGORY = /^([A-Za-z][A-Za-z0-9 &\/+.\-]{1,40}?)\s*:\s*(.*)$/;

  // Splits on commas, semicolons, pipes and bullets that are not inside brackets.
  function splitSkills(text) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(text)) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;|•●▪■◦‣·]/.test(ch)) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  // -> ['Java', 'Python', ...] from the lines of a resume (the "Technical Skills" section), no repeats.
  function extractSkills(lines) {
    const start = lines.findIndex((l) => SKILLS_START.test(String(l).replace(/\s+/g, ' ').trim()));
    if (start < 0) return [];
    const chunks = []; // one per category line ("Languages: Java, Python") or per plain line
    for (const raw of lines.slice(start + 1)) {
      const line = String(raw).replace(/\s+/g, ' ').trim();
      if (!line) { if (chunks.length) break; else continue; } // a blank line after the content ends the section
      if (OTHER_HEADING.test(line) || SKILLS_START.test(line) || (ALL_CAPS_HEADING.test(line) && !line.includes(','))) break;
      const text = line.replace(BULLET, '');
      const cat = CATEGORY.exec(text);
      if (cat) chunks.push(cat[2]);
      else if (chunks.length && !BULLET.test(line)) { // wrapped continuation of the previous line
        const prev = chunks[chunks.length - 1];
        chunks[chunks.length - 1] = prev + (/[,;]$/.test(prev) ? ' ' : ', ') + text;
      } else chunks.push(text);
    }
    const seen = new Set();
    const out = [];
    for (const chunk of chunks) {
      for (let s of splitSkills(chunk)) {
        s = s.replace(/\s+/g, ' ').replace(/^(and|&)\s+/i, '').replace(/[.:\s]+$/, '').trim();
        if (!s || s.length > 40 || s.split(' ').length > 5) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
      }
    }
    return out.slice(0, 150);
  }

  JA.resumeParse = { extractExperience, extractSkills, headerOf };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
