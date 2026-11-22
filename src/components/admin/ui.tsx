'use client';

import type { ComponentType, ReactNode } from 'react';

/**
 * Shared presentational primitives for the admin console.
 * Pure UI only — no data fetching or business logic lives here.
 */

type Tone = 'neutral' | 'amber' | 'green' | 'blue' | 'red' | 'violet';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700 ring-stone-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-stone-400',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  red: 'bg-red-500',
  violet: 'bg-violet-500',
};

const STATUS_TONE: Record<string, Tone> = {
  pending: 'amber',
  confirmed: 'blue',
  processing: 'violet',
  shipped: 'violet',
  delivered: 'green',
  cancelled: 'red',
  packaging: 'violet',
  ready_to_ship: 'blue',
  sent_to_courier: 'violet',
  out_for_delivery: 'violet',
  delivery_failed: 'red',
  returned: 'red',
  awaiting: 'amber',
  collected: 'green',
  partial: 'amber',
  settled: 'green',
  disputed: 'red',
  cod_due: 'amber',
  pending_verification: 'amber',
  verified: 'green',
  failed: 'red',
  manual_review: 'red',
  not_configured: 'neutral',
};

export function StatusBadge({
  status,
  label,
  tone,
}: {
  status: string;
  label?: string;
  tone?: Tone;
}) {
  const resolved = tone || STATUS_TONE[status] || 'neutral';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${TONE_CLASSES[resolved]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[resolved]}`} aria-hidden="true" />
      {label || status.replace(/_/g, ' ')}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-[#1E1710]">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-[#635647]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[rgba(30,23,16,0.08)] bg-white shadow-[0_1px_2px_rgba(30,23,16,0.04)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-[rgba(30,23,16,0.06)] px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-[#1E1710]">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-[#635647]">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName || 'p-5'}>{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(30,23,16,0.08)] bg-white p-4 shadow-[0_1px_2px_rgba(30,23,16,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[#635647]">{label}</p>
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${TONE_CLASSES[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="font-mono mt-3 text-2xl font-semibold tabular-nums text-[#1E1710]">
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-[#8A7867]">{hint}</p>}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-[#1E1710] text-[#FAF7F2]'
          : 'border border-[rgba(30,23,16,0.14)] bg-white text-[#635647] hover:bg-[#F4EFE6] hover:text-[#1E1710]'
      }`}
    >
      <span>{children}</span>
      {typeof count === 'number' && (
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${
            active ? 'bg-white/20' : 'bg-stone-100 text-stone-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base text-[#1E1710] placeholder:text-[#8A7867] focus:border-[#B47B2B] focus:outline-none focus:ring-2 focus:ring-[#B47B2B]/20 sm:text-sm';

export function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="block text-xs font-medium text-[#3F3328]">
      {label}
      {hint && <span className="ml-1 font-normal text-[#8A7867]">{hint}</span>}
    </span>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  type?: 'text' | 'email' | 'url';
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} hint={hint} />
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  prefix,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  prefix?: string;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} hint={hint} />
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 font-mono text-sm text-[#8A7867]">
            {prefix}
          </span>
        )}
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${INPUT_CLASS} font-mono ${prefix ? 'pl-7' : ''}`}
        />
      </div>
    </label>
  );
}

export function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] p-3">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[#1E1710]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] text-[#635647]">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#B47B2B]"
      />
    </label>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[rgba(30,23,16,0.16)] px-4 py-10 text-center">
      <p className="text-sm font-medium text-[#1E1710]">{title}</p>
      {description && <p className="mt-1 text-xs text-[#635647]">{description}</p>}
    </div>
  );
}
