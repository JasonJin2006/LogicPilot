import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface AppSelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function AppSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const maxHeight = Math.max(140, Math.min(320, Math.max(below, above)));
    const openAbove = below < 180 && above > below;
    setPosition({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)),
      top: openAbove ? Math.max(margin, rect.top - maxHeight - 4) : rect.bottom + 4,
      width: rect.width,
      maxHeight,
    });
  };

  const show = () => {
    if (disabled) return;
    const selectedIndex = enabledOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    };
    const onViewportChange = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const selectActive = () => {
    const option = enabledOptions[activeIndex];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + enabledOptions.length) % enabledOptions.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      selectActive();
    }
  };

  let previousGroup: string | undefined;
  const menu = open && position && (
    <div
      ref={menuRef}
      className="app-select-menu"
      role="listbox"
      aria-label={ariaLabel}
      style={position}
      onKeyDown={onKeyDown}
    >
      {options.length === 0 ? (
        <div className="app-select-empty">No options available</div>
      ) : (
        options.map((option) => {
          const showGroup = option.group !== previousGroup;
          previousGroup = option.group;
          const enabledIndex = enabledOptions.findIndex((entry) => entry.value === option.value);
          return (
            <div key={option.value}>
              {showGroup && option.group && <div className="app-select-group">{option.group}</div>}
              <button
                type="button"
                className={`app-select-option${enabledIndex === activeIndex ? ' active' : ''}`}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(enabledIndex)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={13} />}
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="app-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={14} />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
