'use client';

import { useEffect, useRef } from 'react';
import type { SheetName } from '@/lib/broadcast/workbook';

export type GroupChoice = { id: string; label: string };
export type Grouping = { primary: string; secondary: string };
export const noGrouping: Grouping = { primary: '', secondary: '' };

const keyFor = (sheet: SheetName) => 'final-fore:broadcast-research:grouping:' + sheet;

export function readGrouping(sheet: SheetName): Grouping {
  try {
    const value = JSON.parse(sessionStorage.getItem(keyFor(sheet)) ?? 'null');
    return typeof value?.primary === 'string' && typeof value.secondary === 'string' ? value : noGrouping;
  } catch {
    return noGrouping;
  }
}

export function rememberGrouping(sheet: SheetName, value: Grouping) {
  try { sessionStorage.setItem(keyFor(sheet), JSON.stringify(value)); } catch { /* Keep the control usable in-page. */ }
}

export default function GroupControl({ choices, grouping, onChange }: {
  choices: GroupChoice[];
  grouping: Grouping;
  onChange: (grouping: Grouping) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const chosen = [grouping.primary, grouping.secondary].flatMap(id => choices.find(choice => choice.id === id)?.label ?? []);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const menu = details.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  function close() {
    if (!details.current) return;
    details.current.open = false;
    details.current.querySelector('summary')?.focus();
  }

  return <details ref={details} className="broadcast-filter broadcast-group-control" onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) { event.stopPropagation(); close(); }
  }}>
    <summary className="broadcast-group-summary" data-active={chosen.length > 0}>
      <span>Group by{chosen.length > 0 && <span className="broadcast-filter-value"> · {chosen.join(' → ')}</span>}</span>
      <span aria-hidden="true">▾</span>
    </summary>
    <div className="broadcast-filter-options broadcast-group-options">
      <label>Primary group
        <select value={grouping.primary} onChange={event => {
          const primary = event.target.value;
          onChange({ primary, secondary: primary && primary !== grouping.secondary ? grouping.secondary : '' });
        }}>
          <option value="">None</option>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </label>
      <label>Subgroup
        <select value={grouping.secondary} disabled={!grouping.primary}
          onChange={event => onChange({ ...grouping, secondary: event.target.value })}>
          <option value="">None</option>
          {choices.filter(choice => choice.id !== grouping.primary)
            .map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </label>
      <button type="button" onClick={close}>Done</button>
    </div>
  </details>;
}
