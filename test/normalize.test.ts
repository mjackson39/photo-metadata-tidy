import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetadata } from '../src/index.js';

test('date: EXIF colon-separated format is read as UTC', () => {
  const result = normalizeMetadata({ DateTimeOriginal: '2023:08:15 14:30:00' });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: EXIF format with a T separator is also accepted', () => {
  const result = normalizeMetadata({ DateTimeOriginal: '2023:08:15T14:30:00' });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: a Date object round-trips to ISO', () => {
  const result = normalizeMetadata({ DateTaken: new Date('2023-08-15T14:30:00.000Z') });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: an invalid Date object comes back null', () => {
  const result = normalizeMetadata({ DateTaken: new Date('not a date') });
  assert.equal(result.dateTaken, null);
});

test('date: a 10-digit number is treated as unix seconds', () => {
  const result = normalizeMetadata({ Timestamp: 1692109800 });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: a 13-digit number is treated as unix milliseconds', () => {
  const result = normalizeMetadata({ Timestamp: 1692109800000 });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: a numeric string of timestamp digits is parsed the same way', () => {
  const result = normalizeMetadata({ Timestamp: '1692109800' });
  assert.equal(result.dateTaken, '2023-08-15T14:30:00.000Z');
});

test('date: garbage text does not throw and comes back null', () => {
  const result = normalizeMetadata({ DateTaken: 'whenever I got around to it' });
  assert.equal(result.dateTaken, null);
});

test('date: missing field comes back null', () => {
  const result = normalizeMetadata({});
  assert.equal(result.dateTaken, null);
});

test('gps: plain decimal degrees with no ref keep their sign', () => {
  const result = normalizeMetadata({ GPSLatitude: 40.7128, GPSLongitude: -74.006 });
  assert.equal(result.gps?.latitude, 40.7128);
  assert.equal(result.gps?.longitude, -74.006);
});

test('gps: a positive decimal is flipped negative by a S/W ref', () => {
  const result = normalizeMetadata({
    GPSLatitude: 40.7128,
    GPSLatitudeRef: 'S',
    GPSLongitude: 74.006,
    GPSLongitudeRef: 'W',
  });
  assert.equal(result.gps?.latitude, -40.7128);
  assert.equal(result.gps?.longitude, -74.006);
});

test('gps: a [deg, min, sec] triple converts to decimal degrees', () => {
  const result = normalizeMetadata({
    GPSLatitude: [40, 42, 46],
    GPSLatitudeRef: 'N',
    GPSLongitude: [74, 0, 21],
    GPSLongitudeRef: 'W',
  });
  assert.ok(Math.abs((result.gps?.latitude ?? 0) - 40.712778) < 1e-5);
  assert.ok(Math.abs((result.gps?.longitude ?? 0) - -74.005833) < 1e-5);
});

test('gps: a degrees-minutes-seconds string with an embedded direction letter works', () => {
  const result = normalizeMetadata({
    GPSLatitude: `40° 26' 46" N`,
    GPSLongitude: `74° 0' 21" W`,
  });
  assert.ok(Math.abs((result.gps?.latitude ?? 0) - 40.446111) < 1e-5);
  assert.ok(Math.abs((result.gps?.longitude ?? 0) - -74.005833) < 1e-5);
});

test('gps: a triple with a non-numeric entry is rejected', () => {
  const result = normalizeMetadata({
    GPSLatitude: [40, 'x', 46],
    GPSLongitude: [74, 0, 21],
  });
  assert.equal(result.gps, null);
});

test('gps: only one of latitude/longitude present means no gps at all', () => {
  const result = normalizeMetadata({ GPSLatitude: 40.7128 });
  assert.equal(result.gps, null);
});

test('dimensions: a combined "WxH" string is split', () => {
  const result = normalizeMetadata({ Size: '3000x2000' });
  assert.deepEqual(result.dimensions, { width: 3000, height: 2000 });
});

test('dimensions: the unicode multiplication sign is accepted as a separator', () => {
  const result = normalizeMetadata({ ImageSize: '3000×2000' });
  assert.deepEqual(result.dimensions, { width: 3000, height: 2000 });
});

test('dimensions: separate width/height fields with a "px" suffix are parsed', () => {
  const result = normalizeMetadata({ ImageWidth: '6240px', ImageHeight: '4160px' });
  assert.deepEqual(result.dimensions, { width: 6240, height: 4160 });
});

test('dimensions: zero and negative values are rejected as nonsensical', () => {
  const result = normalizeMetadata({ Width: 0, Height: -100 });
  assert.deepEqual(result.dimensions, { width: null, height: null });
});

test('dimensions: a fractional value is rounded to the nearest pixel', () => {
  const result = normalizeMetadata({ Width: 6240.6, Height: 4160.2 });
  assert.deepEqual(result.dimensions, { width: 6241, height: 4160 });
});

test('dimensions: missing fields come back null rather than throwing', () => {
  const result = normalizeMetadata({});
  assert.deepEqual(result.dimensions, { width: null, height: null });
});
