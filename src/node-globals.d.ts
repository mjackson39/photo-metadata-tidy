// The library itself (normalize.ts, exif.ts, types.ts) is plain ES2020 and
// runs in a browser or Node with no ambient types beyond "lib": ["ES2020"].
// cli.ts is Node-only, and rather than pull in @types/node as a
// dependency for a handful of calls, these are hand-written just for what
// it actually uses.
declare const process: {
  readonly argv: string[];
  exitCode: number | undefined;
  readonly stdout: { write(chunk: string): void };
};

declare const console: {
  log(message: string): void;
  error(message: string): void;
};

declare module 'node:fs' {
  export function readFileSync(path: string | number, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
}

interface ImportMeta {
  readonly url: string;
}
