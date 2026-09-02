declare const process: { readonly pid: number };

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function writeFileSync(
    path: string,
    data: string,
    encoding?: 'utf8' | { readonly encoding?: 'utf8'; readonly flag?: string },
  ): void;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}
