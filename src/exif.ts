import type { RawMetadata } from './types.js';

// Tag IDs from the TIFF/Exif spec (https://exiftool.org/TagNames/EXIF.html).
// IFD0 holds the "primary" tags; DateTimeOriginal and pixel dimensions live
// in the Exif sub-IFD, and GPS fields live in their own sub-IFD. Both are
// reached via a pointer tag in IFD0.
const IFD0_TAGS = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  ORIENTATION: 0x0112,
  IMAGE_WIDTH: 0x0100,
  IMAGE_HEIGHT: 0x0101,
  IMAGE_DESCRIPTION: 0x010e,
  ARTIST: 0x013b,
  COPYRIGHT: 0x8298,
  EXIF_IFD_POINTER: 0x8769,
  GPS_IFD_POINTER: 0x8825,
};

const EXIF_TAGS = {
  DATE_TIME_ORIGINAL: 0x9003,
  PIXEL_X_DIMENSION: 0xa002,
  PIXEL_Y_DIMENSION: 0xa003,
};

const GPS_TAGS = {
  LATITUDE_REF: 0x0001,
  LATITUDE: 0x0002,
  LONGITUDE_REF: 0x0003,
  LONGITUDE: 0x0004,
};

// Byte width of a single value of each TIFF field type.
function typeSize(type: number): number {
  switch (type) {
    case 1: // BYTE
    case 2: // ASCII
    case 6: // SBYTE
    case 7: // UNDEFINED
      return 1;
    case 3: // SHORT
    case 8: // SSHORT
      return 2;
    case 4: // LONG
    case 9: // SLONG
    case 11: // FLOAT
      return 4;
    case 5: // RATIONAL
    case 10: // SRATIONAL
    case 12: // DOUBLE
      return 8;
    default:
      return 1;
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

function readIfdValue(view: DataView, type: number, count: number, dataOffset: number, le: boolean): unknown {
  switch (type) {
    case 2: // ASCII
      return readAscii(view, dataOffset, count);
    case 3: { // SHORT
      if (count === 1) return view.getUint16(dataOffset, le);
      const values: number[] = [];
      for (let i = 0; i < count; i++) values.push(view.getUint16(dataOffset + i * 2, le));
      return values;
    }
    case 4: { // LONG
      if (count === 1) return view.getUint32(dataOffset, le);
      const values: number[] = [];
      for (let i = 0; i < count; i++) values.push(view.getUint32(dataOffset + i * 4, le));
      return values;
    }
    case 5: { // RATIONAL
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const num = view.getUint32(dataOffset + i * 8, le);
        const den = view.getUint32(dataOffset + i * 8 + 4, le);
        values.push(den === 0 ? 0 : num / den);
      }
      return count === 1 ? values[0] : values;
    }
    default:
      return undefined;
  }
}

// Reads one IFD's entries into a tag -> value map. Values small enough to
// fit in the 4-byte value slot are read inline; larger ones (strings,
// rational triples) are read from their pointed-to offset.
function readIfd(view: DataView, tiffStart: number, ifdOffset: number, le: boolean): Map<number, unknown> {
  const entries = new Map<number, unknown>();
  const count = view.getUint16(ifdOffset, le);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, le);
    const type = view.getUint16(entryOffset + 2, le);
    const numValues = view.getUint32(entryOffset + 4, le);
    const size = typeSize(type) * numValues;
    const dataOffset = size <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, le);
    const value = readIfdValue(view, type, numValues, dataOffset, le);
    if (value !== undefined) entries.set(tag, value);
  }
  return entries;
}

