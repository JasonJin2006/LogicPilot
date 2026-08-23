// Settings dialog: categorized IDE preferences (appearance, AI and connection).
// Per-experiment run configuration and controls live in the Run dialog
// (opened from the canvas Run button) - a simulation run belongs to a
// specific model, not to the IDE settings.

import {
  Bot,
  Check,
  KeyRound,
  LoaderCircle,
  Palette,
  RadioTower,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppSelect } from '../layout/AppSelect';
import {
  getAiProviderState,
  listAiProviderModels,
  resetAiProvider,
  saveAiProvider,
  testAiProvider,
  type AiProviderState,
} from '../ai/providerConfig';
import { useConnectionStore } from '../state/connectionStore';
import { useThemeStore, type ThemeMode } from '../state/themeStore';
import { useUiStore } from '../state/uiStore';

export function SettingsDialog() {
  const [section, setSection] = useState<'appearance' | 'ai' | 'connection'>('appearance');
  const url = useConnectionStore((state) => state.url);
  const conn = useConnectionStore((state) => state.conn);
  const setUrl = useConnectionStore((state) => state.setUrl);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const aiToolsEnabled = useUiStore((state) => state.aiToolsEnabled);
  const aiSourceEditingEnabled = useUiStore((state) => state.aiSourceEditingEnabled);
  const setAiToolsEnabled = useUiStore((state) => state.setAiToolsEnabled);
  const setAiSourceEditingEnabled = useUiStore((state) => state.setAiSourceEditingEnabled);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  const connected = conn === 'connected';
  const connecting = conn === 'connecting';
  const [providerState, setProviderState] = useState<AiProviderState | null>(null);
  const [providerId, setProviderId] = useState('custom');
  const [protocol, setProtocol] = useState('openai-chat');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerBusy, setProviderBusy] = useState<
    'load' | 'save' | 'test' | 'models' | 'reset' | null
  >('load');
  const [providerMessage, setProviderMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const applyState = (state: AiProviderState) => {
    setProviderState(state);
    setProviderId(state.active.providerId);
    setProtocol(state.active.protocol);
    setBaseUrl(state.active.baseUrl);
    setModel(state.active.model);
    setAvailableModels(
      state.providers.find((item) => item.id === state.active.providerId)?.models ?? [],
    );
  };

  useEffect(() => {
    void getAiProviderState()
      .then(applyState)
      .catch((error) => setProviderMessage(String(error)))
      .finally(() => setProviderBusy(null));
  }, []);

  const selectedProvider = providerState?.providers.find((item) => item.id === providerId);
  const activeDraftHasKey =
    providerState?.active.providerId === providerId && providerState.active.hasApiKey;
  const canTestProvider =
    providerState !== null &&
    (selectedProvider?.auth === 'login' ||
      (baseUrl.trim() !== '' &&
        model.trim() !== '' &&
        (selectedProvider?.auth === 'optional' || apiKey.trim() !== '' || activeDraftHasKey)));
  const canDiscoverModels =
    providerState !== null &&
    selectedProvider?.auth !== 'login' &&
    baseUrl.trim() !== '' &&
    (selectedProvider?.auth === 'optional' || apiKey.trim() !== '' || activeDraftHasKey);
  const modelOptions = useMemo(
    () => [...new Set([...(selectedProvider?.models ?? []), ...availableModels])],
    [availableModels, selectedProvider],
  );
  const providerFailed = providerState === null && providerBusy === null;
  const groupedProviders = useMemo(() => {
    const groups = new Map<string, AiProviderState['providers']>();
    for (const item of providerState?.providers ?? [])
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    return [...groups.entries()];
  }, [providerState]);

  const chooseProvider = (id: string) => {
    const next = providerState?.providers.find((item) => item.id === id);
    setProviderId(id);
    if (!next) return;
    setProtocol(next.protocol);
    setBaseUrl(next.baseUrl);
    setModel(next.models[0] ?? '');
    setAvailableModels(next.models);
    setApiKey('');
    setProviderMessage('');
  };

  const refreshModels = async () => {
    setProviderBusy('models');
    setProviderMessage('');
    try {
      const result = await listAiProviderModels({
        providerId,
        protocol,
        baseUrl,
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
      setAvailableModels(result.models);
      if (!result.models.includes(model.trim()) && result.models[0]) setModel(result.models[0]);
      setProviderMessage(`Found ${result.models.length} models from the provider.`);
    } catch (error) {
      setProviderMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setProviderBusy(null);
    }
  };

  const saveProvider = async () => {
    setProviderBusy('save');
    setProviderMessage('');
    try {
      applyState(
        await saveAiProvider({
          providerId,
          protocol,
          baseUrl,
          model,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
      setApiKey('');
      setProviderMessage('Saved for this app session.');
    } catch (error) {
      setProviderMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setProviderBusy(null);
    }
  };

  const testProvider = async () => {
    setProviderBusy('test');
    setProviderMessage('');
    try {
      const result = await testAiProvider({
        providerId,
        protocol,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      setProviderMessage(`Connection ready — ${result.latencyMs} ms`);
    } catch (error) {
      setProviderMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setProviderBusy(null);
    }
  };

  const resetProvider = async () => {
    setProviderBusy('reset');
    setProviderMessage('');
    try {
      applyState(await resetAiProvider());
      setApiKey('');
      setProviderMessage('Session override cleared.');
    } catch (error) {
      setProviderMessage(String(error instanceof Error ? error.message : error));
    } finally {
      setProviderBusy(null);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={closeSettings}>
      <div
        className="dialog-card settings-dialog"
        role="dialog"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header settings-header">
          <h2>Settings</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeSettings}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings categories">
            <button
              className={section === 'appearance' ? 'active' : ''}
              onClick={() => setSection('appearance')}
            >
              <Palette size={16} />
              <span>
                <strong>Appearance</strong>
                <small>Theme and interface</small>
              </span>
            </button>
            <button className={section === 'ai' ? 'active' : ''} onClick={() => setSection('ai')}>
              <Bot size={16} />
              <span>
                <strong>AI &amp; Models</strong>
                <small>Providers and protocols</small>
              </span>
            </button>
            <button
              className={section === 'connection' ? 'active' : ''}
              onClick={() => setSection('connection')}
            >
              <RadioTower size={16} />
              <span>
                <strong>Simulation</strong>
                <small>Gateway connection</small>
              </span>
            </button>
          </nav>
          <div className="settings-content">
            {section === 'appearance' && (
              <section className="settings-page" aria-labelledby="settings-appearance-title">
                <div className="settings-page-heading">
                  <h3 id="settings-appearance-title">Appearance</h3>
                  <p>Choose how LogicPilot follows your desktop theme.</p>
                </div>
                <div className="settings-group">
                  <div className="settings-control-label">
                    <strong>Color theme</strong>
                    <span>Applied immediately across the entire IDE.</span>
                  </div>
                  <div className="theme-options">
                    {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={`theme-option${themeMode === mode ? ' active' : ''}`}
                        onClick={() => setThemeMode(mode)}
                      >
                        {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {section === 'ai' && (
              <section
                className="settings-page ai-provider-settings"
                aria-labelledby="settings-ai-title"
              >
                <div className="settings-page-heading">
                  <h3 id="settings-ai-title">AI &amp; Models</h3>
                  <p>Connect a cloud, local, compatible, or login-based model provider.</p>
                </div>
                <div className="provider-heading">
                  <div className="settings-control-label">
                    <strong>Active provider</strong>
                    <span>Used by the assistant and AI build actions.</span>
                  </div>
                  <span
                    className={`provider-status${providerState?.active.configured ? ' ready' : ''}${providerFailed ? ' failed' : ''}`}
                  >
                    {providerState?.active.configured ? (
                      <>
                        <Check size={11} /> Ready
                      </>
                    ) : providerFailed ? (
                      'Unavailable'
                    ) : (
                      'Not configured'
                    )}
                  </span>
                </div>
                <div className="provider-grid">
                  <label>
                    <span>Provider</span>
                    <AppSelect
                      ariaLabel="Provider"
                      value={providerId}
                      disabled={providerBusy === 'load' || providerFailed}
                      onChange={chooseProvider}
                      options={groupedProviders.flatMap(([group, providers]) =>
                        providers.map((item) => ({ value: item.id, label: item.name, group })),
                      )}
                    />
                  </label>
                  <label>
                    <span>Protocol</span>
                    <AppSelect
                      ariaLabel="Protocol"
                      value={protocol}
                      disabled={
                        providerBusy === 'load' ||
                        providerFailed ||
                        selectedProvider?.auth === 'login'
                      }
                      onChange={setProtocol}
                      options={(providerState?.protocols ?? []).map((item) => ({
                        value: item.id,
                        label: item.label,
                      }))}
                    />
                  </label>
                </div>
                {selectedProvider?.auth === 'login' ? (
                  <div className="provider-login-note">
                    <KeyRound size={15} />
                    <span>
                      Uses your existing Codex login through the local app-server. No API key is
                      required.
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="provider-field">
                      <span>Base URL</span>
                      <input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        spellCheck={false}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <div className="provider-grid">
                      <label>
                        <span>Model</span>
                        <div className="provider-model-input">
                          <input
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            list="ai-provider-models"
                            spellCheck={false}
                            placeholder="Model ID"
                          />
                          <button
                            type="button"
                            className="provider-model-refresh"
                            onClick={refreshModels}
                            disabled={providerBusy !== null || !canDiscoverModels}
                            aria-label="Fetch available models"
                            title="Fetch available models"
                          >
                            <RefreshCw
                              className={providerBusy === 'models' ? 'spin' : ''}
                              size={13}
                            />
                          </button>
                        </div>
                        <small className="provider-model-hint">
                          {modelOptions.length > 0
                            ? `${modelOptions.length} preset/discovered model${modelOptions.length === 1 ? '' : 's'}`
                            : 'Fetch models from this provider or enter an ID'}
                        </small>
                      </label>
                      <label>
                        <span>API key</span>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          autoComplete="off"
                          placeholder={
                            providerState?.active.hasApiKey &&
                            providerState.active.providerId === providerId
                              ? 'Configured — leave blank to keep'
                              : selectedProvider?.auth === 'optional'
                                ? 'Optional for local server'
                                : 'Stored in this session only'
                          }
                        />
                      </label>
                    </div>
                    <datalist id="ai-provider-models">
                      {modelOptions.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </>
                )}
                <div className="provider-actions">
                  <button
                    className="btn-primary"
                    onClick={saveProvider}
                    disabled={providerBusy !== null}
                  >
                    {providerBusy === 'save' && <LoaderCircle className="spin" size={13} />}Save
                    provider
                  </button>
                  <button
                    onClick={testProvider}
                    disabled={providerBusy !== null || !canTestProvider}
                  >
                    {providerBusy === 'test' && <LoaderCircle className="spin" size={13} />}Test
                    connection
                  </button>
                  <button
                    className="btn-ghost provider-reset"
                    aria-label="Reset provider session"
                    title="Clear session override"
                    onClick={resetProvider}
                    disabled={providerBusy !== null}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
                {providerMessage && (
                  <p className="provider-message" role="status">
                    {providerMessage}
                  </p>
                )}
                <p className="provider-privacy">
                  Keys stay in the local backend process and are never saved to the project or
                  browser. Model IDs are editable, so new and self-hosted models do not require an
                  app update.
                </p>
                <div className="settings-group">
                  <div className="settings-control-label">
                    <strong>Copilot tools</strong>
                    <span>Modeling tools are enabled by default; source editing is off. MCP tools are discovered automatically when configured.</span>
                  </div>
                  <button
                    type="button"
                    className="ai-tool-toggle settings-ai-tool-toggle"
                    onClick={() => setAiToolsEnabled(!aiToolsEnabled)}
                  >
                    <span>
                      <strong>LogicPilot modeling</strong>
                      <small>Inspect, edit, compile and simulate</small>
                    </span>
                    <span className={`ai-toggle ${aiToolsEnabled ? 'on' : ''}`} aria-hidden>
                      <i />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-tool-toggle settings-ai-tool-toggle"
                    onClick={() => setAiSourceEditingEnabled(!aiSourceEditingEnabled)}
                  >
                    <span>
                      <strong>Source editing</strong>
                      <small>Read and patch bounded workspace source files</small>
                    </span>
                    <span className={`ai-toggle ${aiSourceEditingEnabled ? 'on' : ''}`} aria-hidden>
                      <i />
                    </span>
                  </button>
                </div>
              </section>
            )}

            {section === 'connection' && (
              <section className="settings-page" aria-labelledby="settings-connection-title">
                <div className="settings-page-heading">
                  <h3 id="settings-connection-title">Simulation gateway</h3>
                  <p>Configure the WebSocket endpoint used for simulation telemetry.</p>
                </div>
                <div className="settings-group">
                  <label className="settings-control-label" htmlFor="gateway-url">
                    <strong>Gateway URL</strong>
                    <span>Desktop clients normally discover this endpoint automatically.</span>
                  </label>
                  <input
                    id="gateway-url"
                    className="url-input"
                    value={url}
                    spellCheck={false}
                    disabled={connected || connecting}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="ws://127.0.0.1:8089/sim"
                  />
                  <div className="dialog-actions">
                    {connected || connecting ? (
                      <button onClick={disconnect} disabled={connecting}>
                        Disconnect
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={connect} disabled={connecting}>
                        Connect
                      </button>
                    )}
                    <span className={`conn-badge conn-${conn}`}>{conn}</span>
                  </div>

                  <p className="dialog-hint">
                    The gateway streams telemetry frames over WebSocket (wire.fbs contract F2); run
                    parameters and controls live in the Run dialog on the canvas.
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
