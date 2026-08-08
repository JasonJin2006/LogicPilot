// AI model-generation providers for the build loop (scripts/ai-build.mjs).
//
// A provider turns a natural-language prompt (plus the compiler's structured
// JSON diagnostics from the previous attempt, if any) into LogicPilot DSL.
//
//   ruleBasedProvider - deterministic keyword/number extractor + diagnostic
//                       repair. Offline, used by CI/tests.
//   llmProvider       - OpenAI-compatible chat completion when
//                       OPENAI_API_KEY is set (OPENAI_BASE_URL / OPENAI_MODEL
//                       overridable). Fenced ```logicpilot blocks are
//                       extracted; bare text is used as-is.

const SYSTEM_PROMPT = `You are the LogicPilot model generator. Produce ONLY a
valid LogicPilot DSL model for the user's description. Follow the v2 DSL
(thin core grammar + flat process-library blocks):
model <Name> {
  use process
  resource <R> { capacity = <int> }
  source <S> { arrival = rate(<rate>) }
  queue <Q> { capacity = <int> }
  service <Work> { resource = <R> time = exponential(<rate>) }
  sink <Done> { }
  couple <S>.out -> <Q>.in
  couple <Q>.out -> <Work>.in
  couple <Work>.out -> <Done>.in
}
When a current model is supplied, preserve unrelated blocks, couplings, names,
and properties. Do not wrap the model in prose; output the model block only.`;

// ---------------------------------------------------------------------------
// Rule-based provider
// ---------------------------------------------------------------------------

