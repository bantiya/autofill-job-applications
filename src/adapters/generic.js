// Default adapter, used on any site no specific adapter claims. Adapters tune timing and
// dropdown behaviour; the matching and filling logic itself is shared (see matcher/filler).
//
// Adapter shape:
//   name                 string
//   match(location, doc) true when this adapter should handle the page
//   beforeFill(ctx)      optional async hook
//   afterResumeUpload()  async: wait for the site to finish parsing an uploaded resume
//   comboOptions(key)    optional {free, acceptFirst} overrides for autocomplete dropdowns
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  JA.defaultAdapter = {
    name: 'generic',
    match: () => true,
    async afterResumeUpload() {
      await JA.util.sleep(1000);
    },
    comboOptions() {
      return {};
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
