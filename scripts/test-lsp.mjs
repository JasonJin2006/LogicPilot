#!/usr/bin/env node
// CI smoke for lp-lsp (P2): drive the language server over stdio JSON-RPC
// and assert it publishes empty diagnostics for a valid model and
// non-empty LP diagnostics for a broken one.
//
// Usage: node scripts/test-lsp.mjs [--lsp <path>]
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf('--lsp');
const lsp = flag >= 0 ? process.argv[flag + 1] : 'lp-lsp';

function frame(payload) {
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function run() {
  return new Promise((resolve, reject) => {
    const child = spawn(lsp, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = Buffer.alloc(0);
    const received = [];
    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /^Content-Length: (\d+)$/.exec(header);
        if (!match) return;
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const body = buffer
          .subarray(bodyStart, bodyStart + length)
          .toString('utf8');
        buffer = buffer.subarray(bodyStart + length);
        received.push(JSON.parse(body));
      }
    });
    child.on('error', reject);

    const send = (payload) => child.stdin.write(frame(payload));
    const valid = `model M { resource R { capacity = 1 } source A { arrival = rate(1) } service S { resource = R; time = exponential(1) } couple A.out -> S.in }`;
    const broken =
      'model M { resource R { bogus = 1 } }';

    send(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    );
    send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: 'file:///a.lp', text: valid } },
      }),
    );
    send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///a.lp' },
          contentChanges: [{ text: broken }],
        },
      }),
    );
    send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/completion',
        params: { textDocument: { uri: 'file:///a.lp' }, position: { line: 0, character: 0 } },
      }),
    );
    send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown', params: {} }));
    send(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }));
    child.stdin.end();

    child.on('close', () => {
      try {
        const diagnostics = received.filter(
          (message) => message.method === 'textDocument/publishDiagnostics',
        );
        if (diagnostics.length < 2) {
          throw new Error('expected >= 2 publishDiagnostics notifications');
        }
        if (diagnostics[0].params.diagnostics.length !== 0) {
          throw new Error('valid model produced diagnostics');
        }
        const codes = diagnostics[1].params.diagnostics.map((d) => d.code);
        if (!codes.includes('LP2005')) {
          throw new Error(`broken model missed LP2005, got ${codes.join(',')}`);
        }
        const completion = received.find(
          (message) => message.id === 2 && message.result,
        );
        if (!completion || !completion.result.items.some((i) => i.label === 'service')) {
          throw new Error('completion missing the service block');
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

run()
  .then(() => {
    console.log('LSP TEST: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`LSP TEST: FAIL - ${error.message}`);
    process.exit(1);
  });
