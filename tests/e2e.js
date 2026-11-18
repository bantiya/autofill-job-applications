// End-to-end test: loads the unpacked extension into a real Chromium, saves a profile and a
// resume, opens the test pages and checks what ended up in the fields.
//
// Run (needs Playwright):  node tests/e2e.js
//   e.g. NODE_PATH=$(npm root -g) node tests/e2e.js
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REAL = path.resolve(__dirname, '..');
// The answers are locked in src/answers.js (yours: mostly blank). To exercise the radio / dropdown / self-ID
// code the tests load a COPY of the extension whose answers.js holds test answers.
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'ja-ext-'));
fs.cpSync(REAL, EXT, { recursive: true, filter: (s) => !/[\\/](tests|\.git)([\\/]|$)/.test(s) });
// tests always run on the placeholder data, never on your real details
for (const n of ['basics', 'education', 'experience']) fs.copyFileSync(path.join(REAL, 'src', n + '.example.js'), path.join(EXT, 'src', n + '.js'));
fs.writeFileSync(path.join(EXT, 'src', 'answers.js'), `(function (root) {
  const JA = (root.JA = root.JA || {});
  JA.answers = { locked: true,
    application: { authorizedToWork: 'Yes', requiresSponsorship: 'No', willingToRelocate: 'Yes', over18: 'Yes', previouslyWorkedHere: '', noticePeriod: '', availableStartDate: '', salaryExpectation: '', referralSource: 'LinkedIn', yearsExperience: '' },
    eeo: { gender: 'Decline to self-identify', race: 'Decline to self-identify', hispanic: '', veteran: '', disability: '', lgbtq: '' } };
})(typeof self !== 'undefined' ? self : globalThis);
`);
const PAGES = path.join(__dirname, 'pages');
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;

const profile = JSON.parse(fs.readFileSync(path.join(REAL, 'sample-profile.json'), 'utf8'));
const resume = {
  name: 'Alex_Example_Resume.pdf',
  type: 'application/pdf',
  size: 32,
  data: Buffer.from('%PDF-1.4\n%fake resume for tests\n').toString('base64'),
  // what the settings page stores after reading the PDF's bullets (see the options test for the real thing)
  parsed: [
    { company: 'Example Corp', description: '• Built the first thing\n• Built the second thing', count: 2 },
    { company: 'Sample Inc', description: '• Did the older thing', count: 1 },
  ],
};

let failed = 0;
let passed = 0;
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got:      ${JSON.stringify(actual)}\n        expected: ${typeof expected === 'function' ? '(predicate)' : JSON.stringify(expected)}`}`);
}

const server = http.createServer((req, res) => {
  const file = path.join(PAGES, req.url.split('?')[0].replace(/^\//, '').replace(/\/$/, '/index.html') || 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buf);
  });
});

