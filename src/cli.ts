#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeMetadata } from './normalize.js';
import type { NormalizedMetadata, RawMetadata } from './types.js';

export interface CliOptions {
  input?: string;
  output?: string;
  help: boolean;
}

const USAGE = `Usage: photo-metadata-tidy [input.json] [-o output.json]

Normalizes exiftool's "-json" output (or any JSON array/object of loose
metadata records) into this library's fixed shape.

With no input path, reads from stdin. With no -o/--output, writes to stdout.

  -o, --output <path>  write the result to a file instead of stdout
  -h, --help            show this message
`;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-o' || arg === '--output') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a path`);
      options.output = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognized option: ${arg}`);
    } else if (options.input !== undefined) {
      throw new Error('only one input path can be given');
    } else {
      options.input = arg;
    }
  }
  return options;
}

// A batch entry keeps exiftool's SourceFile (renamed to camelCase, matching
// the rest of this library's output) so normalized records can be matched
// back to the file each one came from.
export type BatchResult = NormalizedMetadata & { sourceFile?: string };

export function normalizeBatch(parsed: unknown): BatchResult[] {
  const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return records.map((record) => {
    const raw: RawMetadata = typeof record === 'object' && record !== null ? (record as RawMetadata) : {};
    const normalized = normalizeMetadata(raw);
    const sourceFile = typeof raw.SourceFile === 'string' ? raw.SourceFile : undefined;
    return sourceFile ? { sourceFile, ...normalized } : normalized;
  });
}

function readInput(path: string | undefined): string {
  return readFileSync(path ?? 0, 'utf8');
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`photo-metadata-tidy: ${(err as Error).message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  let text: string;
  try {
    text = readInput(options.input);
  } catch (err) {
    console.error(`photo-metadata-tidy: could not read input (${(err as Error).message})`);
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(`photo-metadata-tidy: could not parse input as JSON (${(err as Error).message})`);
    process.exitCode = 1;
    return;
  }

  const output = JSON.stringify(normalizeBatch(parsed), null, 2) + '\n';

  if (options.output) {
    try {
      writeFileSync(options.output, output);
    } catch (err) {
      console.error(`photo-metadata-tidy: could not write output (${(err as Error).message})`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(output);
  }
}

// Only run as a CLI when this file is the actual entry point, so tests can
// import parseArgs/normalizeBatch without triggering stdin reads or exits.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
