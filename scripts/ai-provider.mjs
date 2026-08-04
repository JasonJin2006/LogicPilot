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
valid LogicPilot DSL model for the user's description. Follow the v0 DSL:
model <Name> { resource <R> { capacity = <int> [failure_rate = <f>] }
process <P> { source <S> { arrival = poisson(<rate>) } queue <Q> {
capacity = <int> } service <R> { time = exponential(<rate>) } } }
Do not wrap the model in prose; output the model block only.`;

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
      spec.failureRate = Math.min(Math.max(spec.failureRate, 0.0), 1.0);
      spec.servers = Math.max(1, spec.servers);
    } else if (code === 'LP4001') {
      // service references a resource: generator already names it Server.
    }
  }
  return spec;
}

function renderDsl(spec) {
  const number = (value) =>
      Number.isInteger(value) ? value.toFixed(1) : String(value);
  const failure =
      spec.failureRate > 0.0
          ? `\n    failure_rate = ${number(spec.failureRate)}`
          : '';
  return `// AI-generated queue model (rule-based provider).
model ${spec.model} {
  resource ${spec.resourceName} {
    capacity = ${spec.servers}${failure}
  }

  process Flow {
    source Arrivals {
      arrival = poisson(${number(spec.lambda)})
    }
    queue WaitLine {
      capacity = ${spec.queueCapacity}
    }
    service ${spec.resourceName} {
      time = exponential(${number(spec.mu)})
    }
  }
}
`;
}

export function ruleBasedProvider(prompt, diagnostics = []) {
  return renderDsl(repairSpec(parseSpec(prompt), diagnostics));
}

// ---------------------------------------------------------------------------
// LLM provider (OpenAI-compatible), used only when OPENAI_API_KEY is set.
// ---------------------------------------------------------------------------

function extractDsl(content) {
  const match = content.match(/```(?:logicpilot|dsl)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : content.trim();
}

export async function llmProvider(prompt, diagnostics = [], previousDsl = '') {
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
