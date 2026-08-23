// Minimal OpenAI-compatible mock for browser verification: /v1/models plus
// /v1/chat/completions in stream or JSON mode, streaming a short Chinese
// reply chunk by chunk. No dependencies; run `node scripts/mock-llm-provider.mjs`.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9191);
const DELAY = Number(process.env.MOCK_LLM_DELAY ?? 250);
const REPLY = 'Streamed reply: this is chunked output from the mock model.';

function writeChunks(res, body) {
  const { stream, max_tokens: maxTokens } = body;
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: randomUUID(),
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: REPLY },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (delta, finish) =>
    res.write(
      `data: ${JSON.stringify({
        id: randomUUID(),
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      })}\n\n`,
    );
  send({ role: 'assistant' });
  const parts = ['Streamed reply:', 'this is chunked output', 'from the mock model.'];
  let index = 0;
  const tick = () => {
    if (index < parts.length) {
      send({ content: parts[index] });
      index += 1;
      setTimeout(tick, DELAY);
    } else {
      send({}, 'stop');
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
  setTimeout(tick, 40);
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }] }));
      return;
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      try {
        const parsed = JSON.parse(body || '{}');
        if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'missing messages' } }));
          return;
        }
        writeChunks(res, parsed);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad json' } }));
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `no route ${req.method} ${req.url}` } }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LLM provider listening on http://127.0.0.1:${PORT}/v1`);
});
