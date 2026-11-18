// Shared by the settings page and the popup: reads a resume file (PDF bullets via the bundled pdf.js).
(function (root) {
  'use strict';
  const JA = (root.JA = root.JA || {});

  // Text lines of a PDF, in reading order (pdf.js is bundled in vendor/).
  async function pdfLines(buffer) {
    const pdfjs = await import(chrome.runtime.getURL('vendor/pdf.min.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      let cur = null;
      let lastY = null;
      for (const it of tc.items) {
        const y = Math.round(it.transform[5]);
        if (lastY === null || Math.abs(y - lastY) > 2) { if (cur !== null) lines.push(cur); cur = ''; }
        cur += it.str;
        lastY = y;
        if (it.hasEOL) { lines.push(cur); cur = null; lastY = null; }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  async function parseResume(file) {
    if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) return null;
    try {
      const lines = await pdfLines(await file.arrayBuffer());
      return JA.resumeParse.extractExperience(lines, JA.experience.entries)
        .map((x) => ({ company: x.company, description: x.description, count: x.bullets.length }));
    } catch (e) {
      return null;
    }
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  JA.resumeUpload = { pdfLines, parseResume, readBase64 };
})(typeof window !== 'undefined' ? window : globalThis);
