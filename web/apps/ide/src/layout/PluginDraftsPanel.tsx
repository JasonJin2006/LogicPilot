import { useCallback, useEffect, useState } from 'react';
import type { PermissionId } from '@logicpilot/contracts';
import { getAppConfig, sessionHeaders } from '../state/appConfig';

interface DraftRecord {
  readonly id: string;
  readonly basePluginId: string;
  readonly status: 'draft' | 'validated' | 'approved' | 'rejected' | 'published';
  readonly manifest: {
    readonly id: string;
    readonly version: string;
    readonly permissions: readonly PermissionId[];
    readonly trust: { readonly minLevel: string };
  };
  readonly permissionDiff: {
    readonly added: readonly PermissionId[];
    readonly removed: readonly PermissionId[];
    readonly trustEscalation?: boolean;
  };
  readonly diagnostics?: readonly string[];
  readonly validation?: { readonly ok: boolean; readonly diagnostics: readonly string[] };
}

interface DraftsPayload {
  readonly configured: boolean;
  readonly drafts: readonly DraftRecord[];
}

export function PluginDraftsPanel() {
  const [payload, setPayload] = useState<DraftsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, Set<string>>>({});
  const [trustAccepted, setTrustAccepted] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const config = await getAppConfig();
      const response = await fetch(`${config?.apiBase ?? ''}/api/plugin-drafts`, {
        headers: sessionHeaders(config),
        cache: 'no-store',
      });
      const body = (await response.json()) as DraftsPayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setPayload(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const action = async (draft: DraftRecord, operation: Record<string, unknown>) => {
    setBusy(`${draft.id}:${String(operation.action)}`);
    setError(null);
    try {
      const config = await getAppConfig();
      const response = await fetch(`${config?.apiBase ?? ''}/api/plugin-drafts`, {
        method: 'POST',
        headers: { ...sessionHeaders(config), 'content-type': 'application/json' },
        body: JSON.stringify(operation),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const togglePermission = (draftId: string, permission: string) => {
    setAccepted((current) => {
      const next = new Set(current[draftId] ?? []);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...current, [draftId]: next };
    });
  };

  return (
    <section className="plugin-drafts-panel" aria-label="Plugin drafts">
      <div className="plugin-drafts-toolbar">
        <h2>Plugin Drafts</h2>
        <button type="button" onClick={() => void refresh()} disabled={busy !== null}>
          Refresh
        </button>
      </div>
      {error && <div className="plugin-drafts-error">{error}</div>}
      {payload?.configured === false && (
        <p className="plugin-drafts-empty">Draft store is not configured for this app server.</p>
      )}
      {payload?.configured === true && payload.drafts.length === 0 && (
        <p className="plugin-drafts-empty">No plugin drafts.</p>
      )}
      <div className="plugin-drafts-list">
        {payload?.drafts.map((draft) => {
          const selected = accepted[draft.id] ?? new Set<string>();
          const allPermissionsAccepted = draft.permissionDiff.added.every((permission) =>
            selected.has(permission),
          );
          const trustOk =
            draft.permissionDiff.trustEscalation !== true || trustAccepted[draft.id] === true;
          return (
            <article className="plugin-draft-card" key={draft.id}>
              <div className="plugin-draft-heading">
                <strong>{draft.id}</strong>
                <span className={`plugin-draft-status status-${draft.status}`}>{draft.status}</span>
              </div>
              <div className="plugin-draft-meta">
                {draft.manifest.id}@{draft.manifest.version} · base {draft.basePluginId} · trust{' '}
                {draft.manifest.trust.minLevel}
              </div>
              {draft.permissionDiff.added.length > 0 && (
                <fieldset className="plugin-draft-permissions">
                  <legend>New permissions require approval</legend>
                  {draft.permissionDiff.added.map((permission) => (
                    <label key={permission}>
                      <input
                        type="checkbox"
                        checked={selected.has(permission)}
                        onChange={() => togglePermission(draft.id, permission)}
                      />{' '}
                      {permission}
                    </label>
                  ))}
                </fieldset>
              )}
              {draft.permissionDiff.trustEscalation === true && (
                <label className="plugin-draft-trust">
                  <input
                    type="checkbox"
                    checked={trustAccepted[draft.id] === true}
                    onChange={(event) =>
                      setTrustAccepted((current) => ({
                        ...current,
                        [draft.id]: event.target.checked,
                      }))
                    }
                  />{' '}
                  I explicitly approve the trust escalation
                </label>
              )}
              {(draft.validation?.diagnostics?.length ?? 0) > 0 && (
                <ul className="plugin-draft-diagnostics">
                  {draft.validation?.diagnostics.map((diagnostic) => (
                    <li key={diagnostic}>{diagnostic}</li>
                  ))}
                </ul>
              )}
              <div className="plugin-draft-actions">
                {draft.status === 'draft' && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void action(draft, { action: 'validate', id: draft.id })}
                  >
                    Validate
                  </button>
                )}
                {draft.status === 'validated' && (
                  <button
                    type="button"
                    disabled={busy !== null || !allPermissionsAccepted || !trustOk}
                    onClick={() =>
                      void action(draft, {
                        action: 'approve',
                        id: draft.id,
                        approvedBy: 'user',
                        acceptedPermissions: [...selected],
                        allowTrustEscalation: trustAccepted[draft.id] === true,
                      })
                    }
                  >
                    Approve
                  </button>
                )}
                {draft.status === 'approved' && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void action(draft, { action: 'publish', id: draft.id })}
                  >
                    Publish
                  </button>
                )}
                {draft.status !== 'published' && draft.status !== 'rejected' && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void action(draft, { action: 'reject', id: draft.id })}
                  >
                    Reject
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
