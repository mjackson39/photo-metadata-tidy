// Metadata as it actually arrives: whatever keys and value shapes the
// source (exiftool JSON, a browser EXIF reader, a hand-typed CSV row) used.
export type RawMetadata = Record<string, unknown>;

export interface NormalizedMetadata {
  title: string | null;
  description: string | null;
  // ISO 8601, always UTC. The source rarely tells us the real offset, so we
  // don't pretend to know one.
  dateTaken: string | null;
  camera: {
    make: string | null;
    model: string | null;
  };
  dimensions: {
    width: number | null;
    height: number | null;
  };
  // EXIF orientation code, 1-8. See https://exiftool.org/TagNames/EXIF.html
  orientation: number | null;
  gps: {
    latitude: number;
    longitude: number;
  } | null;
  keywords: string[];
  copyright: string | null;
  artist: string | null;
}
