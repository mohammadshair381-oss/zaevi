import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editor = readFileSync(path.join(ROOT, '..', 'frontend', 'js', 'homepage-editor.js'), 'utf8');
const sidebar = readFileSync(path.join(ROOT, '..', 'frontend', 'js', 'homepage-sidebar.js'), 'utf8');
const theme = readFileSync(path.join(ROOT, '..', 'frontend', 'js', 'homepage-theme.js'), 'utf8');

test('homepage editor tracks dirty state from saved state', () => {
  assert.match(editor, /state\.savedData/);
  assert.match(editor, /function syncDirty\(\)/);
  assert.match(editor, /canonicalJson\(state\.data\) !== canonicalJson\(state\.savedData\)/);
});

test('homepage editor protects against unload with unsaved changes', () => {
  assert.match(editor, /beforeunload/);
  assert.match(editor, /if \(!state\.dirty\) return;/);
});

test('homepage editor prevents duplicate saves while saving', () => {
  assert.match(editor, /if \(!state\.data \|\| !state\.dirty \|\| state\.saving\) return;/);
});

test('homepage editor only clears dirty state after confirmed save', () => {
  assert.match(editor, /const savedState = response\?\.data\?\.state;/);
  assert.match(editor, /state\.savedData = deepClone\(savedState\);/);
  assert.match(editor, /syncDirty\(\);/);
});

test('homepage editor distinguishes load failure from empty state', () => {
  assert.match(editor, /setStatus\(`Load failed:/);
  assert.match(editor, /state\.savedData = deepClone\(data\);/);
});

test('homepage editor preserves edits made during an in-flight save', () => {
  assert.match(editor, /const saveBaseline = deepClone\(state\.data\);/);
  assert.match(editor, /if \(canonicalJson\(state\.data\) === canonicalJson\(saveBaseline\)\)/);
});

test('homepage editor saves drafts with PUT and reports the Phase C preview boundary', () => {
  assert.match(editor, /apiPutJson\(state\.boot\.applyUrl, \{ state: saveBaseline \}\)/);
  assert.match(editor, /Draft saved\. Preview is unavailable until Phase C\./);
});

test('homepage panels share the editor state and rerender from canonical state updates', () => {
  assert.match(editor, /window\.GCEditor = \{/);
  assert.match(sidebar, /window\.GCEditor\.on\("gc:state", \(st\) => \{/);
  assert.match(sidebar, /isActiveTextControl\(document\.activeElement\)/);
  assert.match(sidebar, /window\.GCEditor\.patch\(/);
  assert.match(theme, /window\.GCEditor\?\.patch\?/);
  for (const panel of ['panelAnnouncement', 'panelSections', 'panelHero', 'panelReels', 'panelFeatures',
    'panelStory', 'panelPromo', 'panelAppBanner', 'panelNav', 'panelFooter', 'panelLogos',
    'panelTestimonials', 'panelProductSections']) {
    assert.ok(sidebar.includes(`function ${panel}(`), `missing shared-state panel ${panel}`);
  }
});

test('homepage collections edit canonical state without unsupported per-item persistence routes', () => {
  assert.match(sidebar, /sectionsList = "1"/);
  assert.match(sidebar, /heroSlides = "1"/);
  assert.match(sidebar, /s\.navigation\.links = next;/);
  assert.match(sidebar, /s\.productSections\.push\(/);
  assert.doesNotMatch(sidebar, /logoDeleteUrlTmpl/);
  assert.doesNotMatch(sidebar, /testimonialDeleteUrlTmpl/);
});