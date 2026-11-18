(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---- schema: what the editor shows -------------------------------------------------------
  const BASICS = [
    ['firstName', 'First name'], ['middleName', 'Middle name'],
    ['lastName', 'Last name'], ['preferredName', 'Preferred name'],
    ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'],
    ['phoneCountryCode', 'Phone country code (e.g. +1)'], ['headline', 'Headline (e.g. Software Engineer)'],
    ['address', 'Street address'], ['address2', 'Address line 2'],
    ['city', 'City'], ['state', 'State / province (e.g. CA)'],
    ['zip', 'ZIP / postal code'], ['country', 'Country'],
    ['linkedin', 'LinkedIn URL', 'url'], ['github', 'GitHub URL', 'url'],
    ['portfolio', 'Website / portfolio URL', 'url'],
    ['summary', 'Professional summary', 'textarea'],
  ];

  const APPLICATION = [
    ['authorizedToWork', 'Authorized to work in the country you are applying in?', 'yesno'],
    ['requiresSponsorship', 'Will you require visa sponsorship now or in the future?', 'yesno'],
    ['willingToRelocate', 'Willing to relocate?', 'yesno'],
    ['over18', 'At least 18 years old?', 'yesno'],
    ['previouslyWorkedHere', 'Previously employed by the company you apply to?', 'yesno'],
    ['noticePeriod', 'Notice period (e.g. 2 weeks)'],
    ['availableStartDate', 'Earliest start date (as you would type it)'],
    ['salaryExpectation', 'Salary expectation'],
    ['referralSource', 'How did you hear about us? (default answer)'],
    ['yearsExperience', 'Years of experience (default answer)'],
  ];

  const EEO = [
    ['gender', 'Gender'], ['race', 'Race / ethnicity'], ['hispanic', 'Hispanic or Latino?'],
    ['veteran', 'Veteran status'], ['disability', 'Disability status'], ['lgbtq', 'LGBTQ+ / sexual orientation'],
  ];

  // Education is locked: it comes from src/education.js and cannot be edited here.

  // ---- state -------------------------------------------------------------------------------
  let profile = normalize({});
  let dirty = false;
  let resumeParsed = null; // bullets read from the uploaded PDF, by company

  function normalize(p) {
    const out = p && typeof p === 'object' ? JSON.parse(JSON.stringify(p)) : {};
    delete out.basics; // locked, see src/basics.js
    delete out.application; // locked, see src/answers.js
    delete out.eeo;
    delete out.education; // locked, see src/education.js
    delete out.experience; // locked, see src/experience.js
    out.skills = Array.isArray(out.skills)
      ? out.skills.map(String)
      : typeof out.skills === 'string' ? out.skills.split(',').map((s) => s.trim()).filter(Boolean) : [];
    out.coverLetter = typeof out.coverLetter === 'string' ? out.coverLetter : '';
    return out;
  }

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k, i) => {
      if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    });
    o[keys[keys.length - 1]] = value;
  }

  function markDirty() {
    dirty = true;
    $('saveMsg').textContent = 'Unsaved changes';
    $('saveMsg').className = 'muted';
  }

  // ---- rendering ---------------------------------------------------------------------------
  function make(tag, props, children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    (children || []).forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }

  function field(path, label, type, opts) {
    const wrap = make('label', { className: 'field' + (type === 'textarea' ? ' wide' : type === 'checkbox' ? ' check' : '') });
    let input;
    if (type === 'textarea') {
      input = make('textarea', { rows: (opts && opts.rows) || 4 });
    } else if (type === 'yesno') {
      input = make('select');
      ['', 'Yes', 'No'].forEach((v) => input.appendChild(make('option', { value: v, textContent: v || '— skip —' })));
    } else if (type === 'checkbox') {
      input = make('input', { type: 'checkbox' });
    } else {
      input = make('input', { type: type || 'text' });
      if (opts && opts.list) input.setAttribute('list', opts.list);
    }
    input.dataset.path = path;
    const v = path === 'skillsText' ? profile.skills.join(', ') : getPath(profile, path);
    if (type === 'checkbox') input.checked = !!v;
    else input.value = v == null ? '' : String(v);

    if (type === 'checkbox') { wrap.appendChild(input); wrap.appendChild(make('span', { textContent: label })); }
    else { wrap.appendChild(make('span', { textContent: label })); wrap.appendChild(input); }
    return wrap;
  }

  function sectionBox(title, hint) {
    const s = make('section');
    s.appendChild(make('h2', { textContent: title }));
    if (hint) s.appendChild(make('p', { className: 'muted', textContent: hint }));
    return s;
  }

  function grid(items, prefix, opts) {
    const g = make('div', { className: 'grid' });
    items.forEach(([key, label, type]) => g.appendChild(field(`${prefix}.${key}`, label, type, opts)));
    return g;
  }

  // Education: shown, never editable (no inputs, no add / remove / reorder).
  function lockedEducation() {
    const E = window.JA && window.JA.education;
    const box = sectionBox('Education (locked)',
      'This section cannot be edited here. To change it, edit src/education.js and reload the extension. ' +
      'Degree and Field of study are tried in the order shown: the saved name first, then each name below it, ' +
      'and the first one the application page really offers is chosen.');
    box.classList.add('locked-section');
    ((E && E.entries) || []).forEach((entry, i) => {
      const card = make('div', { className: 'card locked' });
      card.appendChild(make('div', { className: 'card-head' }, [
        make('h3', { textContent: [entry.degree, entry.school].filter(Boolean).join(' — ') || `Entry ${i + 1}` }),
      ]));
      const dates = [entry.startDate, entry.endDate || 'present'].filter(Boolean).join(' → ');
      const rows = [
        ['School', entry.school],
        ['Dates', dates],
        ['Degree, tried in this order', E.wanted(entry, 'degree').list.join('  ›  ')],
        ['Field of study, tried in this order', E.wanted(entry, 'field').list.join('  ›  ')],
      ];
      const dl = make('dl', { className: 'locked-list' });
      rows.forEach(([k, v]) => {
        if (!v) return;
        dl.appendChild(make('dt', { textContent: k }));
        dl.appendChild(make('dd', { textContent: v }));
      });
      card.appendChild(dl);
      box.appendChild(card);
    });
    return box;
  }

  function lockedBasics() {
    const B = window.JA && window.JA.basics;
    const box = sectionBox('Basic details (locked)',
      'This section cannot be edited here. To change it, edit src/basics.js and reload the extension.');
    box.classList.add('locked-section');
    const dl = make('dl', { className: 'locked-list' });
    BASICS.forEach(([key, label]) => {
      const v = B && B.values[key];
      if (!v) return;
      dl.appendChild(make('dt', { textContent: label }));
      dl.appendChild(make('dd', { textContent: v }));
    });
    box.appendChild(dl);
    return box;
  }

  // A locked list of answers. Blank answers are shown as "skipped" (answered by you on the form).
  function lockedList(title, items, group) {
    const A = window.JA && window.JA.answers;
    const box = sectionBox(title, 'This section cannot be edited here. To change it, edit src/answers.js and reload the extension. Blank = skipped, you answer it on the form.');
    box.classList.add('locked-section');
    const dl = make('dl', { className: 'locked-list' });
    items.forEach(([key, label]) => {
      const v = A && A[group][key];
      dl.appendChild(make('dt', { textContent: label }));
      dl.appendChild(make('dd', { textContent: v || '— skipped —' }));
    });
    box.appendChild(dl);
    return box;
  }

  // Work experience: shown, never editable. The description is whatever was read from the uploaded PDF resume.
  function lockedExperience() {
    const X = window.JA && window.JA.experience;
    const box = sectionBox('Work experience (locked)',
      'This section cannot be edited here. To change the jobs, edit src/experience.js and reload the extension. ' +
      'The Description / bullet points are read from the PDF resume you upload above, so each application gets the bullets of the resume you attached for it.');
    box.classList.add('locked-section');
    ((X && X.entries) || []).forEach((e) => {
      const card = make('div', { className: 'card locked' });
      card.appendChild(make('div', { className: 'card-head' }, [make('h3', { textContent: `${e.title} — ${e.company}` })]));
      const hit = (resumeParsed || []).find((x) => x && x.company === e.company);
      const dl = make('dl', { className: 'locked-list' });
      [['Location', e.location],
        ['Dates', [e.startDate, e.current ? 'present' : e.endDate].filter(Boolean).join(' → ')]].forEach(([k, v]) => {
        if (!v) return;
        dl.appendChild(make('dt', { textContent: k }));
        dl.appendChild(make('dd', { textContent: v }));
      });
      dl.appendChild(make('dt', { textContent: 'Description / bullet points' }));
      dl.appendChild(make('dd', {
        className: 'desc',
        textContent: hit && hit.description ? hit.description
          : resumeParsed ? 'No bullet points found for this job in the uploaded resume.'
            : 'Taken from your PDF resume once you upload it.',
      }));
      card.appendChild(dl);
      box.appendChild(card);
    });
    return box;
  }

  function renderForm() {
    const root = $('form');
    root.textContent = '';

    root.appendChild(lockedBasics());

    root.appendChild(lockedExperience());
    root.appendChild(lockedEducation());

    const skills = sectionBox('Skills & cover letter');
    const g = make('div', { className: 'grid' });
    g.appendChild(field('skillsText', 'Skills (comma-separated)', 'textarea', { rows: 3 }));
    g.appendChild(field('coverLetter', 'Default cover letter text (used only for text boxes, not file uploads)', 'textarea', { rows: 6 }));
    skills.appendChild(g);
    root.appendChild(skills);

    root.appendChild(lockedList('Common application answers (locked)', APPLICATION, 'application'));
    root.appendChild(lockedList('Voluntary self-identification (locked)', EEO, 'eeo'));
  }

  // ---- events ------------------------------------------------------------------------------
  function onEdit(e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.path) return;
    const val = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.path === 'skillsText') {
      profile.skills = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      setPath(profile, t.dataset.path, val);
    }
    if (/\.current$/.test(t.dataset.path)) {
      const end = t.closest('.card').querySelector('[data-path$=".endDate"]');
      if (end) end.disabled = t.checked;
    }
    markDirty();
  }

  function onClick(e) {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const list = profile[b.dataset.section];
    const i = Number(b.dataset.index);
    switch (b.dataset.action) {
      case 'add': list.push({}); break;
      case 'remove': list.splice(i, 1); break;
      case 'up': if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; break;
      case 'down': if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]]; break;
      default: return;
    }
    markDirty();
    renderForm();
  }

  async function save() {
    const msg = $('saveMsg');
    try {
      await chrome.storage.local.set({ profile });
      dirty = false;
      msg.textContent = 'Saved ✓';
      msg.className = 'ok';
    } catch (err) {
      msg.textContent = 'Could not save: ' + err;
      msg.className = 'bad';
    }
  }

  function importJson() {
    const msg = $('importMsg');
    try {
      const parsed = JSON.parse($('json').value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
      profile = normalize(parsed);
      renderForm();
      markDirty();
      msg.textContent = 'Loaded into the form. Press Save profile to keep it.' +
        ((['education', 'experience', 'basics', 'application', 'eeo'].some((k) => k in parsed)) ? ' (Basic details, Work experience, Education, application answers and self-identification are locked, so those parts of your JSON were ignored.)' : '');
      msg.className = 'ok';
    } catch (err) {
      msg.textContent = 'Invalid JSON: ' + err.message;
      msg.className = 'bad';
    }
  }

  // ---- resume file -------------------------------------------------------------------------
  async function showResume() {
    const { resume } = await chrome.storage.local.get('resume');
    resumeParsed = resume && Array.isArray(resume.parsed) ? resume.parsed : null;
    let text = resume ? `Attached: ${resume.name} (${Math.round(resume.size / 1024)} KB)` : 'No resume file attached yet.';
    if (resume && resumeParsed) {
      text += '. Bullet points read: ' + resumeParsed.map((x) => `${x.company} ${x.count}`).join(', ');
      const none = resumeParsed.filter((x) => !x.count).map((x) => x.company);
      if (none.length) text += `. None found for ${none.join(', ')}: check the resume has a Work Experience section with bullets under each company.`;
    } else if (resume) {
      text += '. Bullet points were not read (only PDF resumes are read).';
    }
    $('resumeInfo').textContent = text;
    $('removeResume').disabled = !resume;
    renderForm();
  }

  const { parseResume, readBase64 } = window.JA.resumeUpload;

  async function onResumePicked() {
    const f = $('resumeFile').files[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      $('resumeInfo').textContent = 'That file is over 4 MB. Please pick a smaller one.';
      return;
    }
    const data = await readBase64(f);
    $('resumeInfo').textContent = 'Reading the resume…';
    const parsed = await parseResume(f);
    await chrome.storage.local.set({
      resume: { name: f.name, type: f.type || 'application/pdf', size: f.size, data, parsed },
    });
    $('resumeFile').value = '';
    showResume();
  }

  // ---- init --------------------------------------------------------------------------------
  async function init() {
    const stored = await chrome.storage.local.get('profile');
    profile = normalize(stored.profile || {});
    renderForm();
    showResume();

    $('form').addEventListener('input', onEdit);
    $('form').addEventListener('change', onEdit);
    $('form').addEventListener('click', onClick);
    $('save').addEventListener('click', save);
    $('importBtn').addEventListener('click', importJson);
    $('exportBtn').addEventListener('click', () => { $('json').value = JSON.stringify(profile, null, 2); });
    $('downloadBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
      const a = make('a', { href: URL.createObjectURL(blob), download: 'job-autofill-profile.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    $('sampleBtn').addEventListener('click', async () => {
      const res = await fetch(chrome.runtime.getURL('sample-profile.json'));
      $('json').value = await res.text();
    });
    $('resumeFile').addEventListener('change', onResumePicked);
    $('removeResume').addEventListener('click', async () => {
      await chrome.storage.local.remove('resume');
      showResume();
    });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  init();
})();
