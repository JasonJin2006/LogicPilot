// Minimal ambient Node typings for the plugin-catalog scanner (Phase 2B-1).
//
// The repo intentionally keeps @types/node OUT of the workspace: the IDE and
// the host packages compile against DOM/ES2022 only, and vitest peer-links
// @types/node into every dev dependency once the package exists anywhere in
// the tree, which silently changes global typing (setTimeout, node:fs ...)
// in unrelated packages. This shim covers exactly the Node API surface this
// package uses; runtime behavior is exercised by the real-filesystem tests.

declare class Buffer {
  static from(input: string, encoding?: string): Buffer;
  readonly length: number;
}

declare class URL {
  constructor(input: string, base?: string);
  readonly searchParams: { get(name: string): string | null };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
}

declare module 'node:fs' {
  export interface Dirent {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    readonly size: number;
  }
  export function existsSync(path: string): boolean;
  export function lstatSync(path: string): Stats;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding?: undefined): Buffer;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function realpathSync(path: string): string;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Buffer): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}

declare module 'node:http' {
  export interface IncomingMessage {
    readonly method?: string;
    readonly url?: string;
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  }
}
