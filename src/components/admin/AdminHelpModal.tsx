'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  Info,
  Wrench,
  X,
} from 'lucide-react';
import {
  ADMIN_HELP_CONTENT,
  type AdminHelpEntry,
  type AdminHelpSectionKey,
} from '../../data/adminHelpContent';

type HelpTab = 'how' | 'impact' | 'test';

interface AdminHelpModalProps {
  entry: AdminHelpEntry;
  onClose: () => void;
}

export function AdminHelpModal({ entry, onClose }: AdminHelpModalProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('how');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const tabs: Array<{ id: HelpTab; label: string; icon: typeof BookOpen }> = [
    { id: 'how', label: 'How to Use', icon: BookOpen },
    { id: 'impact', label: 'Frontend Impact', icon: Eye },
    { id: 'test', label: 'Test & Troubleshoot', icon: Wrench },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-help-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A120B]/55 p-4 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] text-[#1E1710] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A5A17]">
              Admin Guide &amp; Documentation
            </p>
            <h3
              id="admin-help-modal-title"
              className="font-display mt-0.5 text-lg font-semibold leading-snug text-[#1E1710]"
            >
              {entry.title}
            </h3>
            <p className="mt-0.5 text-xs text-[#635647]">{entry.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help guide"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.14)] bg-[#FFFDF9] text-[#1E1710] hover:bg-[#F2ECE1]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3-Tab Navigation */}
        <div className="flex flex-wrap gap-1.5 border-b border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] px-5 py-3 sm:px-6">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'bg-[#1E1710] text-[#FAF7F2]'
                  : 'border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] text-[#635647] hover:text-[#1E1710]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5 text-xs leading-relaxed sm:px-6">
          {activeTab === 'how' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4">
                <p className="font-semibold text-[#1E1710]">What this section does</p>
                <p className="mt-1 text-[#635647]">{entry.howToUse.whatItDoes}</p>
              </div>

              <div>
                <p className="font-semibold text-[#1E1710]">When to use it</p>
                <p className="mt-1 text-[#635647]">{entry.howToUse.whenToUse}</p>
              </div>

              <div>
                <p className="font-semibold text-[#1E1710]">Step-by-step instructions</p>
                <ol className="mt-2 space-y-2">
                  {entry.howToUse.steps.map((step, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 rounded-lg border border-[rgba(30,23,16,0.08)] bg-[#FFFDF9] px-3 py-2"
                    >
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#F2ECE1] font-mono text-[11px] font-semibold text-[#8A5A17]">
                        {idx + 1}
                      </span>
                      <span className="text-[#1E1710]">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {entry.howToUse.notes && entry.howToUse.notes.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-amber-950">
                  <p className="font-semibold">Important Notes</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-amber-900">
                    {entry.howToUse.notes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'impact' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4">
                <p className="font-semibold text-[#1E1710]">Customer-Facing Effect</p>
                <p className="mt-1 text-[#635647]">{entry.frontendImpact.summary}</p>
              </div>

              <div>
                <p className="font-semibold text-[#1E1710]">Affected Storefront &amp; Channel Areas</p>
                <ul className="mt-2 space-y-2">
                  {entry.frontendImpact.affectedAreas.map((area, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 rounded-lg border border-[rgba(30,23,16,0.08)] bg-[#FFFDF9] px-3 py-2 text-[#1E1710]"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8A5A17]" />
                      <span>{area}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#F2ECE1]/60 p-3.5">
                <p className="font-semibold text-[#1E1710]">When changes take effect</p>
                <p className="mt-0.5 text-[#635647]">{entry.frontendImpact.liveTiming}</p>
              </div>
            </div>
          )}

          {activeTab === 'test' && (
            <div className="space-y-4">
              <div>
                <p className="font-semibold text-[#1E1710]">How to verify it works</p>
                <ul className="mt-2 space-y-2">
                  {entry.testAndTroubleshoot.howToVerify.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 rounded-lg border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] px-3 py-2 text-[#1E1710]"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="font-semibold text-[#1E1710]">Common Issues &amp; Quick Fixes</p>
                <div className="mt-2 space-y-2.5">
                  {entry.testAndTroubleshoot.commonIssues.map((issue, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] p-3.5"
                    >
                      <p className="flex items-start gap-1.5 font-semibold text-[#1E1710]">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                        <span>{issue.symptom}</span>
                      </p>
                      <p className="mt-1 pl-5 text-[#635647]">{issue.fix}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] px-5 py-3 text-[11px] text-[#635647] sm:px-6">
          <span>Press Esc or click outside to close</span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[34px] rounded-lg bg-[#1E1710] px-4 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

interface HelpInfoButtonProps {
  section: AdminHelpSectionKey;
  label?: string;
  className?: string;
}

export function HelpInfoButton({ section, label, className = '' }: HelpInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const entry = ADMIN_HELP_CONTENT[section];

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Guide: ${entry.title}`}
        aria-label={label || `Open help guide for ${entry.title}`}
        className={`no-print inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] text-[#8A5A17] transition-colors hover:border-[#B47B2B] hover:bg-[#F2ECE1] hover:text-[#1E1710] focus:outline-none focus:ring-2 focus:ring-[#B47B2B]/40 ${className}`}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && <AdminHelpModal entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
}
