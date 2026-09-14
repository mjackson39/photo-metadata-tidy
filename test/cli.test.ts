import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatch, parseArgs } from '../src/cli.js';

test('parseArgs: a bare positional argument is the input path', () => {
  assert.deepEqual(parseArgs(['photos.json']), { help: false, input: 'photos.json' });
});

test('parseArgs: -o/--output take the following argument as the output path', () => {
  assert.deepEqual(parseArgs(['in.json', '-o', 'out.json']), {
    help: false,
    input: 'in.json',
    output: 'out.json',
  });
  assert.deepEqual(parseArgs(['--output', 'out.json']), { help: false, output: 'out.json' });
});

test('parseArgs: -h/--help set the help flag', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs: a second positional argument is rejected', () => {
  assert.throws(() => parseArgs(['a.json', 'b.json']), /only one input path/);
});

test('parseArgs: an unknown flag is rejected', () => {
  assert.throws(() => parseArgs(['--bogus']), /unrecognized option: --bogus/);
});

test('parseArgs: -o with nothing after it is rejected', () => {
  assert.throws(() => parseArgs(['-o']), /-o requires a path/);
});

test('normalizeBatch: an exiftool-style array normalizes each entry and keeps sourceFile', () => {
  const result = normalizeBatch([
    { SourceFile: 'a.jpg', Make: 'FUJIFILM', ImageWidth: 6240, ImageHeight: 4160 },
    { SourceFile: 'b.jpg', Make: 'Canon' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.sourceFile, 'a.jpg');
  assert.equal(result[0]?.camera.make, 'FUJIFILM');
  assert.deepEqual(result[0]?.dimensions, { width: 6240, height: 4160 });
  assert.equal(result[1]?.sourceFile, 'b.jpg');
  assert.equal(result[1]?.camera.make, 'Canon');
});

test('normalizeBatch: a single object (not wrapped in an array) is accepted', () => {
  const result = normalizeBatch({ Make: 'Canon' });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.camera.make, 'Canon');
});

test('normalizeBatch: a record with no SourceFile omits sourceFile entirely', () => {
  const result = normalizeBatch([{ Make: 'Canon' }]);
  assert.equal('sourceFile' in (result[0] as object), false);
});

test('normalizeBatch: non-object entries in the array do not throw', () => {
  const result = normalizeBatch([null, 'garbage', 42]);
  assert.equal(result.length, 3);
  for (const entry of result) assert.equal(entry.camera.make, null);
});
