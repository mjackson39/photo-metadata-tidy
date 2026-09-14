# photo-metadata-tidy

Every tool that reads image metadata gives you a slightly different shape
for the same facts. `exiftool -json` calls the capture date
`DateTimeOriginal` and writes it as `2023:08:15 14:30:00`. A browser-side
EXIF reader might call it `dateTimeOriginal` and hand you a `Date` object.
Something that round-tripped through a CSV export might have a column
called `Date Taken` with a plain `08/15/2023` string, or a unix timestamp.
GPS coordinates show up as decimal numbers, `[deg, min, sec]` triples, or
degrees-minutes-seconds strings like `40° 26' 46" N`. Dimensions arrive as
two separate numbers, or one string like `3000x2000`.

None of that is wrong, exactly. It's just inconsistent, and if you're
trying to store or compare metadata from more than one source you end up
writing the same bag of `if (typeof x === 'string')` checks over and over.

This library is that bag of checks, done once. `normalizeMetadata` takes a
loose, untyped record and returns a fixed shape with consistent types:
dates as ISO 8601 strings, coordinates as signed decimal degrees,
dimensions as integers, keywords as a string array.

## Usage

```ts
import { normalizeMetadata } from 'photo-metadata-tidy';

// straight out of `exiftool -json photo.jpg`
const fromExiftool = {
  Title: 'Harbor at dusk',
  DateTimeOriginal: '2023:08:15 19:42:11',
  Make: 'FUJIFILM',
  Model: 'X-T4',
  ImageWidth: 6240,
  ImageHeight: 4160,
  GPSLatitude: '40° 42\' 46" N',
  GPSLongitude: '74° 0\' 21" W',
  Keywords: 'harbor, dusk, long exposure',
  Orientation: 'Rotate 90 CW',
};

normalizeMetadata(fromExiftool);
// {
//   title: 'Harbor at dusk',
//   description: null,
//   dateTaken: '2023-08-15T19:42:11.000Z',
//   camera: { make: 'FUJIFILM', model: 'X-T4' },
//   dimensions: { width: 6240, height: 4160 },
//   orientation: 6,
//   gps: { latitude: 40.712777..., longitude: -74.005833... },
//   keywords: ['harbor', 'dusk', 'long exposure'],
//   copyright: null,
//   artist: null,
// }

// a hand-typed CSV row for the same photo, different field names entirely
const fromSpreadsheet = {
  'Date Taken': '08/15/2023',
  'Camera Model': 'X-T4',
  Size: '6240x4160',
  Tags: ['harbor', 'dusk'],
};

normalizeMetadata(fromSpreadsheet).dimensions; // { width: 6240, height: 4160 }
```

Any field the input doesn't have, or that fails to parse, comes back as
`null` (or `[]` for keywords) rather than throwing. Garbage in one field
never blocks the fields that were fine.

## Reading a JPEG file directly

If you don't have exiftool or a browser EXIF reader in the picture,
`readExifMetadata` pulls the fields this library cares about straight out of
a JPEG buffer's Exif segment, in the same shape `normalizeMetadata` expects:

```ts
import { readFile } from 'node:fs/promises';
import { readExifMetadata, normalizeMetadata } from 'photo-metadata-tidy';

const bytes = await readFile('photo.jpg');
const metadata = normalizeMetadata(readExifMetadata(bytes));
```

It only reads the tags this library normalizes (title/description are
IPTC/XMP concepts with no EXIF equivalent, so those still come back `null`
unless you merge in another source). A JPEG with no Exif segment, or a
buffer that isn't a JPEG at all, comes back as `{}` rather than throwing.

## CLI

`exiftool -json` dumps an array of one object per file, each tagged with a
`SourceFile` field. The bundled CLI reads that array (or a single object)
and writes back an array of normalized records, keeping `sourceFile`
around so you can tell which input each one came from:

```
exiftool -json *.jpg | photo-metadata-tidy > normalized.json
```

Or read from and write to files directly:

```
photo-metadata-tidy exiftool-output.json -o normalized.json
```

With no input path it reads from stdin; with no `-o`/`--output` it writes
to stdout. `photo-metadata-tidy --help` prints the full option list.

## Field matching

Key lookup is case- and separator-insensitive: `DateTimeOriginal`,
`dateTimeOriginal`, `date_time_original`, and `Date Time Original` all
resolve to the same field. Namespaced XMP property names such as
`dc:title` or `photoshop:Headline` are recognized too, since the `:` is
stripped along with everything else. See the alias lists in
`src/normalize.ts` for exactly which source key names are recognized per
field.

## Status

Early. The alias lists cover the exiftool / browser-EXIF / manual-entry
sources I've actually run into, plus the common IPTC-IIM and XMP tag
names for the fields this library models, but not the full IPTC/XMP tag
sets (there's no support yet for structured fields like XMP location
hierarchies or contact info). See the commit history for what's landed.

## Build

```
npm run build
```

No runtime dependencies — this is plain TypeScript compiled with `tsc`.

## Tests

```
npm test
```

Runs the `test/` directory directly against the TypeScript source with
Node's built-in test runner and type stripping, so there's no test
framework in the dependency list either. Requires Node 22.6 or later.

## License

MIT, see [LICENSE](./LICENSE).
