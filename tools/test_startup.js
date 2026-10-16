const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { listenWithFallback } = require('../server/listen-with-fallback');

class FakeServer extends EventEmitter {
  attempts = [];

  listen(port, host, callback) {
    this.attempts.push({ port, host });
    queueMicrotask(() => {
      if (port === 8787) {
        this.emit('error', Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }));
        return;
      }
      this.boundPort = port;
      callback();
    });
    return this;
  }

  address() { return this.boundPort ? { port: this.boundPort } : null; }
}

test('tries the next port and reports the address that actually opened', async () => {
  const server = new FakeServer();
  let actualPort = null;
  let fatalError = null;
  const listening = new Promise(resolve => {
    listenWithFallback(server, {
      host: '0.0.0.0',
      port: 8787,
      maxAttempts: 3,
      onPort: port => { actualPort = port; },
      onListening: resolve,
      onError: error => { fatalError = error; },
    });
  });

  await listening;
  assert.equal(fatalError, null);
  assert.deepEqual(server.attempts, [
    { port: 8787, host: '0.0.0.0' },
    { port: 8788, host: '0.0.0.0' },
  ]);
  assert.equal(actualPort, 8788);
});

test('stops after the configured port range is occupied', async () => {
  class BusyServer extends EventEmitter {
    attempts = [];
    listen(port) {
      this.attempts.push(port);
      queueMicrotask(() => this.emit('error', Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })));
      return this;
    }
  }

  const server = new BusyServer();
  const failed = new Promise(resolve => {
    listenWithFallback(server, {
      host: '0.0.0.0',
      port: 8787,
      maxAttempts: 3,
      onError: (error, range) => resolve({ error, range }),
    });
  });

  const { error, range } = await failed;
  assert.equal(error.code, 'EADDRINUSE');
  assert.deepEqual(server.attempts, [8787, 8788, 8789]);
  assert.deepEqual(range, { firstPort: 8787, lastPort: 8789, port: 8789 });
});
