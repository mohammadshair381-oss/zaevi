import test from 'node:test';
import assert from 'node:assert/strict';

import { errorHandler, notFoundHandler } from '../src/middleware/errors.js';

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

test('production error responses hide internal details', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = createRes();
    errorHandler({ logger: { error() {} } })(new Error('secret database host'), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.message, 'Internal Server Error');
    assert.equal(res.body.error.stack, undefined);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('development error responses include the message and stack', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const res = createRes();
    errorHandler({ logger: { error() {} } })(new Error('boom'), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.message, 'boom');
    assert.ok(res.body.error.stack);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('notFoundHandler returns text for non-API paths', () => {
  const res = createRes();
  notFoundHandler()({ path: '/missing.html', originalUrl: '/missing.html' }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, 'Not Found');
});
