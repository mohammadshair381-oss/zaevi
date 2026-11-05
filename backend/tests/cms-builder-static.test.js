import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CMS_COMPONENT_TYPES } from '../src/models/cms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, '..', 'frontend', 'admin', 'admin.html'), 'utf8');

const COMPONENT_TYPES = [...CMS_COMPONENT_TYPES];

const BUILDER_CONTROL_IDS = [
  'builder-page',
  'builder-new',
  'builder-load',
  'builder-save',
  'builder-preview',
  'builder-publish',
  'builder-revert',
  'builder-status',
  'builder-desktop',
  'builder-tablet',
  'builder-mobile',
  'builder-preview-modal',
  'builder-preview-root',
  'builder-preview-close',
];

function countOccurrences(source, needle) {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('builder mounts exactly one editor inside the builder section', () => {
  assert.equal(countOccurrences(html, 'id="view-builder"'), 1);
  assert.equal(countOccurrences(html, 'id="gjs"'), 1);

  const viewIndex = html.indexOf('id="view-builder"');
  const pageControlIndex = html.indexOf('id="builder-page"');
  const canvasIndex = html.indexOf('id="gjs"');

  assert.ok(viewIndex >= 0 && pageControlIndex > viewIndex && canvasIndex > pageControlIndex,
    'builder page controls and #gjs must live inside the single #view-builder section');
});

test('builder toolbar, page controls, and preview modal are present', () => {
  for (const id of BUILDER_CONTROL_IDS) {
    assert.equal(countOccurrences(html, `id="${id}"`), 1, `expected exactly one #${id}`);
  }
  assert.equal(countOccurrences(html, 'id="nav-builder"'), 1);
  assert.equal(countOccurrences(html, 'grapes.min.css'), 1, 'GrapesJS stylesheet must not be duplicated');
});

test('all 16 CMS component types are registered as blocks and components', () => {
  assert.equal(CMS_COMPONENT_TYPES.length, 16);

  const componentTypesSource = between(html, 'var componentTypes=[', '];');
  const registeredTypes = [...componentTypesSource.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(registeredTypes, COMPONENT_TYPES);

  const blockDefsSource = between(html, 'function blockDefs(){', 'function splitList');
  const blockIds = [...blockDefsSource.matchAll(/\{id:'([^']+)',label:/g)].map((match) => match[1]);
  assert.deepEqual(blockIds, COMPONENT_TYPES);
  assert.equal(new Set(blockIds).size, COMPONENT_TYPES.length);

  const blockLines = blockDefsSource.split('\n').filter((line) => /^\s*\{id:'/.test(line));
  assert.equal(blockLines.length, COMPONENT_TYPES.length);
  for (const line of blockLines) {
    assert.match(line, /traits:\[trait\('/, 'every CMS block must expose editable traits');
  }
});

test('builder navigation makes the single builder section visible', () => {
  const showBuilderSource = between(html, 'function showBuilder(){', "document.getElementById('nav-builder').addEventListener");
  assert.match(showBuilderSource, /s\.id!=='view-builder'/);
  assert.match(showBuilderSource, /getElementById\('view-builder'\)\.hidden=false/);
  assert.match(showBuilderSource, /getElementById\('nav-builder'\)\.classList\.add\('active'\)/);
});

test('GrapesJS initializes once against the visible canvas with default panels', () => {
  assert.equal(countOccurrences(html, 'grapesjs.init('), 1);
  assert.match(html, /var mount=document\.getElementById\('gjs'\)/);
  assert.match(html, /container:mount/);
  assert.doesNotMatch(html, /panels\s*:\s*\[\s*\]/);
});

test('view switching hides every non-selected admin section and clears stale nav state', () => {
  const showSource = between(html, 'function show(view){', "$('nav-dashboard')");
  assert.match(showSource, /querySelectorAll\('\.admin > \.main > section'\)/);
  assert.match(showSource, /section\.hidden=section\.id!==target\[0\]/);
  assert.match(showSource, /querySelectorAll\('\.side a'\)/);
});

test('page loading and saving keep component identity, metadata, and gallery data', () => {
  const loadPageSource = between(html, 'function loadPage(slug){', 'function saveDraft(){');
  assert.match(loadPageSource, /currentPage=page/);
  assert.match(loadPageSource, /forEach\(addCmsComponent\)/);

  const saveDraftSource = between(html, 'function saveDraft(){', 'function publishPage(){');
  assert.match(saveDraftSource, /currentPage&&currentPage\.slug===slug/);
  assert.match(saveDraftSource, /editorToSnapshot\(page\)/);

  const snapshotSource = between(html, 'function editorToSnapshot(page){', 'function loadPages(){');
  assert.match(snapshotSource, /seoTitle/);
  assert.match(snapshotSource, /seoDescription/);

  const idSource = between(html, 'function componentCmsId(component){', 'function normalizeGalleryImages');
  assert.match(idSource, /data-cms-id/);

  const addSource = between(html, 'function addCmsComponent(component){', 'function componentCmsId(component){');
  assert.match(addSource, /model\.set\(name,traitDisplayValue/);
  assert.match(html, /function normalizeGalleryImages/);
});