async function main() {
  await new Promise((r) => server.listen(PORT, r));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ja-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sw.evaluate((s) => chrome.storage.local.set(s), { profile, resume });

  const fill = async (page, options) => {
    await page.bringToFront();
    return sw.evaluate(async (opts) => {
      const [tab] = await chrome.tabs.query({ active: true });
      return fillAllFrames(tab.id, opts);
    }, options || {});
  };
  const open = async (file) => {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/${file}`, { waitUntil: 'load' });
    await p.waitForTimeout(700); // let document_idle content scripts attach
    return p;
  };
  const noisy = (res) => res.fields.filter((f) => f.status !== 'filled').map((f) => `${f.status}:${f.label}`).join(' | ');

  // ---------------------------------------------------------------- Lever-style page
  {
    console.log('\n== lever-like page ==');
    const p = await open('lever-like.html');
    const res = await fill(p);
    const v = (sel) => p.$eval(sel, (e) => e.value);
    check('full name', await v('#name'), 'Alex Example');
    check('email', await v('#email'), 'alex.example@example.com');
    check('phone', await v('#phone'), '555-010-0100');
    check('current company from most recent job', await v('#org'), 'Example Corp');
    check('linkedin', await v('#li'), 'https://www.linkedin.com/in/alex-example');
    check('github', await v('#gh'), 'https://github.com/alex-example');
    check('portfolio', await v('#pf'), 'https://alex-example.github.io/portfolio');
    check('location chosen from suggestion', await p.evaluate(() => window.__locChosen), 'Springfield, IL, USA');
    check('location value', await v('#location-input'), 'Springfield, IL, USA');
    check('work auth radio = Yes', await p.$eval('input[name="cards[a][field0]"]:checked', (e) => e.value), 'Yes');
    check('sponsorship radio = No', await p.$eval('input[name="cards[b][field0]"]:checked', (e) => e.value), 'No');
    check('EEO gender decline', await v('#gender'), 'Decline to self-identify');
    check('EEO race decline', await v('#race'), 'Decline to self-identify');
    check('resume attached', await p.$eval('#resume-upload-input', (e) => e.files.length ? e.files[0].name : ''), 'Alex_Example_Resume.pdf');
    check('free-text question left empty', await p.$eval('textarea[name="cards[c][field0]"]', (e) => e.value), '');
    check('unmatched textarea (comments) left empty', await v('#comments'), '');
    check('consent checkbox NOT ticked', await p.$eval('#consent', (e) => e.checked), false);
    check('required-but-empty fields flagged', await p.$$eval('[data-ja-flag]', (n) => n.length), 2);
    check('form NOT submitted', await p.evaluate(() => window.__submitted), false);
    check('result reports review count', res.review, 2);
    if (failed) console.log('   non-filled:', noisy(res));
    await p.close();
  }

  // ---------------------------------------------------------------- section toggles
  {
    console.log('\n== section toggles ==');
    const p = await open('lever-like.html');
    await sw.evaluate(() => chrome.storage.local.set({ sections: { basics: false, resume: false, eeo: false, application: false } }));
    const res = await fill(p);
    const v = (sel) => p.$eval(sel, (e) => e.value);
    check('basics off: name left empty', await v('#name'), '');
    check('basics off: email left empty', await v('#email'), '');
    check('resume off: nothing attached', await p.$eval('#resume-upload-input', (e) => e.files.length), 0);
    check('eeo off: gender left empty', await v('#gender'), (x) => x !== 'Decline to self-identify');
    check('application off: work auth radio untouched', await p.$$eval('input[name="cards[a][field0]"]:checked', (n) => n.length), 0);
    check('nothing from switched-off sections is reported filled', res.fields.filter((f) => /^(basics|eeo|application|file)\./.test(f.key || '') && f.status === 'filled').length, 0);
    await sw.evaluate(() => chrome.storage.local.remove('sections'));
    await p.close();

    const g = await open('greenhouse-like.html');
    await sw.evaluate(() => chrome.storage.local.set({ sections: { experience: false, education: false } }));
    await fill(g);
    check('experience off: no employer typed', await g.$$eval('input', (n) => n.some((e) => /Example Corp/.test(e.value))), false);
    check('experience off: no school chosen', await g.$$eval('select', (n) => n.some((e) => /Sample Tech|Placeholder|Unlisted/.test(e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''))), false);
    check('basics still on: email filled', await g.$eval('#email', (e) => e.value), 'alex.example@example.com');
    await sw.evaluate(() => chrome.storage.local.remove('sections'));
    await g.close();
    const g2 = await open('greenhouse-like.html');
    await fill(g2);
    check('all on again: employer typed', await g2.$$eval('input', (n) => n.some((e) => /Example Corp/.test(e.value))), true);
    await g2.close();

    // The panel offers one switch per section and remembers them.
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${(await sw.evaluate(() => chrome.runtime.id))}/popup.html`);
    await pop.waitForSelector('#sections input', { state: 'attached' });
    check('popup lists 8 sections, all on by default', await pop.$$eval('#sections input', (n) => n.map((i) => i.checked)), Array(8).fill(true));
    await pop.locator('#sections input[data-section="experience"]').evaluate((e) => e.click());
    await pop.waitForTimeout(200);
    check('switching off is stored', (await sw.evaluate(() => chrome.storage.local.get('sections'))).sections, { experience: false });
    await sw.evaluate(() => chrome.storage.local.remove('sections'));
    await pop.reload();
    await pop.waitForSelector('#allSwitch input', { state: 'attached' });
    check('master switch is on when every section is on', await pop.$eval('#allSwitch input', (i) => i.checked), true);
    await pop.locator('#allSwitch input').evaluate((e) => e.click());
    await pop.waitForTimeout(200);
    check('master off switches every section off', await pop.$$eval('#sections input', (n) => n.map((i) => i.checked)), Array(8).fill(false));
    check('master off is stored for every section', Object.values((await sw.evaluate(() => chrome.storage.local.get('sections'))).sections), Array(8).fill(false));
    await pop.locator('#sections input[data-section="skills"]').evaluate((e) => e.click());
    await pop.locator('#sections input[data-section="education"]').evaluate((e) => e.click());
    await pop.waitForTimeout(200);
    check('then single sections can be turned on', (await sw.evaluate(() => chrome.storage.local.get('sections'))).sections, (x) => JSON.stringify(Object.entries(x).filter(([, v]) => v).map(([k]) => k).sort()) === '["education","skills"]' && Object.keys(x).length === 8);
    check('master stays off while some are off', await pop.$eval('#allSwitch input', (i) => i.checked), false);
    await pop.locator('#allSwitch input').evaluate((e) => e.click());
    await pop.waitForTimeout(200);
    check('master on switches every section on', await pop.$$eval('#sections input', (n) => n.map((i) => i.checked)), Array(8).fill(true));
    await sw.evaluate(() => chrome.storage.local.remove('sections'));
    await pop.close();
  }

  // ---------------------------------------------------------------- React-style controlled inputs
  {
    console.log('\n== controlled inputs (React value tracking) ==');
    const p = await open('react-form.html');
    await fill(p);
    const state = await p.evaluate(() => window.__state);
    check('app state received first name', state.first_name, 'Alex');
    check('app state received last name', state.last_name, 'Example');
    check('app state received email', state.email, 'alex.example@example.com');
    check('app state received phone', state.phone, '555-010-0100');
    await p.close();
  }

  // ---------------------------------------------------------------- Greenhouse-style page
  {
    console.log('\n== greenhouse-like page ==');
    let p = await open('greenhouse-like.html');
    const res = await fill(p);
    const dump = await p.evaluate(() => {
      const fieldVals = (root) => Array.from(root.querySelectorAll('.field')).map((f) => {
        const lab = f.querySelector('label');
        const sv = f.querySelector('.select__single-value');
        const inp = f.querySelector('input:not(.select__input), textarea');
        return [lab ? lab.textContent : '', sv ? sv.textContent : inp ? inp.value : ''];
      });
      const dates = (root) => Array.from(root.querySelectorAll('fieldset')).map((fs) => [
        fs.querySelector('legend').textContent,
        fs.querySelector('select').selectedOptions[0].textContent,
        fs.querySelector('input').value,
      ]);
      const sections = {};
      document.querySelectorAll('section').forEach((s) => {
        const title = s.querySelector('h3').textContent;
        const blocks = Array.from(s.querySelectorAll('.block'));
        sections[title] = blocks.length
          ? blocks.map((b) => ({ fields: fieldVals(b), dates: dates(b), current: (b.querySelector('input[type=checkbox]') || {}).checked }))
          : fieldVals(s);
      });
      return {
        sections,
        basics: ['first_name', 'last_name', 'email', 'phone', 'country', 'linkedin', 'website'].map((id) => document.getElementById(id).value),
        resume: document.getElementById('resume').files.length,
        consent: document.getElementById('consent').checked,
        why: document.getElementById('why').value,
        submitted: window.__submitted,
        flagged: document.querySelectorAll('[data-ja-flag]').length,
      };
    });
    check('basics incl. native country select + links',
      dump.basics, ['Alex', 'Example', 'alex.example@example.com', '555-010-0100', 'United States',
        'https://www.linkedin.com/in/alex-example', 'https://alex-example.github.io/portfolio']);
    check('hidden resume input received the file', dump.resume, 1);

    // Education is locked (src/education.js): three entries, whatever the saved profile holds. This page
    // offers "Master's Degree" / "Bachelor's Degree" and "Computer Science" / "Information Technology",
    // so the ordered fallback lists have to find those. "Unlisted State University" is not in its school list.
    const edu = dump.sections.Education;
    check('Education: "Add another" produced 3 blocks (the locked list)', edu.length, 3);
    check('Education #1: unknown school left empty, degree and field via the fallback lists', edu[0].fields, [['School*', ''], ['Degree*', "Master's Degree"], ['Discipline*', 'Computer Science']]);
    check('Education #1 dates (month select + year input; still studying, no end date)', edu[0].dates, [['Start date*', 'July', '2026'], ['End date*', 'Month', '']]);
    check('Education #2 combos', edu[1].fields, [['School*', 'Sample Tech Institute'], ['Degree*', "Master's Degree"], ['Discipline*', 'Computer Science']]);
    check('Education #2 dates', edu[1].dates, [['Start date*', 'August', '2021'], ['End date*', 'May', '2023']]);
    check('Education #3 combos (Bachelor of Engineering is not offered, Bachelor\'s Degree is)', edu[2].fields, [['School*', 'Placeholder College'], ['Degree*', "Bachelor's Degree"], ['Discipline*', 'Information Technology']]);
    check('Education #3 dates', edu[2].dates, [['Start date*', 'June', '2017'], ['End date*', 'June', '2021']]);

    const emp = dump.sections.Employment;
    check('Employment: "Add another" produced 2 blocks', emp.length, 2);
    // Work experience is locked (src/experience.js). The description comes from the uploaded resume's bullets.
    const D1 = '• Built the first thing\n• Built the second thing';
    const D2 = '• Did the older thing';
    check('Employment #1 text + description from the resume', emp[0].fields, [['Company name*', 'Example Corp'], ['Job title*', 'Software Developer'], ['Role description', D1]]);
    check('Employment #1 dates', emp[0].dates, [['Start date*', 'January', '2024'], ['End date', 'September', '2026']]);
    check('Employment #1 "Current role" not ticked', emp[0].current, false);
    check('Employment #2 text + description', emp[1].fields, [['Company name*', 'Sample Inc'], ['Job title*', 'Software Engineer'], ['Role description', D2]]);
    check('Employment #2 dates', emp[1].dates, [['Start date*', 'January', '2020'], ['End date', 'July', '2021']]);
    check('Employment #2 "Current role" not ticked', emp[1].current, false);

    const q = Object.fromEntries(dump.sections['Additional questions']);
    check('work authorization combo', q['Are you legally authorized to work in the United States?*'], 'Yes');
    check('sponsorship combo', q['Will you now or in the future require sponsorship for employment visa status?*'], 'No');
    check('referral source combo', q['How did you hear about this job?'], 'LinkedIn');
    check('gender combo (case-insensitive decline match)', q.Gender, 'Decline To Self Identify');
    check('typeahead location', q['Location (City)*'], 'Springfield, IL, United States');
    check('free-text address question mentioning "relocate" gets no Yes/No answer',
      q['What is the address from which you plan on working? If you would need to relocate, please tell us where.'], '');
    check('free-text question left empty', dump.why, '');
    check('consent NOT ticked', dump.consent, false);
    check('form NOT submitted', dump.submitted, false);
    // free-text question + consent (2) and the unknown school (1). The end date of the course that is still
    // running is empty on purpose and this page does not mark it required. Hidden required shims are not counted.
    check('flagged: free-text, consent, unknown school (hidden required shims ignored)', dump.flagged, 3);

    // Second run must not add blocks or break anything.
    await fill(p);
    const again = await p.evaluate(() => [document.querySelectorAll('#app-root section')[0].querySelectorAll('.block').length,
      document.querySelectorAll('#app-root section')[1].querySelectorAll('.block').length]);
    check('re-running does not add extra blocks', again, [3, 2]);
    // Without a parsed resume the descriptions stay empty (nothing is made up), and a stored experience list is ignored.
    await p.close();
    await sw.evaluate((s) => chrome.storage.local.set(s), { resume: { ...resume, parsed: null }, profile: { ...profile, experience: [{ title: 'Hacker', company: 'Evil Corp', description: 'x' }] } });
    const p2 = await open('greenhouse-like.html');
    await fill(p2);
    check('no parsed resume: descriptions empty, stored jobs ignored', await p2.$$eval('#app-root section:nth-of-type(2) .block', (bs) => bs.map((b) => [...b.querySelectorAll('input[type=text]')][0].value + '|' + b.querySelector('textarea').value)), ['Example Corp|', 'Sample Inc|']);
    await sw.evaluate((s) => chrome.storage.local.set(s), { resume, profile });
    p = p2;
    if (failed) console.log('   non-filled:', noisy(res));
    await p.close();
  }

  // ---------------------------------------------------------------- stale open menu
  {
    console.log('\n== a menu left open by an unmatched field must not leak into the next field ==');
    // The first school (Unlisted State University) is not in the page's option list, so the School combobox
    // finds nothing and (like some widgets) its menu stays open. Later fields must not pick options from it.
    const p = await open('greenhouse-like.html');
    await fill(p);
    const vals = await p.$$eval('.field', (fs) => fs.map((f) => [
      f.querySelector('label').textContent,
      (f.querySelector('.select__single-value') || {}).textContent || '',
    ]));
    check('unknown school stays empty', vals.filter(([l]) => /^School/.test(l)).map(([, v]) => v)[0], '');
    check('no combobox received a school name by mistake', vals.filter(([l, v]) => !/^School/.test(l) && /University/.test(v)), []);
    check('city typeahead still filled correctly', Object.fromEntries(vals)['Location (City)*'], 'Springfield, IL, United States');
    await p.close();
  }

  // ---------------------------------------------------------------- Workday skills picker
  {
    console.log('\n== Workday skills picker (search, Enter, tick the checkbox) ==');
    const alt = JSON.parse(JSON.stringify(profile));
    alt.skills = ['Java', 'JavaScript', 'Python', 'React', 'ReactJS', 'AWS', 'Node.js', 'Apache Kafka', 'Rancher', 'C#', 'Go', 'Agile/Scrum', 'Terraform'];
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile: alt });
    const wanted = ['Python', 'Java', 'JavaScript', 'React', 'Amazon Web Services', 'Node.js', 'Apache Kafka', 'C#', 'Go'];
    for (const [variant, file] of [['Enter-only search', 'workday-like.html'], ['search-as-you-type', 'workday-like.html?live=1'], ['row click, no checkbox', 'workday-like.html?rowclick=1']]) {
      const p = await open(file);
      const res = await fill(p);
      const pills = await p.$$eval('#pills [data-automation-id="selectedItem"] span', (n) => n.map((x) => x.textContent));
      check(`[${variant}] skills selected, exact names only`, pills, wanted);
      check(`[${variant}] no near-miss picked (React VR / AWS Tools / JavaScript for Java)`, pills.filter((x) => /React VR|AWS Tools|Building Codes|Programming Language/.test(x)), []);
      check(`[${variant}] other picker's LinkedIn pill untouched`, await p.$$eval('[data-automation-id="formField-source"] [data-automation-id="selectedItem"] span', (n) => n.map((x) => x.textContent)), ['LinkedIn']);
      check(`[${variant}] skills box left empty`, await p.$eval('#skills-input', (e) => e.value), '');
      const typed = await p.evaluate(() => window.__typed);
      check(`[${variant}] never typed the whole skills list into the box`, typed.filter((t) => /,/.test(t)), []);
      check(`[${variant}] generic fields still filled`, await p.$$eval('#fn, #ln, #em', (n) => n.map((x) => x.value)), ['Alex', 'Example', 'alex.example@example.com']);
      const labels = res.fields.map((f) => f.label);
      check(`[${variant}] summary of added skills`, labels.find((l) => /^Skills:/.test(l)), 'Skills: 8 added, 2 already there');
      check(`[${variant}] lists skills the site did not offer`, labels.find((l) => /did not offer/.test(l)), 'Skills this site did not offer: Rancher, Agile, Scrum, Terraform');
      if (variant === 'Enter-only search') {
        // already-selected skills are skipped without searching for them again
        const searches = await p.evaluate(() => window.__searches);
        check('already-selected skills are not searched again', searches.filter((q) => /^(Python|ReactJS)$/.test(q)), []);
      }
      await p.close();
    }
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile });
  }

  // ---------------------------------------------------------------- Workday education
  {
    console.log('\n== Workday education: Degree button + Field of Study picker, ordered name lists ==');
    // The stored profile carries different education on purpose: the locked list must win.
    const stale = JSON.parse(JSON.stringify(profile));
    stale.education = [{ school: 'Hacked University', degree: 'PhD', field: 'Basket Weaving' }];
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile: stale });

    const read = (p) => p.evaluate(() => ({
      schools: [...document.querySelectorAll('[data-automation-id=school]')].map((e) => e.value),
      degrees: [...document.querySelectorAll('button[aria-haspopup]')].map((e) => e.textContent),
      pills: [...document.querySelectorAll('[data-automation-id^="education-"]')].map((b) => [...b.querySelectorAll('[data-automation-id=selectedItem] span')].map((x) => x.textContent)),
      boxes: [...document.querySelectorAll('[data-automation-id=searchBox]')].map((e) => e.value),
      searches: window.__searches,
      typed: window.__typedWithoutEnter.filter(Boolean),
      flagged: document.querySelectorAll('[data-ja-flag]').length,
      popupOpen: !!document.querySelector('[data-automation-activepopup="true"]'),
    }));
    const edu = (res) => res.fields.filter((f) => /^(Degree|Field of Study) \(Education/.test(f.label));
    const MASTERS_ADV = "Master's/Advanced Degree";
    const CIS = 'Computer and Information Science';

    // 1. what your Workday page offers (your screenshots)
    for (const [variant, file] of [['default', 'workday-education.html'], ['rows with a checkbox', 'workday-education.html?checkbox=1'], ['slow search results', 'workday-education.html?slow=1']]) {
      const p = await open(file);
      const res = await fill(p);
      const r = await read(p);
      check(`[${variant}] schools come from the locked list, not the stored profile`, r.schools, ['Unlisted State University', 'Sample Tech Institute', 'Placeholder College']);
      check(`[${variant}] Degree: saved name not offered, fallback chosen`, r.degrees, [MASTERS_ADV, MASTERS_ADV, "Bachelor's Degree"]);
      check(`[${variant}] Field of Study pills`, r.pills, [[CIS], [CIS], ['Information Technology']]);
      check(`[${variant}] no near miss (Computer Engineering / Networking / Information Science)`, r.pills.flat().filter((x) => /Engineering|Networking|^Information Science$/.test(x)), []);
      check(`[${variant}] search boxes left empty, list closed`, [r.boxes, r.popupOpen], [['', '', ''], false]);
      check(`[${variant}] everything typed was submitted with Enter (typed text alone would be thrown away)`, r.typed, r.searches);
      check(`[${variant}] nothing flagged`, [r.flagged, res.fields.filter((f) => f.status === 'review')], [0, []]);
      if (variant === 'default') {
        check('popup list names what was chosen', edu(res).map((f) => f.label), [
          `Degree (Education 1): ${MASTERS_ADV}`, `Field of Study (Education 1): ${CIS}`,
          `Degree (Education 2): ${MASTERS_ADV}`, `Field of Study (Education 2): ${CIS}`,
          "Degree (Education 3): Bachelor's Degree", 'Field of Study (Education 3): Information Technology']);
        check('degree list is opened with a click, never typed into', r.typed.filter((t) => /Master|Bachelor/.test(t)), []);
      }
      await p.close();
    }

    // 2. the saved name wins when the page offers it (list order, not page order)
    {
      const p = await open('workday-education.html?degrees=exact&fields=exact');
      await fill(p);
      const r = await read(p);
      check('saved degree names win when offered (even though "Master\'s/Advanced Degree" comes first on the page)', r.degrees, ['Master of Science', 'Master of Science', 'Bachelor of Engineering']);
      check('saved field wins when offered; otherwise the next name on the list', r.pills, [['Computer Information Systems'], ['Computer Science'], ['Information Technology']]);
      await p.close();
    }

    // 3. "(MS)" style suffixes and stem fallback
    {
      const p = await open('workday-education.html?degrees=paren');
      await fill(p);
      check('"Master of Science (MS)" matches the saved "Master of Science"', (await read(p)).degrees, ['Master of Science (MS)', 'Master of Science (MS)', 'Bachelor of Engineering (BE)']);
      await p.close();
    }
    {
      const p = await open('workday-education.html?degrees=stem');
      await fill(p);
      check('a word (master / bachelor) is accepted when exactly one option has it', (await read(p)).degrees, ['Graduate Master Programme', 'Graduate Master Programme', 'Undergraduate Bachelor Programme']);
      await p.close();
    }
    {
      const p = await open('workday-education.html?degrees=twomasters');
      const res = await fill(p);
      const r = await read(p);
      check('two Master options and none on the list: nothing guessed', r.degrees.slice(0, 2), ['Select One', 'Select One']);
      const bad = res.fields.filter((f) => f.status === 'review' && /^Degree/.test(f.label));
      check('the unfilled degrees are reported with what the page offers', bad.map((f) => f.label), ['Degree (Education 1)', 'Degree (Education 2)']);
      check('report lists the offered options', bad[0].reason, (t) => /Master of Arts \| Master of Business Administration/.test(t) && /Master of Science/.test(t));
      await p.close();
    }

    // 4. nothing on the list is offered: leave empty, flag, say what the page offered, leave no typed text
    {
      const p = await open('workday-education.html?degrees=none&fields=none');
      const res = await fill(p);
      const r = await read(p);
      check('nothing offered: degrees left alone', r.degrees, ['Select One', 'Select One', 'Select One']);
      check('nothing offered: no pills, no stray typed text', [r.pills, r.boxes], [[[], [], []], ['', '', '']]);
      const review = res.fields.filter((f) => f.status === 'review').map((f) => f.label);
      check('all six boxes reported to the user', review, ['Degree (Education 1)', 'Field of Study (Education 1)', 'Degree (Education 2)', 'Field of Study (Education 2)', 'Degree (Education 3)', 'Field of Study (Education 3)']);
      check('report for Degree names the offered options', res.fields.find((f) => f.label === 'Degree (Education 3)').reason, (t) => /Certificate \| Diploma \| High School/.test(t));
      check('the six boxes are outlined on the page', r.flagged, 6);
      await p.close();
    }

    // 5. an existing choice is kept, and replaced when Overwrite is ticked
    {
      const p = await open('workday-education.html');
      await p.evaluate(() => { document.getElementById('education-1--degree').textContent = 'Doctorate'; });
      await fill(p);
      check('existing Degree choice kept', (await read(p)).degrees, ['Doctorate', MASTERS_ADV, "Bachelor's Degree"]);
      await fill(p, { overwrite: true });
      check('Overwrite replaces it', (await read(p)).degrees, [MASTERS_ADV, MASTERS_ADV, "Bachelor's Degree"]);
      check('running again does not add a second pill', (await read(p)).pills, [[CIS], [CIS], ['Information Technology']]);
      await p.close();
    }
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile });
  }

  // ---------------------------------------------------------------- websites
  {
    console.log('\n== websites: LinkedIn, GitHub and portfolio ==');
    for (const [variant, file, expected] of [
      ['own LinkedIn box + URL list', 'workday-websites.html', { li: 'https://www.linkedin.com/in/alex-example', urls: ['https://alex-example.github.io/portfolio', 'https://github.com/alex-example'] }],
      ['URL list only', 'workday-websites.html?nolinkedin=1', { li: null, urls: ['https://alex-example.github.io/portfolio', 'https://github.com/alex-example', 'https://www.linkedin.com/in/alex-example'] }],
    ]) {
      const p = await open(file);
      await fill(p);
      const r = await p.evaluate(() => ({
        li: document.getElementById('li') ? document.getElementById('li').value : null,
        urls: [...document.querySelectorAll('[data-automation-id=url]')].map((e) => e.value),
        eduAdds: window.__eduAdds,
      }));
      check(`[${variant}] LinkedIn box`, r.li, expected.li);
      check(`[${variant}] one URL box per remaining link, boxes added with "Add"`, r.urls, expected.urls);
      check(`[${variant}] never clicked the education "Add Another"`, r.eduAdds, 0);
      await fill(p);
      check(`[${variant}] running again adds no extra boxes`, await p.$$eval('[data-automation-id=url]', (n) => n.length), expected.urls.length);
      await p.close();
    }
  }

  // ---------------------------------------------------------------- Workday split date boxes
  {
    console.log('\n== Workday month / year date boxes (invisible inputs, year fills itself) ==');
    const alt = JSON.parse(JSON.stringify(profile));
    // The first locked job (src/experience.js) is Jan 2024 - Sep 2026, not current: exactly what is checked below.
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile: alt });
    const pre = 'workExperience-1--';
    for (const [variant, file] of [['normal speed', 'workday-dates.html'], ['slow page that drops quick edits', 'workday-dates.html?slow=1']]) {
      const p = await open(file);
      const res = await fill(p);
      const v = (which, part) => p.$eval(`#${pre}${which}-dateSection${part}-input`, (e) => e.value);
      check(`[${variant}] start month`, Number(await v('startDate', 'Month')), 1);
      check(`[${variant}] start year is 2024 (not 2001 = "20" + month)`, await v('startDate', 'Year'), '2024');
      check(`[${variant}] end month`, Number(await v('endDate', 'Month')), 9);
      check(`[${variant}] end year is 2026 (not 2009)`, await v('endDate', 'Year'), '2026');
      check(`[${variant}] what the page displays`, await p.$$eval('[data-automation-id$="-display"]', (n) => n.map((x) => x.textContent)), ['01', '2024', '09', '2026']);
      check(`[${variant}] title and company filled`, await p.$$eval('#jt, #co', (n) => n.map((x) => x.value)), ['Software Developer', 'Example Corp']);
      check(`[${variant}] nothing flagged for dates`, res.fields.filter((f) => f.status === 'review' && /From|To|month|year|date/i.test(`${f.label} ${f.reason || ''}`)), []);
      await p.close();
    }
    // A date the user already typed in must stay untouched.
    {
      const p = await open('workday-dates.html');
      await p.evaluate(() => {
        const y = document.getElementById('workExperience-1--startDate-dateSectionYear-input');
        const m = document.getElementById('workExperience-1--startDate-dateSectionMonth-input');
        m.value = '5'; y.value = '1999';
        state.startDate = { m: '5', y: '1999' }; __render();
      });
      await p.waitForTimeout(100);
      await fill(p);
      check('existing start date left alone', [Number(await p.$eval('#workExperience-1--startDate-dateSectionMonth-input', (e) => e.value)), await p.$eval('#workExperience-1--startDate-dateSectionYear-input', (e) => e.value)], [5, '1999']);
      check('empty end date still filled', await p.$eval('#workExperience-1--endDate-dateSectionYear-input', (e) => e.value), '2026');
      await p.close();
    }
    // A box the page refuses to keep must be reported, never silently left wrong.
    {
      const p = await open('workday-dates.html');
      await p.evaluate(() => {
        const original = clean;
        clean = (part, v) => (part === 'm' ? '' : original(part, v)); // the page throws every month away
      });
      const res = await fill(p);
      const flagged = res.fields.filter((f) => f.status === 'review').map((f) => f.label + ' | ' + f.reason);
      check('unwritable date box is reported to the user', flagged.some((t) => /month/.test(t) && /enter it yourself/.test(t)), true);
      await p.close();
    }
    await sw.evaluate((s) => chrome.storage.local.set(s), { profile });
  }

  // ---------------------------------------------------------------- overwrite semantics
  {
    console.log('\n== existing values ==');
    const p = await open('lever-like.html');
    await p.fill('#name', 'Someone Else');
    await fill(p);
    check('existing value kept by default', await p.$eval('#name', (e) => e.value), 'Someone Else');
    await fill(p, { overwrite: true });
    check('overwrite option replaces it', await p.$eval('#name', (e) => e.value), 'Alex Example');
    await p.close();
  }

  // ---------------------------------------------------------------- iframe + floating button
  {
    console.log('\n== embedded iframe + side panel ==');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/iframe-host.html`, { waitUntil: 'load' });
    await p.waitForSelector('#job-autofill-root', { state: 'attached', timeout: 8000 }).catch(() => {});
    check('side panel appears on the top page', await p.locator('#job-autofill-root iframe[src*="popup.html"]').count(), 1);
    check('page is pushed left while the panel is open', await p.evaluate(() => document.documentElement.style.width), 'calc(100% - 360px)');
    const panel = p.frameLocator('#job-autofill-root iframe[src*="popup.html"]');
    await panel.locator('#fill').waitFor({ state: 'visible', timeout: 8000 });
    check('panel shows the minimize button', await panel.locator('#min').isVisible(), true);
    check('panel shows the upload button', await panel.locator('#upload').isVisible(), true);
    await panel.locator('#fill').click();
    await panel.locator('#result .summary').waitFor({ timeout: 15000 }).catch(() => {});
    check('panel reports what was filled', await panel.locator('#result').textContent(), (t) => /Filled \d+ field/.test(t) && /Review everything/.test(t));
    // minimize / maximize
    await panel.locator('#min').click();
    await p.waitForFunction(() => document.documentElement.style.width === '', null, { timeout: 5000 }).catch(() => {});
    check('minimize gives the page its width back', await p.evaluate(() => document.documentElement.style.width), '');
    check('minimized: only the round button shows', await p.evaluate(() => {
      const s = document.getElementById('job-autofill-root').shadowRoot;
      return [getComputedStyle(s.getElementById('panel')).display, getComputedStyle(s.getElementById('launch')).display];
    }), ['none', 'flex']);
    check('minimized state is remembered', (await sw.evaluate(() => chrome.storage.local.get('panelOpen'))).panelOpen, false);
    await p.locator('#job-autofill-root #launch').click();
    check('maximize restores the panel and the page shift', await p.evaluate(() => [document.documentElement.style.width, getComputedStyle(document.getElementById('job-autofill-root').shadowRoot.getElementById('panel')).display]), ['calc(100% - 360px)', 'block']);
    const f = p.frameLocator('iframe[title="Application"]');
    check('iframe: email filled', await f.locator('#email').inputValue(), 'alex.example@example.com');
    check('iframe: radio chosen', await f.locator('input[name="cards[a][field0]"]:checked').getAttribute('value'), 'Yes');
    await p.close();
  }

  // A known application URL shows the panel even when the first step has almost no fields.
  {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/apply/`, { waitUntil: 'load' });
    await p.waitForSelector('#job-autofill-root', { state: 'attached', timeout: 8000 }).catch(() => {});
    check('panel shows on an /apply/ URL with almost no fields', await p.locator('#job-autofill-root iframe[src*="popup.html"]').count(), 1);
    await p.close();
    const q = await ctx.newPage();
    await q.goto(`${BASE}/lever-like.html`, { waitUntil: 'load' });
    await q.waitForTimeout(2500);
    check('panel also shows on a form-detected page', await q.evaluate(() => !!document.getElementById('job-autofill-root')), true);
    await q.close();
  }

  // ---------------------------------------------------------------- options page + popup
  {
    console.log('\n== options page and popup ==');
    const id = new URL(sw.url()).host;
    await sw.evaluate(() => chrome.storage.local.remove(['profile', 'resume']));
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`chrome-extension://${id}/options.html`);
    check('empty state: no resume yet', await p.textContent('#resumeInfo'), (t) => /No resume/.test(t));

    await p.click('#sampleBtn');
    await p.waitForFunction(() => document.getElementById('json').value.length > 0);
    check('sample JSON inserted', await p.inputValue('#json'), (t) => /"skills"/.test(t) && !/"experience"/.test(t));
    await p.click('#importBtn');
    const sec = (i) => p.$$eval('.locked-section', (n, k) => n[k].textContent, i);
    const inputs = (i) => p.$$eval('.locked-section', (n, k) => n[k].querySelectorAll('input, textarea, select, button').length, i);
    check('five locked sections: basics, experience, education, answers, self-identification', await p.$$eval('.locked-section h2', (n) => n.map((h) => /locked/.test(h.textContent))), [true, true, true, true, true]);
    check('nothing in any locked section can be edited', [await inputs(0), await inputs(1), await inputs(2), await inputs(3), await inputs(4)], [0, 0, 0, 0, 0]);
    check('experience shows the two locked jobs', await sec(1), (x) => /Software Developer — Example Corp/.test(x) && /Springfield, IL/.test(x) && /Software Engineer — Sample Inc/.test(x) && /2020-01 → 2021-07/.test(x));
    check('experience description waits for a resume', await sec(1), (x) => /once you upload it/.test(x));
    check('education shows 3 locked entries', await p.$$eval('.locked-section:nth-of-type(3) .card.locked', (n) => n.length), 3);
    check('education shows the ordered name lists', await sec(2),
      (t) => /Master of Science\s*›\s*Master's\/Advanced Degree/.test(t) && /Computer and Information Science/.test(t) && /Bachelor of Engineering\s*›\s*Bachelor's Degree/.test(t));
    check('basic details show the locked values', await sec(0), (x) => /Alex/.test(x) && /alex-example\.github\.io\/portfolio/.test(x) && /github\.com\/alex-example/.test(x));
    check('locked answers are listed', await sec(4), (x) => /Gender/.test(x) && /skipped/.test(x));
    check('only skills and cover letter are editable', await p.$$eval('#form [data-path]', (n) => n.map((e) => e.dataset.path)), ['skillsText', 'coverLetter']);
    check('skills loaded', await p.inputValue('[data-path="skillsText"]'), 'Java, Python, SQL, Spring Boot, AWS, Docker');
    await p.fill('[data-path="skillsText"]', 'Java, Python');

    // A real PDF: the bullets under each locked company are read out of it.
    await p.setInputFiles('#resumeFile', path.join(__dirname, 'fixtures', 'resume-sample.pdf'));
    await p.waitForFunction(() => /Bullet points read/.test(document.getElementById('resumeInfo').textContent), null, { timeout: 20000 });
    check('resume upload shown with bullet counts', await p.textContent('#resumeInfo'), (t) => /resume-sample\.pdf/.test(t) && /Example Corp 3, Sample Inc 2/.test(t));
    check('experience cards now show the bullets', await sec(1), (x) => /• Built sample marketplace APIs for item onboarding and feed ingestion, supporting many feed types with throttling and Kafka distribution across two regions\./.test(x) && /• Containerized and deployed services using Docker and Kubernetes\./.test(x) && !/NOT be picked up/.test(x));

    await p.click('#save');
    await p.waitForFunction(() => /Saved/.test(document.getElementById('saveMsg').textContent));
    const stored = await sw.evaluate(() => chrome.storage.local.get(['profile', 'resume']));
    check('saved profile keeps skills only', [Object.keys(stored.profile).sort(), stored.profile.skills], [['coverLetter', 'skills'], ['Java', 'Python']]);
    check('saved resume has data and the parsed bullets', [!!stored.resume && stored.resume.data.length > 0, stored.resume.parsed.map((x) => [x.company, x.count])], [true, [['Example Corp', 3], ['Sample Inc', 2]]]);

    // Education in imported JSON is ignored, loudly.
    await p.fill('#json', JSON.stringify({ basics: { firstName: 'Zed' }, skills: ['Java', 'Python'], education: [{ school: 'Hacked University', degree: 'PhD' }] }));
    await p.click('#importBtn');
    check('import says education / basics were ignored', await p.textContent('#importMsg'), (t) => /locked/.test(t));
    check('imported education and basics are not shown', await p.textContent('#form'), (t) => !/Hacked University/.test(t) && !/Zed/.test(t));
    await p.click('#save');
    await p.waitForFunction(() => /Saved/.test(document.getElementById('saveMsg').textContent));
    const stored2 = await sw.evaluate(() => chrome.storage.local.get('profile'));
    check('imported education / basics were not saved', Object.keys(stored2.profile).sort(), ['coverLetter', 'skills']);

    await p.fill('#json', '{ not json');
    await p.click('#importBtn');
    check('bad JSON reports an error', await p.textContent('#importMsg'), (t) => /Invalid JSON/.test(t));
    check('options page had no script errors', errors, []);
    await p.close();

    const pop = await ctx.newPage();
    const popErrors = [];
    pop.on('pageerror', (e) => popErrors.push(String(e)));
    await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.waitForFunction(() => !/Loading/.test(document.getElementById('profile').textContent));
    check('popup shows profile + resume', await pop.textContent('#profile'), (t) => /Alex Example/.test(t) && /resume attached/.test(t));
    check('popup Fill button enabled', await pop.isEnabled('#fill'), true);
    check('popup offers to replace the attached resume', await pop.textContent('#upload'), 'Replace resume');
    await sw.evaluate(() => chrome.storage.local.remove('resume'));
    await pop.reload();
    await pop.waitForFunction(() => !/Loading/.test(document.getElementById('profile').textContent));
    check('popup without resume offers Upload resume', await pop.textContent('#upload'), 'Upload resume');
    await pop.setInputFiles('#resumeFile', path.join(__dirname, 'fixtures', 'resume-sample.pdf'));
    await pop.waitForFunction(() => /Bullets read/.test(document.getElementById('uploadMsg').textContent), null, { timeout: 20000 });
    check('popup upload reports bullets per job', await pop.textContent('#uploadMsg'), (x) => /Example Corp 3, Sample Inc 2/.test(x));
    check('popup now shows the attached resume', await pop.textContent('#profile'), (x) => /resume-sample\.pdf/.test(x));
    const st3 = await sw.evaluate(() => chrome.storage.local.get('resume'));
    check('popup stored resume data + parsed bullets', [st3.resume.data.length > 0, st3.resume.parsed.map((x) => [x.company, x.count])], [true, [['Example Corp', 3], ['Sample Inc', 2]]]);
    check('popup had no script errors', popErrors, []);
    await pop.close();
  }

  await ctx.close();
}

main()
  .catch((e) => { console.error('E2E crashed:', e); failed++; })
  .finally(() => {
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
