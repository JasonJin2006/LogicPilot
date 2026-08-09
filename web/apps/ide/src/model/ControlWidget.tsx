// Design-time previews for the Controls library. These use native form
// elements so the canvas matches the runtime surface; pointer interaction is
// intentionally disabled by CSS while editing so dragging/selecting remains
// predictable.

function items(value: unknown): string[] {
  const parsed = String(value ?? '')
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ['Option 1', 'Option 2', 'Option 3'];
}

export function ControlWidget({
  kind,
  params,
  name,
}: {
  kind: string;
  params: Record<string, string | number | boolean>;
  name: string;
}) {
  const label = String(params['label'] ?? name);
  const options = items(params['items']);
  const minimum = Number(params['minimumValue'] ?? 0);
  const maximum = Number(params['maximumValue'] ?? 100);
  const value = Number(params['defaultValue'] ?? params['progressValue'] ?? 50);
  const disabled =
    params['enabled'] === false || String(params['enabled']).toLowerCase() === 'false';
  const selectedOption = options.includes(String(params['defaultValue']))
    ? String(params['defaultValue'])
    : options[0];

  switch (kind) {
    case 'button':
      return (
        <button type="button" disabled={disabled}>
          {label}
        </button>
      );
    case 'checkBox':
      return (
        <label>
          <input
            type="checkbox"
            defaultChecked={String(params['defaultValue']) === 'true'}
            disabled={disabled}
          />
          <span>{label}</span>
        </label>
      );
    case 'editBox':
      return (
        <input
          type="text"
          value={String(params['defaultValue'] ?? '')}
          readOnly
          disabled={disabled}
        />
      );
    case 'radioButtons':
      return (
        <fieldset className={params['orientation'] === 'horizontal' ? 'horizontal' : ''}>
          {options.map((option, index) => (
            <label key={option}>
              <input
                type="radio"
                name={name}
                defaultChecked={index === Number(params['defaultValue'] ?? 0)}
                disabled={disabled}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    case 'slider':
      return (
        <input
          type="range"
          className={params['orientation'] === 'vertical' ? 'vertical' : undefined}
          min={minimum}
          max={maximum}
          step={Number(params['step'] ?? 1)}
          value={value}
          readOnly
          disabled={disabled}
        />
      );
    case 'comboBox':
      return (
        <select defaultValue={selectedOption} disabled={disabled}>
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case 'listBox':
      return (
        <select
          multiple={params['multipleSelection'] === true}
          defaultValue={params['multipleSelection'] === true ? [options[0]!] : options[0]}
          disabled={disabled}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case 'fileChooser':
      return (
        <button type="button" className="file-control" disabled={disabled}>
          {String(params['title'] ?? 'Choose a file')}
        </button>
      );
    case 'progressBar': {
      const progressValue = Math.max(0, Number(params['progressValue'] ?? 0) - minimum);
      const progressMaximum = Math.max(1, maximum - minimum);
      const determinate = String(params['determinate'] ?? 'true') !== 'false';
      return (
        <div className="model-control-progress">
          <progress max={progressMaximum} value={determinate ? progressValue : undefined} />
          {String(params['showProgressString'] ?? 'true') !== 'false' && (
            <span>{Math.round((progressValue / progressMaximum) * 100)}%</span>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
