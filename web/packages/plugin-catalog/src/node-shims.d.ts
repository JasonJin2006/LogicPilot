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
  static byteLength(input: string, encoding?: string): number;
  readonly length: number;
}

declare const process: { readonly pid: number };
declare function setTimeout(handler: () => void, timeout: number): unknown;
declare function clearTimeout(handle: unknown): void;

declare const WebAssembly: {
  instantiate(
    bytes: unknown,
    imports: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly instance: { readonly exports: Record<string, unknown> } }>;
};

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
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readFileSync(path: string, encoding?: undefined): Buffer;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function copyFileSync(source: string, destination: string): void;
  export function realpathSync(path: string): string;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function rmdirSync(path: string): void;
  export function writeFileSync(
    path: string,
    data: string,
    options?: 'utf8' | { readonly encoding?: 'utf8'; readonly flag?: string },
  ): void;
  export function appendFileSync(path: string, data: string, encoding?: 'utf8'): void;
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Buffer): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): { readonly href: string };
}

declare module 'node:worker_threads' {
  export class Worker {
    constructor(code: string, options: { readonly eval: boolean; readonly workerData?: unknown });
    once(event: 'message' | 'error', listener: (value: unknown) => void): this;
    postMessage(value: unknown): void;
    terminate(): Promise<number>;
  }
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
