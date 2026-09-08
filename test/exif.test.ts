import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExifMetadata } from '../src/exif.js';
import { normalizeMetadata } from '../src/index.js';

// Builds a minimal little-endian TIFF/Exif block by hand:
//
// IFD0 (4 entries: Make, Orientation, ExifIFD pointer, GPSIFD pointer)
//   -> "Fuji\0" (Make's overflow string)
//   -> Exif sub-IFD (3 entries: DateTimeOriginal, PixelXDimension, PixelYDimension)
//     -> "2023:08:15 19:42:11\0" (DateTimeOriginal's overflow string)
//   -> GPS sub-IFD (4 entries: LatitudeRef, LongitudeRef, Latitude, Longitude)
//     -> GPSLatitude rational triple (40, 42, 46)
//     -> GPSLongitude rational triple (74, 0, 21)
//
// Every offset below is relative to `tiffStart` (the "II" byte order marker).
function buildTiff(): Uint8Array {
  const buf = new ArrayBuffer(231);
  const view = new DataView(buf);
  const le = true;

  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49); // "II"
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le); // offset to IFD0

  // IFD0 at 8
  view.setUint16(8, 4, le); // 4 entries

  // Make (ASCII, count 5, overflow at 62)
  view.setUint16(10, 0x010f, le);
  view.setUint16(12, 2, le);
  view.setUint32(14, 5, le);
  view.setUint32(18, 62, le);

  // Orientation (SHORT, inline value 6)
  view.setUint16(22, 0x0112, le);
  view.setUint16(24, 3, le);
  view.setUint32(26, 1, le);
  view.setUint16(30, 6, le);

  // Exif IFD pointer (LONG, inline offset 67)
  view.setUint16(34, 0x8769, le);
  view.setUint16(36, 4, le);
  view.setUint32(38, 1, le);
  view.setUint32(42, 67, le);

  // GPS IFD pointer (LONG, inline offset 129)
  view.setUint16(46, 0x8825, le);
  view.setUint16(48, 4, le);
  view.setUint32(50, 1, le);
  view.setUint32(54, 129, le);

  view.setUint32(58, 0, le); // no next IFD

  // Make overflow string at 62
  const make = 'Fuji\0';
  for (let i = 0; i < make.length; i++) view.setUint8(62 + i, make.charCodeAt(i));

  // Exif sub-IFD at 67
  view.setUint16(67, 3, le); // 3 entries

  // DateTimeOriginal (ASCII, count 20, overflow at 109)
  view.setUint16(69, 0x9003, le);
  view.setUint16(71, 2, le);
  view.setUint32(73, 20, le);
  view.setUint32(77, 109, le);

  // PixelXDimension (LONG, inline 6240)
  view.setUint16(81, 0xa002, le);
  view.setUint16(83, 4, le);
  view.setUint32(85, 1, le);
  view.setUint32(89, 6240, le);

  // PixelYDimension (LONG, inline 4160)
  view.setUint16(93, 0xa003, le);
  view.setUint16(95, 4, le);
  view.setUint32(97, 1, le);
  view.setUint32(101, 4160, le);

  view.setUint32(105, 0, le); // no next IFD

  // DateTimeOriginal overflow string at 109
  const dateTime = '2023:08:15 19:42:11\0';
  for (let i = 0; i < dateTime.length; i++) view.setUint8(109 + i, dateTime.charCodeAt(i));

  // GPS sub-IFD at 129
  view.setUint16(129, 4, le); // 4 entries

  // GPSLatitudeRef (ASCII, count 2, inline "N\0")
  view.setUint16(131, 0x0001, le);
  view.setUint16(133, 2, le);
  view.setUint32(135, 2, le);
  view.setUint8(139, 'N'.charCodeAt(0));
  view.setUint8(140, 0);

  // GPSLongitudeRef (ASCII, count 2, inline "W\0")
  view.setUint16(143, 0x0003, le);
  view.setUint16(145, 2, le);
  view.setUint32(147, 2, le);
  view.setUint8(151, 'W'.charCodeAt(0));
  view.setUint8(152, 0);

  // GPSLatitude (RATIONAL x3, overflow at 183)
  view.setUint16(155, 0x0002, le);
  view.setUint16(157, 5, le);
  view.setUint32(159, 3, le);
  view.setUint32(163, 183, le);

  // GPSLongitude (RATIONAL x3, overflow at 207)
  view.setUint16(167, 0x0004, le);
  view.setUint16(169, 5, le);
  view.setUint32(171, 3, le);
  view.setUint32(175, 207, le);

  view.setUint32(179, 0, le); // no next IFD

  // GPSLatitude rationals: 40/1, 42/1, 46/1
  const lat = [40, 42, 46];
  for (let i = 0; i < 3; i++) {
    view.setUint32(183 + i * 8, lat[i], le);
    view.setUint32(183 + i * 8 + 4, 1, le);
  }

  // GPSLongitude rationals: 74/1, 0/1, 21/1
  const lon = [74, 0, 21];
  for (let i = 0; i < 3; i++) {
    view.setUint32(207 + i * 8, lon[i], le);
    view.setUint32(207 + i * 8 + 4, 1, le);
  }

  return new Uint8Array(buf);
}