function parseSpec(prompt) {
  const text = prompt.toLowerCase();
  const number = (re) => {
    const match = text.match(re);
    return match ? Number.parseFloat(match[1]) : null;
  };
  const spec = {
    model: 'AIQueue',
    resourceName: 'Server',
    servers: number(/(\d+)\s*(?:servers?|machines?)/) ??
        number(/(?:machine|resource|server)[^\d]{0,12}capacity[^\d]{0,12}(\d+)/) ?? 1,
    queueCapacity:
        number(/queue[^\d]{0,12}capacity[^\d]{0,12}(\d+)/) ?? 1_000_000,
    lambda: number(/(?:arrival|lambda)[^\d]{0,12}(\d+(?:\.\d+)?)/) ??
        number(/poisson\s*\(\s*(\d+(?:\.\d+)?)/) ?? 0.8,
    mu: number(/(?:service|service_rate|mu)[^\d]{0,12}(\d+(?:\.\d+)?)/) ??
        number(/exponential\s*\(\s*(\d+(?:\.\d+)?)/) ?? 1.0,
    failureRate: number(/failure[^\d]{0,12}(\d+(?:\.\d+)?)/) ?? 0.0,
  };
  return spec;
}

// Apply structured diagnostics (LP codes + spans) to the spec: the repair
// half of the loop. Unknown codes are ignored (regeneration is the fallback).
function repairSpec(spec, diagnostics) {
  for (const diagnostic of diagnostics ?? []) {
    const code = diagnostic?.code ?? '';
    const message = diagnostic?.message ?? '';
    if (code === 'LP2001' && /capacity/.test(message)) {
      spec.servers = Math.max(1, spec.servers);
    } else if (code === 'LP2001' && /arrival/.test(message)) {
      spec.lambda = Math.max(0.01, spec.lambda);
    } else if (code === 'LP3001') {
      if (/\btime_advance|exponential/.test(message)) {
        // keep rates positive
      }
      spec.lambda = Math.min(Math.max(spec.lambda, 0.01), 1000);
      spec.mu = Math.min(Math.max(spec.mu, 0.01), 1000);
      spec.failureRate = Math.max(spec.failureRate, 0.0);
      spec.servers = Math.max(1, spec.servers);
    } else if (code === 'LP4001') {
      // service references a resource: generator already names it Server.
    }
  }
  return spec;
}

// Detect DES features the user asked for; each adds/rewires process-library
// blocks so the generated model exercises the corresponding semantics.
function advancedFeatures(prompt) {
  const text = prompt.toLowerCase();
  const features = new Set();
  if (/assembl|parts|kit/.test(text)) features.add('assembly');
  if (/batch|group every|group of|bundle/.test(text)) features.add('batch');
  if (/priorit/.test(text)) features.add('priority');
  if (/seize|held resource|resource-constrained/.test(text)) {
    features.add('seize');
  }
  if (/measur|time in (the )?system|waiting time/.test(text)) {
    features.add('measure');
  }
  if (/timeout/.test(text)) features.add('timeout');
  return features;
}

function renderDsl(spec, features = new Set()) {
  const number = (value) =>
      Number.isInteger(value) ? value.toFixed(1) : String(value);
  const failure =
      spec.failureRate > 0.0
          ? `\n    failure_rate = ${number(spec.failureRate)}`
          : '';
  const source =
      `  source Arrivals {\n    arrival = rate(${number(spec.lambda)})` +
      (features.has('priority')
           ? '\n    state priority: float = 2'
           : '') +
      '\n  }';
  const queueTimeout = features.has('timeout')
      ? '\n    enableTimeout = true\n    timeout = 5.0'
      : '';
  const queue =
      `  queue WaitLine {\n    capacity = ${spec.queueCapacity}` +
      (features.has('priority') ? '\n    queuing = queuing_priority' : '') +
      queueTimeout +
      '\n  }';
  const service =
      features.has('seize')
          ? `  seize Grab {\n    resource = ${spec.resourceName}\n    numberOfUnits = 1\n  }\n  delay Work {\n    delayTime = exponential(${number(spec.mu)})\n    capacity = 1\n  }\n  release Drop {\n  }`
          : `  service Service {\n    resource = ${spec.resourceName}\n    time = exponential(${number(spec.mu)})\n  }`;
  const measure =
      features.has('measure') && !features.has('batch')
          ? '  timeMeasureStart T0 {\n  }\n  timeMeasureEnd T1 {\n  }\n'
          : '';
  const batch =
      features.has('batch')
          ? '  batch Group {\n    batchSize = 2\n    permanent = false\n  }\n  delay BatchWork {\n    delayTime = constant(1.0)\n    capacity = 10\n  }\n  unbatch Split {\n  }\n'
          : '';
  const lateSink = features.has('timeout')
      ? '\n  sink Late { }\n'
      : '';
  const lines = [
    `// AI-generated ${spec.model} model (rule-based provider).`,
    `model ${spec.model} {`,
    `  resource ${spec.resourceName} {`,
    `    capacity = ${spec.servers}${failure}`,
    '  }',
    '',
    source,
    queue,
    batch,
    measure,
    service,
    lateSink,
    '  sink Done { }',
    '',
    '  couple Arrivals.out -> WaitLine.in',
  ];
  if (features.has('batch')) {
    lines.push(
        '  couple WaitLine.out -> Group.in',
        '  couple Group.out -> BatchWork.in',
        '  couple BatchWork.out -> Split.in',
        features.has('seize') ? '  couple Split.out -> Grab.in' :
                                '  couple Split.out -> Service.in',
    );
  } else if (features.has('measure') && !features.has('batch')) {
    lines.push(
        '  couple WaitLine.out -> T0.in',
        '  couple T0.out -> ' + (features.has('seize') ? 'Grab.in' : 'Service.in'),
        '  couple ' + (features.has('seize') ? 'Drop.out' : 'Service.out') +
            ' -> T1.in',
        '  couple T1.out -> Done.in',
    );
  } else {
    lines.push(
        '  couple WaitLine.out -> ' +
            (features.has('seize') ? 'Grab.in' : 'Service.in'),
    );
  }
  if (features.has('seize')) {
    lines.push(
        '  couple Grab.out -> Work.in',
        '  couple Work.out -> Drop.in',
    );
    if (!(features.has('measure') && !features.has('batch'))) {
      lines.push('  couple Drop.out -> Done.in');
    }
  } else if (!(features.has('measure') && !features.has('batch'))) {
    lines.push('  couple Service.out -> Done.in');
  }
  if (features.has('timeout')) {
    lines.push('  couple WaitLine.outTimeout -> Late.in');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function promptNumber(prompt, patterns) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) return Number.parseFloat(match[1]);
  }
  return null;
}

function replaceFirstBlockField(dsl, kind, field, renderedValue) {
  const block = new RegExp(
      `(^[ \\t]*${kind}[ \\t]+[A-Za-z_][A-Za-z0-9_]*[ \\t]*\\{)([\\s\\S]*?)(^[ \\t]*\\})`,
      'm');
  const match = block.exec(dsl);
  if (!match) return null;
  const body = match[2];
  const fieldValue = new RegExp(
      `(\\b${field}[ \\t]*=[ \\t]*)(?:[A-Za-z_][A-Za-z0-9_]*\\([^\\)\\r\\n]*\\)|"[^"\\r\\n]*"|[^\\s}\\r\\n]+)`);
  let nextBody;
  if (fieldValue.test(body)) {
    nextBody = body.replace(fieldValue, `$1${renderedValue}`);
  } else {
    const headerIndent = match[1].match(/^[ \\t]*/)?.[0] ?? '';
    nextBody = `${body}${headerIndent}  ${field} = ${renderedValue}\n`;
  }
  return `${dsl.slice(0, match.index)}${match[1]}${nextBody}${match[3]}` +
      dsl.slice(match.index + match[0].length);
}

/** Apply common DES parameter requests without regenerating the model.
 * This is the offline provider's incremental editing path: untouched DSL is
 * retained byte-for-byte, so the editor can derive a small ModelPatch rather
 * than deleting and recreating unrelated canvas content. */
export function updateExistingDsl(prompt, contextDsl) {
  if (!contextDsl.trim()) return null;
  const text = prompt.toLowerCase();
  const decimal = '(\\d+(?:\\.\\d+)?)';
  const edits = [
    {
      kind: 'queue',
      field: 'capacity',
      value: promptNumber(text, [
        new RegExp(`(?:queue capacity|capacity of (?:the )?queue|队列容量)[^\\d]{0,20}${decimal}`),
        new RegExp(`${decimal}[^\\d]{0,8}(?:queue slots?|队列容量)`),
      ]),
      render: (value) => String(Math.max(0, Math.floor(value))),
    },
    {
      kind: 'resource',
      field: 'capacity',
      value: promptNumber(text, [
        new RegExp(`(?:servers?|resource capacity|capacity of (?:the )?resource|服务器(?:数量|容量)?|资源容量)[^\\d]{0,20}${decimal}`),
        new RegExp(`${decimal}[^\\d]{0,8}(?:servers?|machines?|台服务器)`),
      ]),
      render: (value) => String(Math.max(1, Math.floor(value))),
    },
    {
      kind: 'source',
      field: 'arrival',
      value: promptNumber(text, [
        new RegExp(`(?:arrival rate|lambda|到达率)[^\\d]{0,20}${decimal}`),
      ]),
      render: (value) => `rate(${Math.max(0.000001, value)})`,
    },
    {
      kind: 'service',
      field: 'time',
      value: promptNumber(text, [
        new RegExp(`(?:service rate|service_rate|mu|服务率)[^\\d]{0,20}${decimal}`),
      ]),
      render: (value) => `exponential(${Math.max(0.000001, value)})`,
    },
    {
      kind: 'resource',
      field: 'failure_rate',
      value: promptNumber(text, [
        new RegExp(`(?:failure rate|故障率)[^\\d]{0,20}${decimal}`),
      ]),
      render: (value) => String(Math.max(0, value)),
    },
  ];

  let updated = contextDsl;
  let changed = false;
  for (const edit of edits) {
    if (edit.value === null || !Number.isFinite(edit.value)) continue;
    const next = replaceFirstBlockField(updated, edit.kind, edit.field, edit.render(edit.value));
    if (next !== null) {
      updated = next;
      changed = true;
    }
  }
  return changed ? updated : null;
}

export function ruleBasedProvider(prompt, diagnostics = [], previousDsl = '', contextDsl = '') {
  const incremental = updateExistingDsl(prompt, previousDsl || contextDsl);
  if (incremental !== null) return incremental;
  const continuous = continuousDsl(prompt);
  if (continuous) {
    return continuous;
  }
  const features = advancedFeatures(prompt);
  if (features.has('assembly')) {
    return renderAssembler(parseSpec(prompt), diagnostics);
  }
  return renderDsl(repairSpec(parseSpec(prompt), diagnostics), features);
}

// Dedicated assembler template: kit + parts -> assemble -> sink.
function renderAssembler(spec, diagnostics) {
  void diagnostics;
  const number = (value) =>
      Number.isInteger(value) ? value.toFixed(1) : String(value);
  return `// AI-generated assembler model (rule-based provider).
model ${spec.model} {
  resource ${spec.resourceName} {
    capacity = ${spec.servers}
  }

  source Kits {
    arrival = rate(${number(spec.lambda)})
  }
  source Parts {
    arrival = rate(${number(Math.max(spec.lambda * 2, 0.1))})
  }
  assembler Build {
    quantity125 = 2
    delayTime = ${number(spec.mu)}
  }
  sink Done { }

  couple Kits.out -> Build.in
  couple Parts.out -> Build.p1
  couple Build.out -> Done.in
}
`;
}

// Continuous-model generation for ODE prompts (decay / SIR).
function continuousDsl(prompt) {
  const text = prompt.toLowerCase();
  const number = (re) => {
    const match = text.match(re);
    return match ? Number.parseFloat(match[1]) : null;
  };
  if (/sir|epidemic/.test(text)) {
    const beta = number(/(?:beta|infection)[^\d]{0,12}(\d+(?:\.\d+)?)/) ?? 0.5;
    const gamma =
        number(/(?:gamma|recovery)[^\d]{0,12}(\d+(?:\.\d+)?)/) ?? 0.1;
    return `model SIR {
  continuous Dynamics {
    state S = 0.99
    state I = 0.01
    state R = 0.0
    param beta = ${beta}
    param gamma = ${gamma}
    d S/dt = -beta*S*I
    d I/dt = beta*S*I - gamma*I
    d R/dt = gamma*I
  }
}
`;
  }
  if (/decay|continuous|exponential\s*decay/.test(text) ||
      /\bode\b/.test(text) ||
      /d\s*[a-z]\s*\/\s*dt/.test(text)) {
    const k = number(/(?:k|rate|decay)[^\d]{0,12}(\d+(?:\.\d+)?)/) ?? 0.5;
    const y0 = number(/(?:y0|initial)[^\d]{0,12}(\d+(?:\.\d+)?)/) ?? 1.0;
    return `model Decay {
  continuous Dynamics {
    state y = ${y0}
    param k = ${k}
    d y/dt = -k*y
  }
}
`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM provider (OpenAI-compatible), used only when OPENAI_API_KEY is set.
// ---------------------------------------------------------------------------

function extractDsl(content) {
  const match = content.match(/```(?:logicpilot|dsl)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : content.trim();
}

export async function llmProvider(prompt, diagnostics = [], previousDsl = '', contextDsl = '') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('llmProvider requires OPENAI_API_KEY');
  }
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (diagnostics.length > 0) {
    messages.push({
      role: 'user',
      content:
          `The previous attempt failed to compile.\n\nPrevious DSL:\n` +
          `${previousDsl}\n\nCompiler diagnostics (JSON):\n` +
          `${JSON.stringify(diagnostics, null, 2)}\n\n` +
          `Fix the DSL so it compiles.`,
    });
  } else if (contextDsl.trim()) {
    messages.push({
      role: 'user',
      content:
          `${prompt}\n\nCurrent LogicPilot model DSL:\n${contextDsl}\n\n` +
          'Return the complete updated model while preserving unrelated content.',
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return extractDsl(content);
}

export function resolveProvider() {
  return process.env.OPENAI_API_KEY ? llmProvider : ruleBasedProvider;
}
