import type { PluginDraft } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import { getAppConfig, sessionHeaders } from '../../../state/appConfig';
import type { AssistantTool } from '../../toolTypes';

async function draftRequest(body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/plugin-drafts`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...sessionHeaders(config),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`plugin draft API returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

function draftArg(args: Record<string, unknown>): PluginDraft | null {
  const checked = validateContract('PluginDraft', args.draft);
  if (!checked.ok || checked.value.status !== 'draft') return null;
  return checked.value;
}

export const PLUGIN_AUTHORING_TOOLS: readonly AssistantTool[] = [
  {
    name: 'list_plugin_drafts',
    executionMode: 'serial',
    description: 'List persisted AI plugin drafts and their static validation reports.',
    parameters: {},
    validate: () => null,
    execute: async () => ({ ok: true, ...(await draftRequest()) }),
  },
  {
    name: 'create_plugin_draft',
    executionMode: 'serial',
    requiresApproval: true,
    description:
      'Create a structured plugin draft for later review. It never installs or changes a trusted plugin.',
    parameters: {
      draft: { type: 'object', required: true },
      summary: { type: 'string', required: true },
    },
    validate: (args) => {
      if (typeof args.summary !== 'string' || args.summary.trim() === '')
        return 'summary must be a non-empty string';
      return draftArg(args) ? null : 'draft must be a valid PluginDraft with status draft';
    },
    execute: async (args) => {
      const draft = draftArg(args);
      if (!draft)
        return { ok: false, error: 'draft must be a valid PluginDraft with status draft' };
      return { ok: true, ...(await draftRequest({ action: 'create', draft })) };
    },
  },
  {
    name: 'validate_plugin_draft',
    executionMode: 'serial',
    description:
      'Run the side-effect-free schema, permission, trust and reference checks on a draft.',
    parameters: { id: { type: 'string', required: true } },
    validate: (args) =>
      typeof args.id === 'string' && args.id.trim() !== '' ? null : 'id must be a non-empty string',
    execute: async (args) => ({
      ok: true,
      ...(await draftRequest({ action: 'validate', id: String(args.id) })),
    }),
  },
];
