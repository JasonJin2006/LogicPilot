// Structured AI modeling tool: natural language + inspected editor model ->
// ModelPatch v1. The offline provider covers deterministic CI and common DES
// edits; an OpenAI-compatible provider uses a function tool when configured.

const PATCH_TOOL = {
  type: 'function',
  function: {
    name: 'propose_model_patch',
    description: 'Propose a minimal LogicPilot ModelPatch v1 without changing the model.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'operations'],
      properties: {
        version: { type: 'integer', enum: [1] },
        operations: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            required: ['op'],
            properties: {
              op: {
                type: 'string',
                enum: [
                  'add_block', 'update_block', 'remove_block',
                  'connect', 'disconnect', 'rename_model',
                ],
              },
              kind: { type: 'string' },
              name: { type: 'string' },
              target: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              fromPort: { type: 'string' },
              toPort: { type: 'string' },
              edge: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              library: { type: 'string' },
              container: { type: 'string' },
              params: { type: 'object' },
              removeParams: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

const ALLOWED_OPERATIONS = new Set([
  'add_block', 'update_block', 'remove_block',
  'connect', 'disconnect', 'rename_model',
]);

function validModel(model) {
  return model !== null && typeof model === 'object' &&
      typeof model.name === 'string' && Array.isArray(model.nodes) &&
      Array.isArray(model.edges) && model.nodes.length <= 10_000 &&
      model.edges.length <= 50_000;
}

function validParams(params) {
  return params === undefined ||
      (params !== null && typeof params === 'object' && !Array.isArray(params) &&
       Object.values(params).every((value) =>
         typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'));
}

export function validateModelPatch(patch) {
  if (patch?.version !== 1 || !Array.isArray(patch.operations) ||
      patch.operations.length > 100) {
    throw new Error('AI returned an invalid ModelPatch envelope');
  }
  for (const operation of patch.operations) {
    if (operation === null || typeof operation !== 'object' ||
        !ALLOWED_OPERATIONS.has(operation.op)) {
      throw new Error('AI returned an unsupported ModelPatch operation');
    }
    const string = (name) => typeof operation[name] === 'string' && operation[name].trim() !== '';
    if (operation.op === 'add_block' && (!string('kind') || !string('name') || !validParams(operation.params))) {
      throw new Error('AI returned a malformed add_block operation');
    }
    if (operation.op === 'update_block' &&
        (!string('target') || !validParams(operation.params) ||
         (operation.removeParams !== undefined &&
          (!Array.isArray(operation.removeParams) ||
           !operation.removeParams.every((name) => typeof name === 'string'))))) {
      throw new Error('AI returned a malformed update_block operation');
    }
    if (operation.op === 'remove_block' && !string('target')) {
      throw new Error('AI returned a malformed remove_block operation');
    }
    if (operation.op === 'connect' && (!string('from') || !string('to'))) {
      throw new Error('AI returned a malformed connect operation');
    }
    if (operation.op === 'disconnect' &&
        !string('edge') && !string('from') && !string('to')) {
      throw new Error('AI returned a malformed disconnect operation');
    }
    if (operation.op === 'rename_model' && !string('name')) {
      throw new Error('AI returned a malformed rename_model operation');
    }
  }
  return patch;
}

function numberFrom(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number.parseFloat(match[1]);
  }
  return null;
}

function namedNode(model, name) {
  const clean = String(name ?? '').trim().toLowerCase();
  return model.nodes.find((node) => String(node?.name ?? '').toLowerCase() === clean);
}

function selectedNode(model, kind, prompt) {
  const candidates = model.nodes.filter((node) => node?.kind === kind);
  if (candidates.length === 1) return candidates[0];
  const text = prompt.toLowerCase();
  const mentioned = candidates.filter((node) =>
    String(node?.name ?? '').trim() !== '' && text.includes(String(node.name).toLowerCase()));
  return mentioned.length === 1 ? mentioned[0] : null;
}

function updateOperation(model, kind, params, prompt) {
  const node = selectedNode(model, kind, prompt);
  return node ? { op: 'update_block', target: node.id, params } : null;
}

function ruleBasedPatch(prompt, model) {
  const text = prompt.toLowerCase();
  const decimal = '(\\d+(?:\\.\\d+)?)';
  const operations = [];
  const add = prompt.match(/(?:add|create)\s+(?:a\s+)?(source|queue|service|sink|resource|delay)\s+([a-z_][a-z0-9_]*)/i);
  const addKind = add?.[1].toLowerCase() ?? null;
  const addParams = {};
  const fields = [
    {
      kind: 'queue',
      key: 'capacity',
      value: numberFrom(text, [
        new RegExp(`(?:queue capacity|capacity of (?:the )?queue|队列容量)[^\\d]{0,20}${decimal}`),
      ]),
      render: (value) => Math.max(0, Math.floor(value)),
    },
    {
      kind: 'resource',
      key: 'capacity',
      value: numberFrom(text, [
        new RegExp(`(?:servers?|resource capacity|capacity of (?:the )?resource|服务器(?:数量|容量)?|资源容量)[^\\d]{0,20}${decimal}`),
      ]),
      render: (value) => Math.max(1, Math.floor(value)),
    },
    {
      kind: 'source',
      key: 'arrival',
      value: numberFrom(text, [new RegExp(`(?:arrival rate|lambda|到达率)[^\\d]{0,20}${decimal}`)]),
      render: (value) => `rate(${Math.max(0.000001, value)})`,
    },
    {
      kind: 'service',
      key: 'time',
      value: numberFrom(text, [new RegExp(`(?:service rate|service_rate|mu|服务率)[^\\d]{0,20}${decimal}`)]),
      render: (value) => `exponential(${Math.max(0.000001, value)})`,
    },
    {
      kind: 'resource',
      key: 'failure_rate',
      value: numberFrom(text, [new RegExp(`(?:failure rate|故障率)[^\\d]{0,20}${decimal}`)]),
      render: (value) => Math.max(0, value),
    },
  ];
  for (const field of fields) {
    if (field.value === null || !Number.isFinite(field.value)) continue;
    if (field.kind === addKind) {
      addParams[field.key] = field.render(field.value);
      continue;
    }
    const operation = updateOperation(model, field.kind, {
      [field.key]: field.render(field.value),
    }, prompt);
    if (operation) operations.push(operation);
  }
  if ((addKind === 'queue' || addKind === 'resource') && addParams.capacity === undefined) {
    const capacity = numberFrom(text, [
      new RegExp(`(?:with\s+)?capacity[^\\d]{0,12}${decimal}`),
      new RegExp(`${decimal}[^\\d]{0,8}(?:servers?|slots?|台服务器)`),
    ]);
    if (capacity !== null) {
      addParams.capacity = addKind === 'resource'
        ? Math.max(1, Math.floor(capacity))
        : Math.max(0, Math.floor(capacity));
    }
  }

  const remove = text.match(/(?:remove|delete)\s+(?:block\s+)?([a-z_][a-z0-9_]*)|删除\s*([\p{L}_][\p{L}\p{N}_]*)/u);
  if (remove) {
    const node = namedNode(model, remove[1] ?? remove[2]);
    if (node) operations.push({ op: 'remove_block', target: node.id });
  }

  if (add && !namedNode(model, add[2])) {
    if (addKind === 'service') {
      const resource = selectedNode(model, 'resource', prompt);
      if (resource) addParams.resource = resource.name;
    }
    operations.push({
      op: 'add_block',
      kind: addKind,
      name: add[2],
      ...(Object.keys(addParams).length > 0 ? { params: addParams } : {}),
    });
  }

  const disconnect = prompt.match(/(?:disconnect|unlink)\s+([a-z_][a-z0-9_]*)\s+(?:from|to|->)\s+([a-z_][a-z0-9_]*)|断开\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:到|至|->)\s*([\p{L}_][\p{L}\p{N}_]*)/iu);
  if (disconnect) {
    const first = namedNode(model, disconnect[1] ?? disconnect[3]);
    const second = namedNode(model, disconnect[2] ?? disconnect[4]);
    if (first && second) {
      const edge = model.edges.find((candidate) =>
        (candidate.from === first.id && candidate.to === second.id) ||
        (candidate.from === second.id && candidate.to === first.id));
      if (edge) operations.push({ op: 'disconnect', edge: edge.id });
    }
  }

  const connect = prompt.match(/(?:connect|link)\s+([a-z_][a-z0-9_]*)\s+(?:to|->)\s+([a-z_][a-z0-9_]*)|连接\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:到|至|->)\s*([\p{L}_][\p{L}\p{N}_]*)/iu);
  if (connect) {
    const fromName = connect[1] ?? connect[3];
    const toName = connect[2] ?? connect[4];
    const from = namedNode(model, fromName);
    const to = namedNode(model, toName);
    const addedNames = new Set(
      operations.filter((operation) => operation.op === 'add_block').map((operation) => operation.name),
    );
    const fromTarget = from?.id ?? (addedNames.has(fromName) ? fromName : null);
    const toTarget = to?.id ?? (addedNames.has(toName) ? toName : null);
    if (fromTarget && toTarget) operations.push({ op: 'connect', from: fromTarget, to: toTarget });
  }

  const rename = prompt.match(/(?:rename model to|模型重命名为)\s*([\p{L}_][\p{L}\p{N}_]*)/iu);
  if (rename) operations.push({ op: 'rename_model', name: rename[1] });

  return { version: 1, operations };
}

function recentPatch(history) {
  if (!Array.isArray(history)) return null;
  for (let index = history.length - 1; index >= 0; --index) {
    const patch = history[index]?.patch;
    if (patch?.version === 1 && Array.isArray(patch.operations)) return patch;
  }
  return null;
}

function followupPatch(prompt, model, history) {
  const previous = recentPatch(history);
  if (!previous) return { version: 1, operations: [] };
  const text = prompt.toLowerCase();
  const operations = [...previous.operations].reverse();
  const number = text.match(/(?:\bit\b|instead|again|改成|改为|再|它)[^\d]{0,12}(\d+(?:\.\d+)?)/u);
  if (number) {
    const update = operations.find((operation) =>
      operation.op === 'update_block' && Object.keys(operation.params ?? {}).length === 1);
    const targetNode = update
      ? model.nodes.find((node) => node.id === update.target)
      : null;
    if (update && targetNode) {
      const [key, oldValue] = Object.entries(update.params)[0];
      const raw = Number.parseFloat(number[1]);
      let value = raw;
      if (key === 'capacity' || key === 'queueCapacity' || key === 'numberOfUnits') {
        const minimum = key === 'capacity' && targetNode.kind !== 'resource' ? 0 : 1;
        value = Math.max(minimum, Math.floor(raw));
      } else if (typeof oldValue === 'string' && /^rate\(/.test(oldValue)) {
        value = `rate(${Math.max(0.000001, raw)})`;
      } else if (typeof oldValue === 'string' && /^exponential\(/.test(oldValue)) {
        value = `exponential(${Math.max(0.000001, raw)})`;
      }
      return {
        version: 1,
        operations: [{ op: 'update_block', target: update.target, params: { [key]: value } }],
      };
    }
  }

  const added = operations.find((operation) => operation.op === 'add_block');
  const addedNode = added ? namedNode(model, added.name) : null;
  if (addedNode && /(?:remove|delete)\s+it|删除它/u.test(text)) {
    return { version: 1, operations: [{ op: 'remove_block', target: addedNode.id }] };
  }
  const connect = prompt.match(/(?:connect|link)\s+it\s+(?:to|->)\s+([a-z_][a-z0-9_]*)|把它连接到\s*([\p{L}_][\p{L}\p{N}_]*)/iu);
  if (addedNode && connect) {
    const to = namedNode(model, connect[1] ?? connect[2]);
    if (to) return { version: 1, operations: [{ op: 'connect', from: addedNode.id, to: to.id }] };
  }
  return { version: 1, operations: [] };
}

async function llmPatch(prompt, model, history) {
  const apiKey = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const llmModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: llmModel,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
              'You edit LogicPilot DES models only through ModelPatch v1. ' +
              'Use stable node ids from the inspected model. Return the smallest patch and preserve unrelated content.',
        },
        {
          role: 'user',
          content:
              `${prompt}\n\nInspected model JSON:\n${JSON.stringify(model)}` +
              `\n\nRecent applied tool history:\n${JSON.stringify(history.slice(-10))}`,
        },
      ],
      tools: [PATCH_TOOL],
      tool_choice: { type: 'function', function: { name: 'propose_model_patch' } },
    }),
  });
  if (!response.ok) throw new Error(`LLM patch request failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== 'string') throw new Error('LLM did not call propose_model_patch');
  return JSON.parse(args);
}

export async function proposeModelPatch({ prompt, model, history = [] }) {
  if (!String(prompt ?? '').trim()) throw new Error('missing prompt');
  if (!validModel(model)) throw new Error('invalid inspected model');
  let patch;
  if (process.env.OPENAI_API_KEY) {
    patch = await llmPatch(String(prompt), model, Array.isArray(history) ? history : []);
  } else {
    patch = ruleBasedPatch(String(prompt), model);
    if (patch.operations.length === 0) {
      patch = followupPatch(String(prompt), model, history);
    }
  }
  return {
    ok: true,
    supported: patch.operations.length > 0,
    provider: process.env.OPENAI_API_KEY ? 'llm' : 'rule-based',
    patch: validateModelPatch(patch),
  };
}
