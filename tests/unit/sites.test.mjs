// Rule-based routing shared by the side panel, the in-page panel and the service worker (no model calls).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.self = globalThis;
createRequire(import.meta.url)('../../extension/src/shared/sites.js');
const S = globalThis.KoodeSites;
const c = (text, siteId = null) => S.classify(text, { siteId });

test('New Tab: open a site by name, English and Malayalam (spoken forms with case/conjunctive endings)', () => {
  for (const t of ['Open WhatsApp', 'വാട്സ്ആപ്പ് തുറക്കൂ', 'വാട്സാപ്പ് തുറക്കണം', 'whatsapp', 'വാട്സ്ആപ്പിലേക്ക് പോകൂ']) {
    const r = c(t);
    assert.equal(r.type, 'navigate', t); assert.equal(r.site.id, 'whatsapp', t); assert.equal(r.goal, '', t);
  }
  const r = c('വാട്സാപ്പ് തുറന്ന് ഒരാളെ തിരയണം');
  assert.deepEqual([r.type, r.site.id, r.goal], ['navigate', 'whatsapp', 'ഒരാളെ തിരയണം']);
});

test('from WhatsApp: "open YouTube and search…" navigates and carries the rest of the request', () => {
  let r = c('യൂട്യൂബ് തുറന്ന് ഗൂഗിൾ ഫോം ട്യൂട്ടോറിയൽ തിരയൂ', 'whatsapp');
  assert.deepEqual([r.type, r.site.id, r.goal], ['navigate', 'youtube', 'ഗൂഗിൾ ഫോം ട്യൂട്ടോറിയൽ തിരയൂ']);
  r = c('Open YouTube and search for a Google Forms tutorial', 'whatsapp');
  assert.deepEqual([r.type, r.site.id, r.goal], ['navigate', 'youtube', 'search for google forms tutorial']);
  r = c('യൂട്യൂബിൽ പോയി പാട്ട് കേൾക്കണം', 'whatsapp');
  assert.deepEqual([r.type, r.site.id, r.goal], ['navigate', 'youtube', 'പാട്ട് കേൾക്കണം']);
  r = c('search youtube for cooking', 'whatsapp');
  assert.deepEqual([r.type, r.site.id], ['navigate', 'youtube']);
});

test('a passing mention of another site stays a goal for the current page', () => {
  assert.equal(c('search for a whatsapp tutorial', 'youtube').type, 'guide');
  assert.equal(c('ഗൂഗിൾ ഫോം ട്യൂട്ടോറിയൽ തിരയൂ', 'youtube').type, 'guide');
  assert.equal(c('ഈ ഫോം പൂരിപ്പിക്കാൻ സഹായിക്കൂ', 'practiceform').type, 'guide');
  assert.equal(c('stop the video', 'youtube').type, 'guide');
});

test('practice application form: named, or a bare "form" with an open verb', () => {
  for (const t of ['അപേക്ഷാ ഫോം തുറക്കൂ', 'ഫോം തുറക്കൂ', 'open the application form', 'അപേക്ഷ ഫോം തുറന്ന് പൂരിപ്പിക്കാൻ സഹായിക്കൂ']) {
    const r = c(t, 'youtube');
    assert.equal(r.type, 'navigate', t); assert.equal(r.site.id, 'practiceform', t);
  }
  assert.equal(c('open the application form and help me fill it', 'youtube').goal, 'help me fill it');
  assert.equal(S.SITES.find((s) => s.id === 'practiceform').url, 'http://localhost:8787/demo/form.html');
});

test('Google Forms: no hardcoded form; asking to open one explains how', () => {
  assert.equal(c('open google forms').type, 'need_link');
  assert.equal(c('ഗൂഗിൾ ഫോം തുറക്കൂ', 'youtube').type, 'need_link');
  assert.equal(c('fill this form', 'googleforms').type, 'guide');
});

test('exit: short whole-utterance exit phrases only', () => {
  for (const t of ['exit', 'Exit.', 'bye koode', 'നിർത്താം', 'നിർത്തൂ', 'മതി', 'ശരി, നന്ദി. മതി.', 'Koode അവസാനിപ്പിക്കൂ', 'സെഷൻ അവസാനിപ്പിക്കൂ', 'end session', "that's all"]) {
    assert.equal(c(t, 'practiceform').type, 'exit', t);
  }
  for (const t of ['stop the video', 'exit the full screen mode on this video', 'how do I close this popup']) assert.notEqual(c(t, 'youtube').type, 'exit', t);
});

test('already on the site, unknown site, and New Tab without a site', () => {
  assert.equal(c('open whatsapp', 'whatsapp').type, 'already_here');
  assert.equal(c('play a song').type, 'which_site');
  assert.equal(c('dark mode', 'demo').type, 'guide');
});

test('forUrl: respondent Google Forms only; never the editor or the forms list', () => {
  assert.equal(S.forUrl('https://docs.google.com/forms/d/e/1FAIpQLSc_x-Y/viewform').id, 'googleforms');
  assert.equal(S.forUrl('https://docs.google.com/forms/d/e/1FAIpQLSc_x-Y/viewform?usp=sf_link').id, 'googleforms');
  assert.equal(S.forUrl('https://docs.google.com/forms/d/e/1FAIpQLSc_x-Y/formResponse').id, 'googleforms');
  assert.equal(S.forUrl('https://docs.google.com/forms/u/1/d/e/1FAIpQLSc_x-Y/viewform').id, 'googleforms');
  assert.equal(S.forUrl('https://docs.google.com/forms/d/10JfOz_abc/edit'), null);
  assert.equal(S.forUrl('https://docs.google.com/forms/d/10JfOz_abc/edit#responses'), null);
  assert.equal(S.forUrl('https://docs.google.com/forms/u/0/'), null);
  assert.equal(S.forUrl('http://localhost:8787/demo/form.html').id, 'practiceform');
  assert.equal(S.forUrl('http://localhost:8787/demo/settings.html').id, 'demo');
  assert.equal(S.forUrl('https://web.whatsapp.com/').id, 'whatsapp');
  assert.equal(S.forUrl('https://www.youtube.com/watch?v=x').id, 'youtube');
  assert.equal(S.forUrl('chrome://newtab/'), null);
  assert.equal(S.forUrl('https://example.com/'), null);
});
