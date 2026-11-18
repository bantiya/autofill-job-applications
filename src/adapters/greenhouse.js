// Greenhouse job boards: boards.greenhouse.io, job-boards.greenhouse.io, and company pages
// that embed the Greenhouse form (usually in an iframe, which the content script also covers).
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  JA.registerAdapter({
    name: 'greenhouse',
    match(loc, doc) {
      return (
        /(^|\.)greenhouse\.io$/.test(loc.hostname) ||
        !!doc.querySelector('#application_form, #application-form, form[action*="greenhouse.io"]')
      );
    },
    async afterResumeUpload() {
      await JA.util.sleep(1500);
    },
    comboOptions(key) {
      // Greenhouse's location field is a typeahead; the first suggestion is the right city.
      return key === 'basics.location' ? { acceptFirst: true, free: true } : {};
    },
  });
})(typeof self !== 'undefined' ? self : globalThis);
