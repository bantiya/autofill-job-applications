// COPY this file to answers.js (gitignored) and fill in your real answers.
// Common application answers and voluntary self-identification: LOCKED. The only place the extension
// reads them from. Whatever is saved in the extension (settings page, imported JSON) is ignored, and the
// settings page shows them read-only. Blank means "skip: answer it yourself on the form".
// To change them, edit this file and reload the extension.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  const application = {
      "authorizedToWork": "Yes",
      "requiresSponsorship": "No",
      "willingToRelocate": "Yes",
      "over18": "Yes",
      "previouslyWorkedHere": "No",
      "noticePeriod": "0 weeks",
      "availableStartDate": "Immediate",
      "salaryExpectation": "100000",
      "referralSource": "LinkedIn",
      "yearsExperience": "4"
  };

  const eeo = {
      "gender": "",
      "race": "",
      "hispanic": "",
      "veteran": "",
      "disability": "",
      "lgbtq": ""
  };

  JA.answers = { locked: true, application, eeo };

  if (typeof module === 'object' && module.exports) module.exports = JA;
})(typeof self !== 'undefined' ? self : globalThis);
