'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const labels = {
  market: { name: 'Market', all: 'All markets' },
  rep: { name: 'Rep', all: 'All reps' },
  client: { name: 'Client', all: 'All clients' },
  firm: { name: 'Firm', all: 'All firms' },
};

export type FilterField = keyof typeof labels;
export type Filters = Record<FilterField, string>;
export const filterFields: FilterField[] = ['market', 'rep', 'client', 'firm'];
export const emptyFilters: Filters = { market: '', rep: '', client: '', firm: '' };
const storageKey = 'final-fore:broadcast-research:filters';

export function readFilters(): Filters {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    return Object.fromEntries(filterFields.map(field => [field, typeof saved?.[field] === 'string' ? saved[field] : ''])) as Filters;
  } catch {
    return emptyFilters;
  }
}

export function rememberFilters(filters: Filters) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* Keep in-page controls usable. */ }
}

export default function FilterRibbon({ filters, options, onChange, children }: {
  filters: Filters; options: Record<FilterField, string[]>; onChange: (value: Filters) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState<FilterField | null>(null);
  const ribbon = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const active = filterFields.some(field => filters[field]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (!ribbon.current?.contains(event.target) || event.target.closest('.broadcast-group-control')) setOpen(null);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function choose(field: FilterField, value: string) {
    onChange({ ...filters, [field]: value });
    setOpen(null);
    trigger.current?.focus();
  }

  return <div ref={ribbon} className="broadcast-filters" role="group" aria-label="Filter research"
    onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return;
      event.stopPropagation();
      setOpen(null);
      trigger.current?.focus();
    }}>
    {filterFields.map(field => {
      const label = labels[field];
      const selected = filters[field];
      const expanded = open === field;
      return <div key={field} className="broadcast-filter">
        <button type="button" className="broadcast-filter-button" data-active={Boolean(selected)}
          aria-expanded={expanded} aria-controls={expanded ? 'broadcast-filter-' + field : undefined}
          title={selected ? label.name + ' · ' + selected : label.name}
          onClick={event => { trigger.current = event.currentTarget; setOpen(expanded ? null : field); }}>
          <span>{label.name}{selected && <span className="broadcast-filter-value"> · {selected}</span>}</span>
          <span aria-hidden="true">▾</span>
        </button>
        {expanded && <div id={'broadcast-filter-' + field} className="broadcast-filter-options"
          role="group" aria-label={label.name + ' choices'}>
          <button type="button" aria-pressed={!selected} onClick={() => choose(field, '')}>{label.all}</button>
          {options[field].map(value => <button key={value} type="button" aria-pressed={selected === value}
            onClick={() => choose(field, value)}>{value}</button>)}
        </div>}
      </div>;
    })}
    {active && <button type="button" className="broadcast-link broadcast-clear-filters"
      aria-label="Clear filters" onClick={() => { onChange(emptyFilters); setOpen(null); }}>Clear</button>}
    {children}
  </div>;
}
