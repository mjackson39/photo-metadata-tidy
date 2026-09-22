import type { NormalizedMetadata } from './types.js';

// Namespaces used by the fields this library models. XMP lets you declare
// only the ones you actually use, which keeps the sidecar readable.
const NAMESPACES =
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
  'xmlns:exif="http://ns.adobe.com/exif/1.0/" ' +
  'xmlns:tiff="http://ns.adobe.com/tiff/1.0/"';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function simpleField(tag: string, value: string | number): string {
  return `      <${tag}>${escapeXml(String(value))}</${tag}>\n`;
}

// dc:title, dc:description, and dc:rights are "Lang Alt" properties: a set
// of language-tagged alternatives. We only ever have one value, so it goes
// in under the "x-default" language, which is what readers fall back to.
function langAltField(tag: string, value: string): string {
  return (
    `      <${tag}>\n` +
    `        <rdf:Alt>\n` +
    `          <rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li>\n` +
    `        </rdf:Alt>\n` +
    `      </${tag}>\n`
  );
}

function seqField(tag: string, values: string[]): string {
  const items = values.map((v) => `          <rdf:li>${escapeXml(v)}</rdf:li>`).join('\n');
  return `      <${tag}>\n        <rdf:Seq>\n${items}\n        </rdf:Seq>\n      </${tag}>\n`;
}

function bagField(tag: string, values: string[]): string {
  const items = values.map((v) => `          <rdf:li>${escapeXml(v)}</rdf:li>`).join('\n');
  return `      <${tag}>\n        <rdf:Bag>\n${items}\n        </rdf:Bag>\n      </${tag}>\n`;
}

// XMP represents GPS coordinates as "degrees,minutes.fractionRef" rather
// than the signed-decimal form this library normalizes to, e.g.
// 40.712778 -> "40,42.766680N". positiveRef/negativeRef pick the letter
// pair for the axis (N/S for latitude, E/W for longitude).
function formatGpsCoordinate(decimal: number, positiveRef: string, negativeRef: string): string {
  const ref = decimal < 0 ? negativeRef : positiveRef;
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return `${degrees},${minutes.toFixed(6)}${ref}`;
}

// Renders a normalized record as an XMP packet suitable for writing to a
// ".xmp" sidecar file next to the image it describes. Fields that are null
// (or empty, for keywords) are left out entirely rather than written as
// empty tags, so a sidecar only ever asserts what's actually known.
export function toXmpSidecar(metadata: NormalizedMetadata): string {
  const fields: string[] = [];

  if (metadata.title) fields.push(langAltField('dc:title', metadata.title));
  if (metadata.description) fields.push(langAltField('dc:description', metadata.description));
  if (metadata.copyright) fields.push(langAltField('dc:rights', metadata.copyright));
  if (metadata.artist) fields.push(seqField('dc:creator', [metadata.artist]));
  if (metadata.keywords.length > 0) fields.push(bagField('dc:subject', metadata.keywords));
  if (metadata.dateTaken) {
    fields.push(simpleField('exif:DateTimeOriginal', metadata.dateTaken));
    fields.push(simpleField('xmp:CreateDate', metadata.dateTaken));
  }
  if (metadata.camera.make) fields.push(simpleField('tiff:Make', metadata.camera.make));
  if (metadata.camera.model) fields.push(simpleField('tiff:Model', metadata.camera.model));
  if (metadata.dimensions.width != null) fields.push(simpleField('exif:PixelXDimension', metadata.dimensions.width));
  if (metadata.dimensions.height != null) fields.push(simpleField('exif:PixelYDimension', metadata.dimensions.height));
  if (metadata.orientation != null) fields.push(simpleField('tiff:Orientation', metadata.orientation));
  if (metadata.gps) {
    fields.push(simpleField('exif:GPSLatitude', formatGpsCoordinate(metadata.gps.latitude, 'N', 'S')));
    fields.push(simpleField('exif:GPSLongitude', formatGpsCoordinate(metadata.gps.longitude, 'E', 'W')));
  }

  const description =
    fields.length > 0
      ? `    <rdf:Description rdf:about="" ${NAMESPACES}>\n${fields.join('')}    </rdf:Description>\n`
      : `    <rdf:Description rdf:about="" ${NAMESPACES}/>\n`;

  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    description +
    `  </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>\n`
  );
}