function asciiString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\0+$/, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTiff(view: DataView, tiffStart: number): RawMetadata {
  const byteOrder = view.getUint16(tiffStart, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return {};
  const le = byteOrder === 0x4949;
  if (view.getUint16(tiffStart + 2, le) !== 42) return {};

  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, le);
  const ifd0 = readIfd(view, tiffStart, ifd0Offset, le);
  const result: RawMetadata = {};

  const make = asciiString(ifd0.get(IFD0_TAGS.MAKE));
  if (make) result.Make = make;
  const model = asciiString(ifd0.get(IFD0_TAGS.MODEL));
  if (model) result.Model = model;
  const orientation = ifd0.get(IFD0_TAGS.ORIENTATION);
  if (typeof orientation === 'number') result.Orientation = orientation;
  const description = asciiString(ifd0.get(IFD0_TAGS.IMAGE_DESCRIPTION));
  if (description) result.ImageDescription = description;
  const artist = asciiString(ifd0.get(IFD0_TAGS.ARTIST));
  if (artist) result.Artist = artist;
  const copyright = asciiString(ifd0.get(IFD0_TAGS.COPYRIGHT));
  if (copyright) result.Copyright = copyright;
  const width = ifd0.get(IFD0_TAGS.IMAGE_WIDTH);
  if (typeof width === 'number') result.ImageWidth = width;
  const height = ifd0.get(IFD0_TAGS.IMAGE_HEIGHT);
  if (typeof height === 'number') result.ImageHeight = height;

  const exifIfdOffset = ifd0.get(IFD0_TAGS.EXIF_IFD_POINTER);
  if (typeof exifIfdOffset === 'number') {
    const exifIfd = readIfd(view, tiffStart, tiffStart + exifIfdOffset, le);
    const dateTimeOriginal = asciiString(exifIfd.get(EXIF_TAGS.DATE_TIME_ORIGINAL));
    if (dateTimeOriginal) result.DateTimeOriginal = dateTimeOriginal;
    // The Exif sub-IFD's pixel dimensions describe the decoded image and
    // are more reliable than IFD0's ImageWidth/ImageHeight, which many
    // JPEG encoders leave unset or stale, so they take precedence.
    const pixelX = exifIfd.get(EXIF_TAGS.PIXEL_X_DIMENSION);
    if (typeof pixelX === 'number') result.ImageWidth = pixelX;
    const pixelY = exifIfd.get(EXIF_TAGS.PIXEL_Y_DIMENSION);
    if (typeof pixelY === 'number') result.ImageHeight = pixelY;
  }

  const gpsIfdOffset = ifd0.get(IFD0_TAGS.GPS_IFD_POINTER);
  if (typeof gpsIfdOffset === 'number') {
    const gpsIfd = readIfd(view, tiffStart, tiffStart + gpsIfdOffset, le);
    const latRef = asciiString(gpsIfd.get(GPS_TAGS.LATITUDE_REF));
    if (latRef) result.GPSLatitudeRef = latRef;
    const lat = gpsIfd.get(GPS_TAGS.LATITUDE);
    if (Array.isArray(lat)) result.GPSLatitude = lat;
    const lonRef = asciiString(gpsIfd.get(GPS_TAGS.LONGITUDE_REF));
    if (lonRef) result.GPSLongitudeRef = lonRef;
    const lon = gpsIfd.get(GPS_TAGS.LONGITUDE);
    if (Array.isArray(lon)) result.GPSLongitude = lon;
  }

  return result;
}

function parseJpegExif(bytes: Uint8Array): RawMetadata {
  if (bytes.length < 4) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return {};

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    // TEM and the standalone RSTn/SOI/EOI markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan: entropy-coded data follows, no more markers here
    const length = view.getUint16(offset + 2, false);
    if (marker === 0xe1) {
      const segmentStart = offset + 4;
      const isExif =
        segmentStart + 6 <= bytes.length &&
        view.getUint8(segmentStart) === 0x45 && // E
        view.getUint8(segmentStart + 1) === 0x78 && // x
        view.getUint8(segmentStart + 2) === 0x69 && // i
        view.getUint8(segmentStart + 3) === 0x66 && // f
        view.getUint8(segmentStart + 4) === 0x00 &&
        view.getUint8(segmentStart + 5) === 0x00;
      if (isExif) return parseTiff(view, segmentStart + 6);
    }
    offset += 2 + length;
  }
  return {};
}

// Extracts the tags this library knows how to normalize from a raw JPEG
// buffer's APP1/Exif segment, in the same field-name shape `normalizeMetadata`
// expects from `exiftool -json`. Malformed or non-JPEG input, or a JPEG with
// no Exif segment, comes back as `{}` rather than throwing.
export function readExifMetadata(bytes: Uint8Array): RawMetadata {
  try {
    return parseJpegExif(bytes);
  } catch {
    return {};
  }
}
