// LogicPilot DSL VSCode extension (P2): a self-contained LSP client for
// lp-lsp (dsl/lsp). No npm dependencies: speaks Content-Length JSON-RPC
// over stdio, wires diagnostics / completion / hover into the editor.
//
// lp-lsp discovery: $LP_LSP -> <repo>/build/*/dsl/lp-lsp(.exe) -> PATH.
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { dirname, join, basename } = require('node:path');

function findLsp() {
  if (process.env.LP_LSP && existsSync(process.env.LP_LSP)) {
    return process.env.LP_LSP;
  }
  const exe = process.platform === 'win32' ? 'lp-lsp.exe' : 'lp-lsp';
  const here = dirname(__dirname);
  const buildDir = join(here, 'build');
  if (existsSync(buildDir)) {
    for (const child of require('node:fs').readdirSync(buildDir)) {
      const candidate = join(buildDir, child, 'dsl', exe);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return exe;
}

function frame(payload) {
  return Buffer.concat([
    Buffer.from(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`, 'utf8'),
    Buffer.from(payload, 'utf8'),
  ]);
}

class LspClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
  }

  start(lspPath) {
    this.child = spawn(lspPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (chunk) =>
      console.error('[lp-lsp]', chunk.toString('utf8')),
    );
    this.child.on('exit', (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`lp-lsp exited (${code})`));
      }
      this.pending.clear();
    });
    this.child.on('error', (error) =>
      vscode.window.showErrorMessage(`lp-lsp failed to start: ${error.message}`),
    );
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /^Content-Length: (\d+)$/.exec(header);
      if (!match) return;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer
        .subarray(bodyStart, bodyStart + length)
        .toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      const message = JSON.parse(body);
      if (message.method === 'textDocument/publishDiagnostics') {
        this.onDiagnostics(message.params);
      } else if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve } = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve(message);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  send(message) {
    this.child.stdin.write(frame(JSON.stringify(message)));
  }
}

function uriOf(document) {
  return document.uri.toString();
}

function diagnosticFromLsp(d) {
  return new vscode.Diagnostic(
    new vscode.Range(
      d.range.start.line,
      d.range.start.character,
      d.range.end.line,
      d.range.end.character,
    ),
    `${d.code}: ${d.message}`,
    d.severity === 2
      ? vscode.DiagnosticSeverity.Warning
      : d.severity === 3
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Error,
  );
}

function activate(context) {
  const client = new LspClient();
  client.start(findLsp());
  client.notify('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
  });
  client.notify('initialized', {});

  const diagnostics = vscode.languages.createDiagnosticCollection('logicpilot');
  context.subscriptions.push(diagnostics);
  client.onDiagnostics = (params) => {
    const uri = vscode.Uri.parse(params.uri);
    diagnostics.set(
      uri,
      params.diagnostics.map((d) => diagnosticFromLsp(d)),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'logicpilot') {
        client.notify('textDocument/didOpen', {
          textDocument: { uri: uriOf(document), text: document.getText() },
        });
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'logicpilot') {
        client.notify('textDocument/didChange', {
          textDocument: { uri: uriOf(event.document) },
          contentChanges: [{ text: event.document.getText() }],
        });
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === 'logicpilot') {
        client.notify('textDocument/didClose', {
          textDocument: { uri: uriOf(document) },
        });
      }
    }),
  );

  // Open documents already present when the extension activates.
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'logicpilot') {
      client.notify('textDocument/didOpen', {
        textDocument: { uri: uriOf(document), text: document.getText() },
      });
    }
  }

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'logicpilot',
      {
        async provideCompletionItems(document, position) {
          const response = await client.request('textDocument/completion', {
            textDocument: { uri: uriOf(document) },
            position: { line: position.line, character: position.character },
          });
          const items = response.result?.items ?? [];
          return items.map((item) => {
            const completion = new vscode.CompletionItem(
              item.label,
              vscode.CompletionItemKind.Keyword,
            );
            completion.detail = item.detail;
            return completion;
          });
        },
      },
      ...'abcdefghijklmnopqrstuvwxyz_',
    ),
    vscode.languages.registerHoverProvider('logicpilot', {
      async provideHover(document, position) {
        const response = await client.request('textDocument/hover', {
          textDocument: { uri: uriOf(document) },
          position: { line: position.line, character: position.character },
        });
        const contents = response.result?.contents;
        if (!contents) {
          return null;
        }
        const value =
          typeof contents === 'string' ? contents : contents.value;
        return new vscode.Hover(new vscode.MarkdownString(value));
      },
    }),
  );

  context.subscriptions.push({
    dispose() {
      client.notify('shutdown', {});
      client.notify('exit', {});
      client.child.kill();
    },
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
