import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetadata, toXmpSidecar } from '../src/index.js';

const FULL_RECORD = normalizeMetadata({
  Title: 'Harbor at dusk',
  Description: 'Long exposure of the harbor at dusk',
  DateTimeOriginal: '2023:08:15 19:42:11',
  Make: 'FUJIFILM',
  Model: 'X-T4',
  ImageWidth: 6240,
  ImageHeight: 4160,
  Orientation: 'Rotate 90 CW',
  GPSLatitude: '40° 42\' 46" N',
  GPSLongitude: '74° 0\' 21" W',
  Keywords: 'harbor, dusk, long exposure',
  Copyright: 'M Jackson',
  Artist: 'M Jackson',
});

test('toXmpSidecar: wraps output in a valid xpacket', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.startsWith('<?xpacket begin='));
  assert.ok(xmp.trimEnd().endsWith('<?xpacket end="w"?>'));
  assert.ok(xmp.includes('<x:xmpmeta xmlns:x="adobe:ns:meta/">'));
  assert.ok(xmp.includes('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'));
});

test('toXmpSidecar: title/description/rights are Lang Alt with x-default', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<dc:title>'));
  assert.ok(xmp.includes('<rdf:li xml:lang="x-default">Harbor at dusk</rdf:li>'));
  assert.ok(xmp.includes('<rdf:li xml:lang="x-default">Long exposure of the harbor at dusk</rdf:li>'));
  assert.ok(xmp.includes('<dc:rights>'));
  assert.ok(xmp.includes('<rdf:li xml:lang="x-default">M Jackson</rdf:li>'));
});

test('toXmpSidecar: keywords become a dc:subject Bag, one li per keyword', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<dc:subject>'));
  assert.ok(xmp.includes('<rdf:Bag>'));
  assert.ok(xmp.includes('<rdf:li>harbor</rdf:li>'));
  assert.ok(xmp.includes('<rdf:li>dusk</rdf:li>'));
  assert.ok(xmp.includes('<rdf:li>long exposure</rdf:li>'));
});

test('toXmpSidecar: artist becomes a dc:creator Seq', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<dc:creator>'));
  assert.ok(xmp.includes('<rdf:Seq>'));
});

test('toXmpSidecar: date is written to both exif:DateTimeOriginal and xmp:CreateDate', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<exif:DateTimeOriginal>2023-08-15T19:42:11.000Z</exif:DateTimeOriginal>'));
  assert.ok(xmp.includes('<xmp:CreateDate>2023-08-15T19:42:11.000Z</xmp:CreateDate>'));
});

test('toXmpSidecar: make/model/dimensions/orientation map to tiff/exif tags', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<tiff:Make>FUJIFILM</tiff:Make>'));
  assert.ok(xmp.includes('<tiff:Model>X-T4</tiff:Model>'));
  assert.ok(xmp.includes('<exif:PixelXDimension>6240</exif:PixelXDimension>'));
  assert.ok(xmp.includes('<exif:PixelYDimension>4160</exif:PixelYDimension>'));
  assert.ok(xmp.includes('<tiff:Orientation>6</tiff:Orientation>'));
});

test('toXmpSidecar: gps decimal degrees convert to degrees,minutes.fraction with a hemisphere letter', () => {
  const xmp = toXmpSidecar(FULL_RECORD);
  assert.ok(xmp.includes('<exif:GPSLatitude>40,42.766667N</exif:GPSLatitude>'));
  assert.ok(xmp.includes('<exif:GPSLongitude>74,0.350000W</exif:GPSLongitude>'));
});

test('toXmpSidecar: a southern/western hemisphere coordinate gets the S/W letters', () => {
  const record = normalizeMetadata({
    GPSLatitude: -33.8688,
    GPSLongitude: 151.2093,
  });
  const xmp = toXmpSidecar(record);
  assert.ok(xmp.includes('<exif:GPSLatitude>33,52.128000S</exif:GPSLatitude>'));
  assert.ok(xmp.includes('<exif:GPSLongitude>151,12.558000E</exif:GPSLongitude>'));
});

test('toXmpSidecar: fields that are null or empty are left out entirely', () => {
  const xmp = toXmpSidecar(normalizeMetadata({}));
  assert.ok(!xmp.includes('<dc:title>'));
  assert.ok(!xmp.includes('<dc:description>'));
  assert.ok(!xmp.includes('<dc:rights>'));
  assert.ok(!xmp.includes('<dc:creator>'));
  assert.ok(!xmp.includes('<dc:subject>'));
  assert.ok(!xmp.includes('<exif:DateTimeOriginal>'));
  assert.ok(!xmp.includes('<tiff:Make>'));
  assert.ok(!xmp.includes('<exif:GPSLatitude>'));
  assert.ok(xmp.includes('<rdf:Description rdf:about="" xmlns:dc='));
});

test('toXmpSidecar: special characters in string fields are XML-escaped', () => {
  const record = normalizeMetadata({ Title: 'Cats & "Dogs" <3', Artist: "O'Brien" });
  const xmp = toXmpSidecar(record);
  assert.ok(xmp.includes('Cats &amp; &quot;Dogs&quot; &lt;3'));
  assert.ok(xmp.includes('O&apos;Brien'));
});
