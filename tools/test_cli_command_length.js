// Windows CLI launches must keep long agent instructions out of argv.
const assert = require('node:assert/strict');
const cli = require('../server/cli');

const largeSystem = 'material instructions '.repeat(1800);
const windows = cli.buildInvocation({
  provider: 'claude', bin: 'C:/Claude/claude.exe', system: largeSystem,
  prompt: 'Recreate the material graph.', dir: 'C:/Temp/kd_chat', platform: 'win32'
});
assert.ok(!windows.args.includes('--system-prompt'));
assert.ok(windows.stdin.includes(largeSystem));
assert.ok(windows.stdin.endsWith('Recreate the material graph.'));
const commandChars = ['C:/Claude/claude.exe', ...windows.args].reduce((sum, arg) => sum + arg.length + 3, 0);
assert.ok(commandChars < 32767, `Windows command line still too long: ${commandChars}`);

const short = cli.buildInvocation({
  provider: 'claude', bin: 'claude.exe', system: 'short instructions',
  prompt: 'hello', platform: 'win32'
});
assert.ok(short.args.includes('--system-prompt'));
assert.equal(short.stdin, 'hello');

const codex = cli.buildInvocation({
  provider: 'codex', bin: 'codex.exe', system: largeSystem,
  prompt: 'hello', dir: 'C:/Temp/kd_chat', platform: 'win32'
});
assert.ok(!codex.args.includes(largeSystem));
assert.ok(codex.stdin.startsWith(largeSystem));

console.log('CLI command-length regression checks passed.');
