// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const JA = require('../src/text.js');
const T = JA.text;

const opts = (...texts) => texts.map((t) => ({ text: t, value: t.toLowerCase().replace(/\W+/g, '_') }));

test('normalize splits camelCase and punctuation', () => {
  assert.strictEqual(T.normalize('firstName'), 'first name');
  assert.strictEqual(T.normalize('job_application[first_name]'), 'job application first name');
  assert.strictEqual(T.normalize("Bachelor's Degree"), 'bachelors degree');
  assert.strictEqual(T.normalize('E-mail *'), 'e mail');
});

test('state abbreviations match full names and back', () => {
  const o = opts('Select...', 'California', 'Texas', 'New York');
  assert.strictEqual(T.pickOption(o, 'TX'), 2);
  assert.strictEqual(T.pickOption(opts('CA', 'TX', 'NY'), 'Texas'), 1);
});

test('country synonyms', () => {
  const o = opts('Canada', 'United States of America', 'India');
  assert.strictEqual(T.pickOption(o, 'United States'), 1);
  assert.strictEqual(T.pickOption(o, 'USA'), 1);
});

test('yes / no do not match longer words', () => {
  const o = opts('Not applicable', 'No', 'Yes');
  assert.strictEqual(T.pickOption(o, 'No'), 1);
  assert.strictEqual(T.pickOption(o, 'Yes'), 2);
  assert.strictEqual(T.pickOption(opts('Yes, I am authorized', 'No, I am not'), 'Yes'), 0);
  assert.strictEqual(T.pickOption(opts('Yes, I am authorized', 'No, I am not'), 'No'), 1);
});

