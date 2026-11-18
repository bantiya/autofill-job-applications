(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  const SECTIONS = [
    ['basics', 'Basic details & links'],
    ['experience', 'Work experience'],
    ['education', 'Education'],
    ['skills', 'Skills'],
    ['application', 'Application answers'],
    ['eeo', 'Voluntary self-identification'],
    ['resume', 'Resume upload'],
    ['cover', 'Cover letter'],
  ];

  async function initSections() {
    const { sections } = await chrome.storage.local.get('sections');
    const state = sections || {};
    const box = $('sections');
    box.textContent = '';
    const inputs = [];
    const addSwitch = (target, id, label, title) => {
      const row = el('label', null, 'sw');
      if (title) row.title = title;
      const input = el('input');
      input.type = 'checkbox';
      if (id) input.dataset.section = id;
      input.checked = id ? state[id] !== false : true;
      row.appendChild(el('span', label));
      row.appendChild(input);
      row.appendChild(el('i', null, 'slider'));
      target.appendChild(row);
      return input;
    };
    // Master switch: on = every section on, off = every section off. Sections can then be switched
    // individually; the master shows "on" only while all of them are on.
    const master = $('allSwitch');
    master.textContent = '';
    const allInput = addSwitch(master, null, 'All sections', 'Turn every section on or off at once');
    const syncMaster = () => { allInput.checked = inputs.every((i) => i.checked); };
    SECTIONS.forEach(([id, label]) => {
      const input = addSwitch(box, id, label);
      inputs.push(input);
      input.addEventListener('change', async () => {
        const cur = (await chrome.storage.local.get('sections')).sections || {};
        cur[id] = input.checked;
        await chrome.storage.local.set({ sections: cur });
        syncMaster();
      });
    });
    allInput.addEventListener('change', async () => {
      const cur = (await chrome.storage.local.get('sections')).sections || {};
      inputs.forEach((i) => { i.checked = allInput.checked; cur[i.dataset.section] = allInput.checked; });
      await chrome.storage.local.set({ sections: cur });
    });
    syncMaster();
  }

  if (window.top !== window) {
    document.documentElement.classList.add('embedded');
    $('min').hidden = false;
    $('min').addEventListener('click', () => window.parent.postMessage({ ja: 'minimize' }, '*'));
  }

  async function init() {
    const { profile, resume } = await chrome.storage.local.get(['profile', 'resume']);
    const box = $('profile');
    const b = (window.JA && window.JA.basics && window.JA.basics.values) || profile.basics || {};
    const name = [b.firstName, b.lastName].filter(Boolean).join(' ') || b.email;
    box.textContent = `${name} · ${resume ? 'resume attached (' + resume.name + ')' : 'no resume file attached'}`;
    $('upload').textContent = resume ? 'Replace resume' : 'Upload resume';
  }

  function render(res) {
    const out = $('result');
    out.textContent = '';
    if (!res) { out.appendChild(el('div', 'No response from the page.', 'err')); return; }
    if (res.error && !res.filled) { out.appendChild(el('div', res.error, 'err')); return; }
    if (!res.filled && !res.review) {
      out.appendChild(el('div', 'No matching form fields found on this page.', 'muted'));
      return;
    }

    out.appendChild(el('div', `Filled ${res.filled} field${res.filled === 1 ? '' : 's'}` +
      (res.skipped ? ` · ${res.skipped} already had a value` : ''), 'summary'));

    const attention = res.fields.filter((f) => f.status === 'review' || f.status === 'no-option' || f.status === 'error');
    if (attention.length) {
      out.appendChild(el('div', 'Check these yourself (outlined in orange on the page):'));
      const ul = el('ul');
      attention.forEach((f) => {
        const why = f.status === 'review' ? f.reason : f.status === 'no-option' ? 'no matching option' : 'error';
        ul.appendChild(el('li', `${f.label || 'Field'} — ${why}`, 'review'));
      });
      out.appendChild(ul);
    }

    const filled = res.fields.filter((f) => f.status === 'filled');
    if (filled.length) {
      const d = el('details');
      d.appendChild(el('summary', 'Fields filled'));
      const ul = el('ul');
      filled.forEach((f) => ul.appendChild(el('li', f.label || f.key)));
      d.appendChild(ul);
      out.appendChild(d);
    }
    out.appendChild(el('div', 'Review everything before you submit.', 'muted'));
  }

  $('fill').addEventListener('click', async () => {
    const btn = $('fill');
    btn.disabled = true;
    btn.textContent = 'Filling…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await chrome.runtime.sendMessage({
        type: 'JA_FILL_TAB',
        tabId: tab && tab.id,
        options: { overwrite: $('overwrite').checked },
      });
      render(res);
    } catch (e) {
      render({ error: String(e) });
    }
    btn.disabled = false;
    btn.textContent = 'Fill this page';
  });

  $('upload').addEventListener('click', () => $('resumeFile').click());
  $('resumeFile').addEventListener('change', async () => {
    const f = $('resumeFile').files[0];
    if (!f) return;
    const msg = $('uploadMsg');
    msg.className = 'muted';
    if (f.size > 4 * 1024 * 1024) { msg.textContent = 'Over 4 MB, pick a smaller file.'; return; }
    msg.textContent = 'Reading…';
    try {
      const U = window.JA.resumeUpload;
      const data = await U.readBase64(f);
      const read = await U.readResume(f);
      const parsed = read ? read.parsed : null;
      const skills = read ? read.skills : [];
      await chrome.storage.local.set({ resume: { name: f.name, type: f.type || 'application/pdf', size: f.size, data, parsed, skills } });
      $('resumeFile').value = '';
      msg.textContent = read
        ? 'Bullets read: ' + parsed.map((x) => `${x.company} ${x.count}`).join(', ') + '. Skills found: ' + skills.length
        : 'Attached (bullets and skills are read from PDFs only).';
      await init();
    } catch (e) {
      msg.className = 'err';
      msg.textContent = 'Could not save: ' + e;
    }
  });

  $('settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  initSections();
  init();
})();
