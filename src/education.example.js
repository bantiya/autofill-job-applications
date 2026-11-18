// COPY this file to education.js (gitignored) and put your real education there.
// Education: LOCKED. This is the only place the extension reads education from.
//
// Whatever is saved in the extension (settings page, imported JSON) is ignored for education, and the
// settings page shows this list read-only. To change it, edit this file and reload the extension.
//
// Degree and Field of Study are dropdowns / pickers whose wording differs from site to site (your
// Workday page offers "Master's/Advanced Degree" and "Computer and Information Science", not
// "Master of Science" or "Computer Information Systems"). So every entry has an ordered list:
//   1. the name saved here (degree / field),
//   2. then each name in degreeFallbacks / fieldFallbacks, top to bottom,
// and the first name that the page actually offers is the one that gets chosen. A name only counts when
// it is the same text as an option (capitals, apostrophes, punctuation and a trailing "(MS)" are
// ignored), so a near miss such as "Master of Arts" is never picked by accident.
// If nothing on the list is offered, the *Stems* are a last resort: a word (for example "master") is
// accepted only when exactly ONE option on the page contains it.
// If that fails too the box is left empty and the popup tells you what the page offered.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  // Names seen on Workday (from your screenshots) first, then other common wordings.
  const MASTERS = [
    "Master's/Advanced Degree", "Master's Degree", 'Masters Degree', "Master's", 'Masters', 'Master',
    'Master of Science', 'MS',
  ];
  const BACHELORS = [
    "Bachelor's Degree", 'Bachelors Degree', "Bachelor's", 'Bachelors', 'Bachelor',
    'Bachelor of Engineering', 'BE',
  ];

  const entries = [
    {
      school: 'Unlisted State University',
      degree: 'Master of Science',
      field: 'Computer Information Systems – Artificial Intelligence Specialization',
      gpa: '',
      location: '',
      startDate: '2026-07',
      endDate: '',
      degreeFallbacks: MASTERS,
      degreeStems: ['master'],
      fieldFallbacks: [
        'Computer Information Systems', 'Artificial Intelligence',
        'Computer and Information Science', 'Computer and Information Sciences',
        'Information Systems', 'Computer Science',
      ],
    },
    {
      school: 'Sample Tech Institute',
      degree: 'Master of Science',
      field: 'Computer Science',
      gpa: '',
      location: '',
      startDate: '2021-08',
      endDate: '2023-05',
      degreeFallbacks: MASTERS,
      degreeStems: ['master'],
      fieldFallbacks: [
        'Computer and Information Science', 'Computer and Information Sciences',
      ],
    },
    {
      school: 'Placeholder College',
      degree: 'Bachelor of Engineering',
      field: 'Information Technology',
      gpa: '',
      location: '',
      startDate: '2017-06',
      endDate: '2021-06',
      degreeFallbacks: BACHELORS,
      degreeStems: ['bachelor'],
      fieldFallbacks: [
        'Computer and Information Science', 'Computer and Information Sciences',
      ],
    },
  ];

  // Ordered names to try for one entry: the saved name, then the fallbacks, without repeats.
  function wanted(entry, kind) {
    if (!entry) return null;
    const saved = kind === 'degree' ? entry.degree : entry.field;
    const extra = (kind === 'degree' ? entry.degreeFallbacks : entry.fieldFallbacks) || [];
    const stems = (kind === 'degree' ? entry.degreeStems : entry.fieldStems) || [];
    const seen = new Set();
    const list = [saved].concat(extra).filter((x) => {
      const k = String(x || '').trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { list, stems };
  }

  JA.education = { locked: true, entries, wanted };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
