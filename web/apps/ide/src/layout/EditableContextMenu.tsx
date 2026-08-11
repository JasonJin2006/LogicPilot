import { useEffect, useState } from 'react';
import { ContextMenu, type ContextAction } from './ContextMenu';

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function editableFrom(target: EventTarget | null): Editable | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('input, textarea, [contenteditable="true"]');
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.disabled || element.readOnly ? null : element;
  }
  return element instanceof HTMLElement && element.isContentEditable ? element : null;
}

function selectedText(element: Editable) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? '';
}

function replaceSelection(element: Editable, value: string) {
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.setRangeText(
      value,
      element.selectionStart ?? element.value.length,
      element.selectionEnd ?? element.value.length,
      'end',
    );
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
    );
    return;
  }
  document.execCommand('insertText', false, value);
}

async function copyText(element: Editable, cut: boolean) {
  const text = selectedText(element);
  if (!text) return;
  try {
    if (!navigator.clipboard) throw new Error('clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    if (cut) replaceSelection(element, '');
  } catch {
    element.focus();
    document.execCommand(cut ? 'cut' : 'copy');
  }
}

async function pasteText(element: Editable) {
  try {
    if (!navigator.clipboard) throw new Error('clipboard API unavailable');
    replaceSelection(element, await navigator.clipboard.readText());
  } catch {
    element.focus();
    document.execCommand('paste');
  }
}

export function EditableContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; element: Editable } | null>(null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const element = editableFrom(event.target);
      setMenu(element ? { x: event.clientX, y: event.clientY, element } : null);
    };
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, []);

  if (!menu) return null;
  const { element } = menu;
  const hasSelection = selectedText(element).length > 0;
  const actions: ContextAction[] = [
    {
      label: 'Cut',
      shortcut: 'Ctrl+X',
      disabled: !hasSelection,
      onSelect: () => void copyText(element, true),
    },
    {
      label: 'Copy',
      shortcut: 'Ctrl+C',
      disabled: !hasSelection,
      onSelect: () => void copyText(element, false),
    },
    {
      label: 'Paste',
      shortcut: 'Ctrl+V',
      separatorBefore: true,
      onSelect: () => void pasteText(element),
    },
    {
      label: 'Select All',
      shortcut: 'Ctrl+A',
      separatorBefore: true,
      onSelect: () => {
        element.focus();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
          element.select();
        else document.execCommand('selectAll');
      },
    },
  ];

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      actions={actions}
      label="Text editing menu"
      onClose={() => setMenu(null)}
    />
  );
}