test('degree synonyms', () => {
  const o = opts("Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate', 'High School');
  assert.strictEqual(T.pickOption(o, 'Master of Science'), 2);
  assert.strictEqual(T.pickOption(o, 'Bachelor of Technology'), 1);
  assert.strictEqual(T.pickOption(o, 'B.S.'), 1);
  assert.strictEqual(T.pickOption(o, 'PhD'), 3);
});

test('decline wording', () => {
  const o = opts('Male', 'Female', 'I do not wish to answer');
  assert.strictEqual(T.pickOption(o, 'Decline to self-identify'), 2);
  assert.strictEqual(T.pickOption(opts('Male', 'Female', 'Decline to self-identify'), 'Decline to self-identify'), 2);
});

test('gender wording', () => {
  assert.strictEqual(T.pickOption(opts('Man', 'Woman', 'Non-binary'), 'Female'), 1);
  assert.strictEqual(T.pickOption(opts('Male', 'Female'), 'Male'), 0);
});

test('no false match returns -1', () => {
  assert.strictEqual(T.pickOption(opts('Alpha', 'Beta'), 'Gamma'), -1);
  assert.strictEqual(T.pickOption(opts('Alpha', 'Beta'), ''), -1);
});

test('month candidates for selects', () => {
  const names = opts('Month', 'January', 'February', 'March');
  assert.strictEqual(T.pickOptionAny(names, T.monthCandidates(3)), 3);
  const nums = [{ text: '01', value: '1' }, { text: '02', value: '2' }];
  assert.strictEqual(T.pickOptionAny(nums, T.monthCandidates(2)), 1);
});

test('date parsing and formatting', () => {
  assert.deepStrictEqual(T.parseDate('2022-06'), { y: 2022, m: 6, d: 1 });
  assert.deepStrictEqual(T.parseDate('06/2022'), { y: 2022, m: 6, d: 1 });
  assert.deepStrictEqual(T.parseDate('Jun 2022'), { y: 2022, m: 6, d: 1 });
  assert.ok(T.parseDate('Present').present);
  assert.strictEqual(T.parseDate(''), null);
  const p = T.parseDate('2022-06');
  assert.strictEqual(T.formatDate(p, 'MM/YYYY'), '06/2022');
  assert.strictEqual(T.formatDate(p, 'YYYY-MM'), '2022-06');
  assert.strictEqual(T.formatDate(p, 'MM/DD/YYYY'), '06/01/2022');
  assert.strictEqual(T.formatDate(p, 'Mon YYYY'), 'Jun 2022');
  assert.strictEqual(T.formatDate(p, 'YYYY'), '2022');
});

test('date style from hints', () => {
  assert.strictEqual(T.dateStyleFrom('month', ''), 'YYYY-MM');
  assert.strictEqual(T.dateStyleFrom('date', ''), 'YYYY-MM-DD');
  assert.strictEqual(T.dateStyleFrom('text', 'MM/DD/YYYY'), 'MM/DD/YYYY');
  assert.strictEqual(T.dateStyleFrom('text', 'Start date (MM/YYYY)'), 'MM/YYYY');
  assert.strictEqual(T.dateStyleFrom('text', 'YYYY'), 'YYYY');
  assert.strictEqual(T.dateStyleFrom('text', ''), 'MM/YYYY');
});

// ---- ordered name lists (Degree / Field of Study) ----------------------------------------
test('pickFromList takes the first name on the list that the page offers', () => {
  const offered = opts('Select One', 'High School', "Bachelor's Degree", "Master's/Advanced Degree");
  const hit = T.pickFromList(offered, ['Master of Science', "Master's/Advanced Degree", "Master's Degree"]);
  assert.strictEqual(hit.index, 3);
  assert.strictEqual(hit.rank, 1); // the saved name (rank 0) was not offered, the next one was
  assert.strictEqual(T.pickFromList(opts('Master of Science', "Master's Degree"), ['Master of Science', "Master's Degree"]).index, 0);
});

test('pickFromList ignores case, apostrophes, punctuation and a trailing (...)', () => {
  assert.strictEqual(T.pickFromList(opts('MASTERS DEGREE'), ["Master's Degree"]).index, 0);
  assert.strictEqual(T.pickFromList(opts('Master of Science (MS)', 'Master of Arts'), ['Master of Science']).index, 0);
  assert.strictEqual(T.pickFromList(opts("Master's/Advanced Degree"), ["Masters Advanced Degree"]).index, 0);
});

test('pickFromList never accepts a near miss', () => {
  assert.strictEqual(T.pickFromList(opts('Master of Arts', 'Master of Business Administration'), ['Master of Science']), null);
  assert.strictEqual(T.pickFromList(opts('Computer Engineering', 'Computer Networking'), ['Computer Science']), null);
  assert.strictEqual(T.pickFromList(opts('Select One', 'High School'), ['Master of Science', "Master's Degree"]), null); // the placeholder is not an answer
});

test('pickFromList stems only count when exactly one option contains the word', () => {
  assert.strictEqual(T.pickFromList(opts('Undergraduate Bachelor Programme', 'Doctorate'), ['Bachelor of Engineering'], ['bachelor']).via, 'stem');
  assert.strictEqual(T.pickFromList(opts("Master's Degree Programme", 'Doctorate'), ['Master of Science'], ['master']).index, 0);
  assert.strictEqual(T.pickFromList(opts('Master of Arts', 'Master of Science'), ['Masters Programme'], ['master']), null);
  assert.strictEqual(T.pickFromList(opts('Doctorate'), ['Master of Science'], ['master']), null);
});

test('a name earlier on the list beats a later one even if the later option comes first on the page', () => {
  const offered = opts("Master's Degree", 'Master of Science');
  assert.strictEqual(T.pickFromList(offered, ['Master of Science', "Master's Degree"]).index, 1);
});

// ---- locked education --------------------------------------------------------------------
test('education is locked and its lists start with the saved name', () => {
  const E = require('../src/education.js').education;
  assert.strictEqual(E.locked, true);
  assert.strictEqual(E.entries.length, 3);
  const m = E.wanted(E.entries[0], 'degree');
  assert.strictEqual(m.list[0], 'Master of Science');
  assert.ok(m.list.includes("Master's/Advanced Degree"));
  assert.strictEqual(new Set(m.list.map((x) => x.toLowerCase())).size, m.list.length, 'no repeated names');
  assert.strictEqual(E.wanted(E.entries[2], 'degree').list[0], 'Bachelor of Engineering');
  assert.ok(E.wanted(E.entries[2], 'degree').list.includes("Bachelor's Degree"));
  assert.ok(E.wanted(E.entries[1], 'field').list.includes('Computer and Information Science'));
  assert.strictEqual(E.wanted(E.entries[2], 'field').list[0], 'Information Technology');
});

test('the fill always uses the locked education, whatever the saved profile says', () => {
  require('../src/util.js');
  require('../src/matcher.js');
  const JAf = require('../src/filler.js');
  const p = JAf.filler.withLockedEducation({ basics: {}, education: [{ school: 'Hacked University' }] });
  assert.deepStrictEqual(p.education.map((e) => e.school), ['Unlisted State University', 'Sample Tech Institute', 'Placeholder College']);
  assert.strictEqual(JAf.filler.wantedFor('education.degree', p.education[2]).list[0], 'Bachelor of Engineering');
  assert.strictEqual(JAf.filler.wantedFor('education.school', p.education[2]), null);
});

test('locked answers: yours are mostly blank, and blank means skip', () => {
  const A = require('../src/answers.js').answers;
  assert.strictEqual(A.locked, true);
  assert.strictEqual(A.application.willingToRelocate, 'Yes');
  assert.strictEqual(A.application.over18, 'Yes');
  assert.ok(Object.values(A.eeo).every((v) => v === ''));
  const JAf = require('../src/filler.js');
  const p = JAf.filler.withLockedEducation({ eeo: { gender: 'x' }, application: { over18: 'No' } });
  assert.strictEqual(p.eeo.gender, '');
  assert.strictEqual(p.application.over18, 'Yes');
});

// ---- work experience: locked jobs, bullets read from the resume ------------------------------
const PARSE = require('../src/resume-parse.js').resumeParse;
const JOBS = require('../src/experience.js').experience.entries;
const RESUME = [
  'SAMPLE PERSON', 'PROFESSIONAL SUMMARY', 'A summary line.', '',
  'PROFESSIONAL EXPERIENCE', '',
  'Example Corporation Jan 2024 - Sep 2026', '', 'Software Developer Springfield, IL',
  '• Built the first thing with Java and', 'Kafka across two regions.',
  '• Built the second thing.', '',
  'Sample Inc Jan 2020 - Jul 2021', 'Software Engineer Chicago, IL',
  '• Did the older thing, which was auto-', 'mated end to end.',
  '- A dash bullet at Example Corp should stay with Sample Inc.', '',
  'PROJECTS', 'My Project | React', '• A project bullet.', '',
  'EDUCATION', 'Some University 2017 - 2021',
];

test('resume bullets are found under each locked company, wrapped lines joined', () => {
  const r = PARSE.extractExperience(RESUME, JOBS);
  assert.deepStrictEqual(r[0].bullets, ['Built the first thing with Java and Kafka across two regions.', 'Built the second thing.']);
  assert.deepStrictEqual(r[1].bullets, ['Did the older thing, which was automated end to end.', 'A dash bullet at Example Corp should stay with Sample Inc.']);
  assert.strictEqual(r[0].description, '• Built the first thing with Java and Kafka across two regions.\n• Built the second thing.');
});

test('bullets after the experience section (projects) are not taken', () => {
  const all = PARSE.extractExperience(RESUME, JOBS).flatMap((x) => x.bullets).join(' ');
  assert.ok(!/project bullet/.test(all));
});

test('a company that is not in the resume gets no bullets', () => {
  const r = PARSE.extractExperience(RESUME.filter((l) => !/Sample Inc|older thing|mated|dash bullet/.test(l)), JOBS);
  assert.strictEqual(r[1].description, '');
  assert.strictEqual(r[0].bullets.length, 2);
});

test('a resume without an experience heading is still searched', () => {
  const r = PARSE.extractExperience(['Example Corporation Jan 2024 - Sep 2026', '• One.', 'Sample Inc Jan 2020 - Jul 2021', '• Two.'], JOBS);
  assert.deepStrictEqual([r[0].bullets, r[1].bullets], [['One.'], ['Two.']]);
});

test('the fill takes experience from the locked list plus the resume bullets', () => {
  require('../src/util.js'); require('../src/matcher.js');
  const F = require('../src/filler.js').filler;
  const p = F.withLockedEducation({ experience: [{ company: 'Evil Corp' }] }, { parsed: [{ company: 'Example Corp', description: '• X' }] });
  assert.deepStrictEqual(p.experience.map((e) => [e.company, e.title, e.description]), [['Example Corp', 'Software Developer', '• X'], ['Sample Inc', 'Software Engineer', '']]);
});

// ---- technical skills: read from the resume, not from a fixed list --------------------------
test('skills are read from the Technical Skills section, category labels dropped', () => {
  const lines = [
    'PROFESSIONAL EXPERIENCE', 'Example Corporation Jan 2024 - Sep 2026', '• Did a thing.', '',
    'TECHNICAL SKILLS',
    'Languages: Java, Python, JavaScript, TypeScript, SQL',
    'Frameworks: Spring Boot, React, Node.js (Express, Fastify),', 'Django',
    'Cloud & DevOps: AWS, Docker, Kubernetes, CI/CD, Java.',
    '', 'EDUCATION', 'Some University 2017 - 2021', 'Skills: Not Me',
  ];
  assert.deepStrictEqual(PARSE.extractSkills(lines), [
    'Java', 'Python', 'JavaScript', 'TypeScript', 'SQL', 'Spring Boot', 'React', 'Node.js (Express, Fastify)', 'Django',
    'AWS', 'Docker', 'Kubernetes', 'CI/CD',
  ]);
});

test('skills: plain lists, bullets, other heading names, nothing found', () => {
  assert.deepStrictEqual(PARSE.extractSkills(['Skills', '• Go, Rust', '• C++ | R', 'PROJECTS', 'X']), ['Go', 'Rust', 'C++', 'R']);
  assert.deepStrictEqual(PARSE.extractSkills(['Skills & Tools', 'Git; Jira; Linux']), ['Git', 'Jira', 'Linux']);
  assert.deepStrictEqual(PARSE.extractSkills(['EXPERIENCE', 'Example Corporation', '• Did things.']), []);
});

test('the fill uses the resume skills when there are some, else the saved list', () => {
  const JAf = require('../src/filler.js');
  const saved = { skills: ['Saved A', 'Saved B'] };
  assert.deepStrictEqual(JAf.filler.withLockedEducation(saved, { skills: ['Java', 'Go'] }).skills, ['Java', 'Go']);
  assert.deepStrictEqual(JAf.filler.withLockedEducation(saved, { skills: [] }).skills, ['Saved A', 'Saved B']);
  assert.deepStrictEqual(JAf.filler.withLockedEducation(saved, null).skills, ['Saved A', 'Saved B']);
});
