// COPY this file to experience.js (gitignored) and put your real jobs there.
// Work experience: LOCKED. The jobs (title, company, location, dates) live only here.
//
// Whatever is saved in the extension (settings page, imported JSON) is ignored for work experience, and the
// settings page shows it read-only. To change it, edit this file and reload the extension.
//
// The Description / bullet points are NOT stored here: they are read from the PDF resume you upload in the
// settings page, so each application gets the bullets of the resume you attached for it. `aliases` are other
// ways the resume may spell the company name; they are only used to find that job's bullets in the resume.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const entries = [
    {
      title: 'Software Developer',
      company: 'Example Corp',
      aliases: ['Example Corporation'],
      location: 'Springfield, IL',
      startDate: '2024-01',
      endDate: '2026-09',
      current: false,
    },
    {
      title: 'Software Engineer',
      company: 'Sample Inc',
      aliases: [],
      location: 'Chicago, IL',
      startDate: '2020-01',
      endDate: '2021-07',
      current: false,
    },
  ];

  JA.experience = { locked: true, entries };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
