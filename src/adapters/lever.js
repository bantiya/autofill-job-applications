// Lever job pages: jobs.lever.co/<company>/<id>/apply
// Lever parses an uploaded resume and pre-fills the form, so we upload first, wait for the
// parser to finish, and then fill around whatever it produced.
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  JA.registerAdapter({
    name: 'lever',
    match(loc) {
      return /(^|\.)lever\.co$/.test(loc.hostname);
    },
    async afterResumeUpload() {
      await JA.util.sleep(1200);
      await JA.util.waitFor(() => !document.querySelector('.resume-upload-working'), 9000, 200);
      await JA.util.sleep(400);
    },
    comboOptions(key) {
      return key === 'basics.location' ? { acceptFirst: true, free: true } : {};
    },
  });
})(typeof self !== 'undefined' ? self : globalThis);
