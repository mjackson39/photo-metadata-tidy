import type { NormalizedMetadata, RawMetadata } from './types.js';

// Every alias list is checked in order, case- and separator-insensitive
// ("Date Taken" / "date_taken" / "DateTaken" all resolve to "datetaken").
// New sources usually just mean adding one more string to a list here.
const TITLE_KEYS = ['title', 'objectname', 'headline', 'name'];
const DESCRIPTION_KEYS = ['description', 'imagedescription', 'caption', 'captionabstract', 'desc'];
const DATE_KEYS = ['datetaken', 'datetimeoriginal', 'createdate', 'datecreated', 'timestamp', 'date'];
const MAKE_KEYS = ['make', 'cameramake', 'manufacturer'];
const MODEL_KEYS = ['model', 'cameramodel'];
const ORIENTATION_KEYS = ['orientation'];
const KEYWORDS_KEYS = ['keywords', 'tags', 'subject'];
const COPYRIGHT_KEYS = ['copyright', 'rights'];
const ARTIST_KEYS = ['artist', 'creator', 'author', 'photographer'];
const WIDTH_KEYS = ['width', 'imagewidth', 'exifimagewidth', 'pixelwidth'];
const HEIGHT_KEYS = ['height', 'imageheight', 'exifimageheight', 'pixelheight'];
const DIMENSIONS_COMBINED_KEYS = ['dimensions', 'imagesize', 'size'];
const GPS_LAT_KEYS = ['gpslatitude', 'latitude', 'lat'];
const GPS_LAT_REF_KEYS = ['gpslatituderef', 'latituderef'];
const GPS_LON_KEYS = ['gpslongitude', 'longitude', 'lon', 'lng'];
const GPS_LON_REF_KEYS = ['gpslongituderef', 'longituderef'];

const ORIENTATION_LABELS: Record<string, number> = {
  'horizontal (normal)': 1,
  'normal': 1,
  'mirror horizontal': 2,
  'rotate 180': 3,
  'mirror vertical': 4,
  "mirror horizontal and rotate 270 cw": 5,
  'rotate 90 cw': 6,
  'mirror horizontal and rotate 90 cw': 7,
  'rotate 270 cw': 8,
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

function buildLookup(raw: RawMetadata): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) {
    lookup.set(normalizeKey(key), value);
  }
  return lookup;
}

function pick(lookup: Map<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = lookup.get(normalizeKey(alias));
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    // exiftool and browser readers disagree on seconds vs. milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // EXIF's own format: "2023:08:15 14:30:00" (colons in the date part).
    const exifMatch = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (exifMatch) {
      const [, y, mo, d, h, mi, s] = exifMatch;
      const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (/^\d{9,13}$/.test(trimmed)) return parseDate(Number(trimmed));
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function parseDimension(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  if (typeof value === 'string') n = Number(value.trim().replace(/px$/i, ''));
  return n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parseDimensions(lookup: Map<string, unknown>): NormalizedMetadata['dimensions'] {
  const combined = pick(lookup, DIMENSIONS_COMBINED_KEYS);
  if (typeof combined === 'string') {
    const match = combined.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return {
    width: parseDimension(pick(lookup, WIDTH_KEYS)),
    height: parseDimension(pick(lookup, HEIGHT_KEYS)),
  };
}

function applyHemisphere(decimal: number, ref: unknown): number {
  const hemisphere = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  return hemisphere === 'S' || hemisphere === 'W' ? -Math.abs(decimal) : decimal;
}

// Accepts plain decimal degrees, an EXIF-style [deg, min, sec] triple, or a
// "40° 26' 46\" N" degrees-minutes-seconds string.
function parseCoordinate(value: unknown, ref: unknown): number | null {
  if (typeof value === 'number') return applyHemisphere(value, ref);

  if (Array.isArray(value) && value.length === 3) {
    const [deg, min, sec] = value.map(Number);
    if ([deg, min, sec].some((n) => !Number.isFinite(n))) return null;
    return applyHemisphere(deg + min / 60 + sec / 3600, ref);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return applyHemisphere(Number(trimmed), ref);

    const dms = trimmed.match(
      /(\d+(?:\.\d+)?)[°\s]+(\d+(?:\.\d+)?)['\s]+(\d+(?:\.\d+)?)["\s]*([NSEW])?/i,
    );
    if (dms) {
      const [, deg, min, sec, dir] = dms;
      const decimal = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
      return applyHemisphere(decimal, dir ?? ref);
    }
  }

  return null;
}

function parseOrientation(value: unknown): number | null {
  if (typeof value === 'number') return value >= 1 && value <= 8 ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
    return ORIENTATION_LABELS[value.trim().toLowerCase()] ?? null;
  }
  return null;
}

function parseKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeMetadata(raw: RawMetadata): NormalizedMetadata {
  const lookup = buildLookup(raw);

  const latitude = parseCoordinate(pick(lookup, GPS_LAT_KEYS), pick(lookup, GPS_LAT_REF_KEYS));
  const longitude = parseCoordinate(pick(lookup, GPS_LON_KEYS), pick(lookup, GPS_LON_REF_KEYS));

  return {
    title: normalizeString(pick(lookup, TITLE_KEYS)),
    description: normalizeString(pick(lookup, DESCRIPTION_KEYS)),
    dateTaken: parseDate(pick(lookup, DATE_KEYS)),
    camera: {
      make: normalizeString(pick(lookup, MAKE_KEYS)),
      model: normalizeString(pick(lookup, MODEL_KEYS)),
    },
    dimensions: parseDimensions(lookup),
    orientation: parseOrientation(pick(lookup, ORIENTATION_KEYS)),
    gps: latitude != null && longitude != null ? { latitude, longitude } : null,
    keywords: parseKeywords(pick(lookup, KEYWORDS_KEYS)),
    copyright: normalizeString(pick(lookup, COPYRIGHT_KEYS)),
    artist: normalizeString(pick(lookup, ARTIST_KEYS)),
  };
}
