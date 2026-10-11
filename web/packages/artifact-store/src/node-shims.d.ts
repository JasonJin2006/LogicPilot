declare const process: {
  readonly pid: number;
  readonly platform: string;
  kill(pid: number, signal?: number): void;
};

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function writeFileSync(
    path: string | number,
    data: string,
    encoding?: 'utf8' | { readonly encoding?: 'utf8'; readonly flag?: string },
  ): void;
  export function openSync(path: string, flags: string): number;
  export function closeSync(fd: number): void;
  export function fsyncSync(fd: number): void;
  export function readdirSync(path: string): readonly string[];
  export function statSync(path: string): { readonly mtimeMs: number };
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
  export function randomBytes(size: number): { readonly toString: (encoding: 'hex') => string };
}