function buildJpegWithExif(): Uint8Array {
  const tiff = buildTiff();
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const segmentLength = 2 + exifHeader.length + tiff.length;

  const bytes = new Uint8Array(2 + 2 + 2 + exifHeader.length + tiff.length + 2);
  let i = 0;
  bytes[i++] = 0xff;
  bytes[i++] = 0xd8; // SOI
  bytes[i++] = 0xff;
  bytes[i++] = 0xe1; // APP1
  bytes[i++] = (segmentLength >> 8) & 0xff;
  bytes[i++] = segmentLength & 0xff;
  for (const b of exifHeader) bytes[i++] = b;
  bytes.set(tiff, i);
  i += tiff.length;
  bytes[i++] = 0xff;
  bytes[i++] = 0xd9; // EOI

  return bytes;
}

test('exif: reads make, orientation, dimensions, date and gps out of a raw JPEG buffer', () => {
  const raw = readExifMetadata(buildJpegWithExif());
  assert.equal(raw.Make, 'Fuji');
  assert.equal(raw.Orientation, 6);
  assert.equal(raw.DateTimeOriginal, '2023:08:15 19:42:11');
  assert.equal(raw.ImageWidth, 6240);
  assert.equal(raw.ImageHeight, 4160);
  assert.deepEqual(raw.GPSLatitude, [40, 42, 46]);
  assert.equal(raw.GPSLatitudeRef, 'N');
  assert.deepEqual(raw.GPSLongitude, [74, 0, 21]);
  assert.equal(raw.GPSLongitudeRef, 'W');
});

test('exif: the extracted fields normalize correctly end to end', () => {
  const result = normalizeMetadata(readExifMetadata(buildJpegWithExif()));
  assert.equal(result.camera.make, 'Fuji');
  assert.equal(result.camera.model, null);
  assert.equal(result.orientation, 6);
  assert.equal(result.dateTaken, '2023-08-15T19:42:11.000Z');
  assert.deepEqual(result.dimensions, { width: 6240, height: 4160 });
  assert.ok(Math.abs((result.gps?.latitude ?? 0) - 40.712778) < 1e-5);
  assert.ok(Math.abs((result.gps?.longitude ?? 0) - -74.005833) < 1e-5);
});

test('exif: a JPEG with no Exif segment comes back as an empty object', () => {
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // bare SOI + EOI
  assert.deepEqual(readExifMetadata(plain), {});
});

test('exif: non-JPEG input comes back as an empty object rather than throwing', () => {
  assert.deepEqual(readExifMetadata(new Uint8Array([0, 1, 2, 3])), {});
  assert.deepEqual(readExifMetadata(new Uint8Array()), {});
});

test('exif: a truncated/corrupt Exif segment does not throw', () => {
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x08, // APP1, length 8
    0x45, 0x78, 0x69, 0x66, // "Exif" with no trailing nulls or TIFF data
  ]);
  assert.deepEqual(readExifMetadata(bytes), {});
});
