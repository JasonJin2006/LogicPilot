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

  switch (kind) {
    case 'button':
      return <button type="button">{label}</button>;
    case 'checkBox':
      return (
        <label>
          <input type="checkbox" defaultChecked={String(params['defaultValue']) === 'true'} />
          <span>{label}</span>
        </label>
      );
    case 'editBox':
      return <input type="text" value={String(params['defaultValue'] ?? '')} readOnly />;
    case 'radioButtons':
      return (
        <fieldset className={params['orientation'] === 'horizontal' ? 'horizontal' : ''}>
          {options.map((option, index) => (
            <label key={option}>
              <input type="radio" name={name} defaultChecked={index === 0} />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    case 'slider':
      return <input type="range" min={minimum} max={maximum} value={value} readOnly />;
    case 'comboBox':
      return (
        <select defaultValue={options[0]}>
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
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case 'fileChooser':
      return (
        <button type="button" className="file-control">
          {String(params['title'] ?? 'Choose a file')}
        </button>
      );
    case 'progressBar': {
      const progressValue = Math.max(0, Number(params['progressValue'] ?? 0) - minimum);
      const progressMaximum = Math.max(1, maximum - minimum);
      return <progress max={progressMaximum} value={progressValue} />;
    }
    default:
      return null;
  }
}
