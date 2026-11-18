// COPY this file to basics.js (gitignored) and put your real details there.
// Basic details: LOCKED. This is the only place the extension reads them from.
//
// Whatever is saved in the extension (settings page, imported JSON) is ignored for basic details, and the
// settings page shows them read-only. To change them, edit this file and reload the extension.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const values = {
      "firstName": "Alex",
      "middleName": "",
      "lastName": "Example",
      "preferredName": "",
      "email": "alex.example@example.com",
      "phone": "555-010-0100",
      "phoneCountryCode": "+1",
      "address": "",
      "address2": "",
      "city": "Springfield",
      "state": "IL",
      "zip": "",
      "country": "United States",
      "linkedin": "https://www.linkedin.com/in/alex-example",
      "github": "https://github.com/alex-example",
      "portfolio": "https://alex-example.github.io/portfolio",
      "headline": "Software Engineer",
      "summary": "Short professional summary goes here."
  };

  JA.basics = { locked: true, values };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
