'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Monitor, Plus, Smartphone, Tablet, Trash2 } from 'lucide-react';
import {
  emptyCms,
  isAnnouncementActive,
  moveItem,
  type CmsContent,
  type CmsFaq,
  type CmsHighlight,
  type CmsVersionMeta,
} from '../../lib/cms/cms';
import { Card, PageHeader, StatusBadge, ToggleField } from './ui';

interface CmsState {
  draft: CmsContent;
  published: CmsContent;
  hasUnpublishedChanges: boolean;
  publishedAtIso: string;
  versions: CmsVersionMeta[];
}

type Section = 'announcement' | 'hero' | 'highlights' | 'faqs';
type Device = 'desktop' | 'tablet' | 'mobile';

const dhaka = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
const field = 'mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base focus:border-[#B47B2B] focus:outline-none sm:text-sm';
const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Text({ label, value, onChange, max, multiline }: { label: string; value: string; onChange: (v: string) => void; max: number; multiline?: boolean }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-medium text-[#3F3328]">
        <span>{label}</span>
        <span className="font-normal text-[#8A7867]">{value.length}/{max}</span>
      </span>
      {multiline ? (
        <textarea rows={3} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} className={field} />
      ) : (
        <input maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} className={field} />
      )}
    </label>
  );
}

function Preview({ content, device, lang }: { content: CmsContent; device: Device; lang: 'en' | 'bn' }) {
  const width = device === 'mobile' ? 375 : device === 'tablet' ? 768 : 1100;
  const a = content.announcement;
  const h = content.hero;
  const bn = lang === 'bn';
  const showBar = isAnnouncementActive(a);
  const title = (bn ? h.titleBn : h.titleEn) || (bn ? 'ডিফল্ট শিরোনাম ব্যবহার হবে' : 'Default headline will be used');
  const accent = bn ? h.accentBn : h.accentEn;
  const sub = (bn ? h.subtitleBn : h.subtitleEn) || (bn ? 'ডিফল্ট সাবটাইটেল' : 'Default subtitle will be used');
  const cta = (bn ? h.ctaBn : h.ctaEn) || (bn ? 'এখনই অর্ডার করুন' : 'Order the Jar');
  const items = content.highlights.filter((x) => x.visible).map((x) => (bn ? x.textBn || x.textEn : x.textEn || x.textBn));
  const faqs = content.faqs.filter((f) => f.visible);
  return (
    <div className="overflow-x-auto rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#E9E3D8] p-3">
      <div style={{ width, maxWidth: '100%' }} className="mx-auto overflow-hidden rounded-lg bg-[#0B0805] text-[#F4EBDD] shadow-lg">
        {showBar ? (
          <div className="px-3 py-1.5 text-center text-xs" style={{ background: a.bgColor || '#1A120B', color: a.textColor || '#FAF7F2' }}>
            {(bn ? a.textBn : a.textEn) || a.textEn || a.textBn}
          </div>
        ) : (
          <div className="bg-[#1A120B] px-3 py-1.5 text-center text-[11px] text-[#C5B8A5]">Default announcement bar</div>
        )}
        <div className="space-y-3 px-5 py-8">
          <h3 className="font-display text-2xl leading-tight">
            {title} {accent && <em className="text-[#E5B25D]">{accent}</em>}
          </h3>
          <p className="text-xs leading-relaxed text-[#B5A590]">{sub}</p>
          <span className="inline-block rounded-full bg-[#D9A441] px-4 py-2 text-xs font-semibold text-[#1A0F05]">{cta}</span>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-white/10 bg-[#120D09] px-5 py-3 text-[11px] italic text-[#B5A590]">
            {items.map((t, i) => (
              <span key={i}>✦ {t}</span>
            ))}
          </div>
        )}
        {faqs.length > 0 && (
          <div className="space-y-2 px-5 py-5 text-xs">
            {faqs.slice(0, 3).map((f) => (
              <div key={f.id} className="rounded-lg border border-white/10 px-3 py-2">
                {bn ? f.qBn || f.qEn : f.qEn || f.qBn}
              </div>
            ))}
            {faqs.length > 3 && <p className="text-[#8F7F6B]">+ {faqs.length - 3} more questions</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function CmsPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [state, setState] = useState<CmsState | null>(null);
  const [draft, setDraft] = useState<CmsContent>(emptyCms());
  const [section, setSection] = useState<Section>('announcement');
  const [device, setDevice] = useState<Device>('desktop');
  const [lang, setLang] = useState<'en' | 'bn'>('en');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await tokenRef.current();
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
        'x-requested-with': 'DeshiGeeStorefront',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }, []);

  const apply = (s: CmsState) => {
    setState(s);
    setDraft(s.draft);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch('/api/admin/cms');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: CmsState };
      if (!res.ok || !data.ok || !data.state) {
        setError(data.error || `Could not load content (HTTP ${res.status}).`);
        return;
      }
      apply(data.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedDraft = state?.draft;
  const dirty = useMemo(() => (savedDraft ? JSON.stringify(draft) !== JSON.stringify(savedDraft) : false), [draft, savedDraft]);

  const call = async (url: string, init: RequestInit, okMsg: string) => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const res = await authedFetch(url, init);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: CmsState };
      if (!res.ok || !data.ok || !data.state) {
        setError(data.error || 'Request failed.');
        return;
      }
      apply(data.state);
      setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => call('/api/admin/cms', { method: 'PUT', body: JSON.stringify(draft) }, 'Draft saved. The live page is unchanged until you publish.');
  const publish = () => {
    setConfirmPublish(false);
    void call('/api/admin/cms', { method: 'POST', body: JSON.stringify({ action: 'publish', label: 'Published' }) }, 'Published. Visitors see the new content within about a minute.');
  };
  const restore = (v: CmsVersionMeta) => {
    setConfirmRestoreId(null);
    void call('/api/admin/cms', { method: 'POST', body: JSON.stringify({ action: 'restore', versionId: v.id }) }, 'Version loaded into the draft. Review it, then publish.');
  };

  const setA = (patch: Partial<CmsContent['announcement']>) => setDraft((d) => ({ ...d, announcement: { ...d.announcement, ...patch } }));
  const setH = (patch: Partial<CmsContent['hero']>) => setDraft((d) => ({ ...d, hero: { ...d.hero, ...patch } }));
  const setHighlights = (fn: (x: CmsHighlight[]) => CmsHighlight[]) => setDraft((d) => ({ ...d, highlights: fn(d.highlights) }));
  const setFaqs = (fn: (x: CmsFaq[]) => CmsFaq[]) => setDraft((d) => ({ ...d, faqs: fn(d.faqs) }));

  const tabs: [Section, string][] = [
    ['announcement', 'Announcement bar'],
    ['hero', 'Hero'],
    ['highlights', 'Highlights strip'],
    ['faqs', 'FAQ'],
  ];

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Landing Page Editor"
        description="Edit your landing page text without touching code. Save a draft, preview it, then publish."
        actions={
          <>
            {state && <StatusBadge status={state.hasUnpublishedChanges || dirty ? 'pending' : 'verified'} label={state.hasUnpublishedChanges || dirty ? 'Unpublished changes' : 'Live is up to date'} />}
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-60">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Reload</span>
            </button>
          </>
        }
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl bg-[#FAF7F2] px-4 py-3 text-xs text-[#635647]">
        Leave a field empty to keep the built-in text. Only plain text is saved (no HTML), and the live page changes only when you press <strong>Publish</strong>.
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSection(k)} className={`min-h-[36px] rounded-full px-4 text-xs font-medium ${section === k ? 'bg-[#1E1710] text-[#FAF7F2]' : 'border border-[rgba(30,23,16,0.14)] bg-white text-[#635647] hover:bg-[#F4EFE6]'}`}>
                {label}
              </button>
            ))}
          </div>

          {section === 'announcement' && (
            <Card title="Announcement bar" description="The strip above the header. Optional dates control when it shows.">
              <div className="space-y-4">
                <ToggleField label="Show the announcement bar" description="Turning this off (with text set) hides the bar completely." checked={draft.announcement.enabled} onChange={(v) => setA({ enabled: v })} />
                <Text label="Text (English)" value={draft.announcement.textEn} onChange={(v) => setA({ textEn: v })} max={160} />
                <Text label="Text (বাংলা)" value={draft.announcement.textBn} onChange={(v) => setA({ textBn: v })} max={160} />
                <Text label="Link (optional) — /#order or https://…" value={draft.announcement.linkUrl} onChange={(v) => setA({ linkUrl: v })} max={300} />
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-xs font-medium text-[#3F3328]">Background colour</span>
                    <input type="text" placeholder="#1A120B" value={draft.announcement.bgColor} onChange={(e) => setA({ bgColor: e.target.value })} className={`${field} font-mono`} /></label>
                  <label className="block"><span className="text-xs font-medium text-[#3F3328]">Text colour</span>
                    <input type="text" placeholder="#FAF7F2" value={draft.announcement.textColor} onChange={(e) => setA({ textColor: e.target.value })} className={`${field} font-mono`} /></label>
                  <label className="block"><span className="text-xs font-medium text-[#3F3328]">Show from</span>
                    <input type="date" value={draft.announcement.startDate} onChange={(e) => setA({ startDate: e.target.value })} className={field} /></label>
                  <label className="block"><span className="text-xs font-medium text-[#3F3328]">Show until</span>
                    <input type="date" value={draft.announcement.endDate} onChange={(e) => setA({ endDate: e.target.value })} className={field} /></label>
                </div>
              </div>
            </Card>
          )}

          {section === 'hero' && (
            <Card title="Hero section" description="Headline, subtitle and button text. The accent part is shown in gold.">
              <div className="space-y-4">
                <Text label="Headline (English)" value={draft.hero.titleEn} onChange={(v) => setH({ titleEn: v })} max={90} />
                <Text label="Gold accent words (English)" value={draft.hero.accentEn} onChange={(v) => setH({ accentEn: v })} max={60} />
                <Text label="Subtitle (English)" value={draft.hero.subtitleEn} onChange={(v) => setH({ subtitleEn: v })} max={260} multiline />
                <Text label="Button text (English)" value={draft.hero.ctaEn} onChange={(v) => setH({ ctaEn: v })} max={30} />
                <hr className="border-[rgba(30,23,16,0.08)]" />
                <Text label="শিরোনাম (বাংলা)" value={draft.hero.titleBn} onChange={(v) => setH({ titleBn: v })} max={90} />
                <Text label="সোনালী হাইলাইট (বাংলা)" value={draft.hero.accentBn} onChange={(v) => setH({ accentBn: v })} max={60} />
                <Text label="সাবটাইটেল (বাংলা)" value={draft.hero.subtitleBn} onChange={(v) => setH({ subtitleBn: v })} max={260} multiline />
                <Text label="বাটনের লেখা (বাংলা)" value={draft.hero.ctaBn} onChange={(v) => setH({ ctaBn: v })} max={30} />
              </div>
            </Card>
          )}

          {section === 'highlights' && (
            <Card title="Highlights strip" description="The scrolling promise line under the hero. Empty list = built-in promises." action={
              <button type="button" onClick={() => setHighlights((x) => [...x, { id: newId(), textEn: '', textBn: '', visible: true }])} disabled={draft.highlights.length >= 12} className="inline-flex items-center gap-1 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add</button>
            }>
              <ul className="space-y-3">
                {draft.highlights.length === 0 && <li className="text-xs text-[#8A7867]">Using the built-in promises. Add your own to replace them.</li>}
                {draft.highlights.map((h, i) => (
                  <li key={h.id} className="space-y-2 rounded-xl border border-[rgba(30,23,16,0.1)] bg-[#FAF7F2] p-3">
                    <input aria-label="English text" placeholder="English" maxLength={60} value={h.textEn} onChange={(e) => setHighlights((x) => x.map((y) => (y.id === h.id ? { ...y, textEn: e.target.value } : y)))} className={field} />
                    <input aria-label="Bangla text" placeholder="বাংলা" maxLength={60} value={h.textBn} onChange={(e) => setHighlights((x) => x.map((y) => (y.id === h.id ? { ...y, textBn: e.target.value } : y)))} className={field} />
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn label="Move up" disabled={i === 0} onClick={() => setHighlights((x) => moveItem(x, i, i - 1))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Move down" disabled={i === draft.highlights.length - 1} onClick={() => setHighlights((x) => moveItem(x, i, i + 1))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label={h.visible ? 'Hide' : 'Show'} onClick={() => setHighlights((x) => x.map((y) => (y.id === h.id ? { ...y, visible: !y.visible } : y)))}>{h.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</IconBtn>
                      <IconBtn label="Delete" danger onClick={() => setHighlights((x) => x.filter((y) => y.id !== h.id))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {section === 'faqs' && (
            <Card title="FAQ" description="Add, edit, reorder, hide or delete questions. Empty list = built-in FAQ." action={
              <button type="button" onClick={() => setFaqs((x) => [...x, { id: newId(), qEn: '', aEn: '', qBn: '', aBn: '', visible: true }])} disabled={draft.faqs.length >= 30} className="inline-flex items-center gap-1 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add</button>
            }>
              <ul className="space-y-3">
                {draft.faqs.length === 0 && <li className="text-xs text-[#8A7867]">Using the built-in FAQ. Add your own questions to replace it.</li>}
                {draft.faqs.map((f, i) => (
                  <li key={f.id} className="space-y-2 rounded-xl border border-[rgba(30,23,16,0.1)] bg-[#FAF7F2] p-3">
                    <input aria-label="Question (English)" placeholder="Question (English)" maxLength={200} value={f.qEn} onChange={(e) => setFaqs((x) => x.map((y) => (y.id === f.id ? { ...y, qEn: e.target.value } : y)))} className={field} />
                    <textarea aria-label="Answer (English)" placeholder="Answer (English)" rows={2} maxLength={900} value={f.aEn} onChange={(e) => setFaqs((x) => x.map((y) => (y.id === f.id ? { ...y, aEn: e.target.value } : y)))} className={field} />
                    <input aria-label="প্রশ্ন (বাংলা)" placeholder="প্রশ্ন (বাংলা)" maxLength={200} value={f.qBn} onChange={(e) => setFaqs((x) => x.map((y) => (y.id === f.id ? { ...y, qBn: e.target.value } : y)))} className={field} />
                    <textarea aria-label="উত্তর (বাংলা)" placeholder="উত্তর (বাংলা)" rows={2} maxLength={900} value={f.aBn} onChange={(e) => setFaqs((x) => x.map((y) => (y.id === f.id ? { ...y, aBn: e.target.value } : y)))} className={field} />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#8A7867]">#{i + 1}{f.visible ? '' : ' · hidden'}</span>
                      <div className="flex items-center gap-1">
                        <IconBtn label="Move up" disabled={i === 0} onClick={() => setFaqs((x) => moveItem(x, i, i - 1))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label="Move down" disabled={i === draft.faqs.length - 1} onClick={() => setFaqs((x) => moveItem(x, i, i + 1))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label={f.visible ? 'Hide' : 'Show'} onClick={() => setFaqs((x) => x.map((y) => (y.id === f.id ? { ...y, visible: !y.visible } : y)))}>{f.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</IconBtn>
                        <IconBtn label="Delete" danger onClick={() => setFaqs((x) => x.filter((y) => y.id !== f.id))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Preview" description="Approximate look of your draft" action={
            <div className="flex items-center gap-1">
              {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} type="button" aria-label={`${d} preview`} aria-pressed={device === d} onClick={() => setDevice(d)} className={`flex h-8 w-8 items-center justify-center rounded-lg ${device === d ? 'bg-[#1E1710] text-[#FAF7F2]' : 'border border-[rgba(30,23,16,0.14)] text-[#635647]'}`}><Icon className="h-4 w-4" /></button>
              ))}
              <button type="button" onClick={() => setLang(lang === 'en' ? 'bn' : 'en')} className="ml-1 rounded-lg border border-[rgba(30,23,16,0.14)] px-2.5 py-1.5 text-xs font-medium">{lang === 'en' ? 'বাংলা' : 'EN'}</button>
            </div>
          }>
            <Preview content={draft} device={device} lang={lang} />
          </Card>

          <Card title="Version history" description="Each publish is saved. Restoring loads it into the draft only.">
            {!state || state.versions.length === 0 ? (
              <p className="text-xs text-[#8A7867]">No published versions yet.</p>
            ) : (
              <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
                {state.versions.map((v, i) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                    <span className="min-w-0">
                      <span className="block font-medium text-[#1E1710]">{dhaka.format(new Date(v.createdAtIso))}{i === 0 ? ' · current' : ''}</span>
                      <span className="block truncate text-[#8A7867]">{v.createdByEmail}</span>
                    </span>
                    {i > 0 && (
                      confirmRestoreId === v.id ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button type="button" onClick={() => restore(v)} disabled={busy} className="rounded-lg bg-[#1E1710] px-2.5 py-1.5 font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50">Confirm</button>
                          <button type="button" onClick={() => setConfirmRestoreId(null)} className="rounded-lg border border-[rgba(30,23,16,0.14)] px-2.5 py-1.5 font-medium hover:bg-[#F4EFE6]">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmRestoreId(v.id)} disabled={busy} className="rounded-lg border border-[rgba(30,23,16,0.14)] px-3 py-1.5 font-medium hover:bg-[#F4EFE6] disabled:opacity-50">Restore</button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-[rgba(30,23,16,0.1)] bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <p role="status" className={`min-w-0 truncate text-xs font-medium ${dirty ? 'text-amber-800' : 'text-[#8A5A17]'}`}>
            {dirty ? 'Unsaved changes in the editor' : msg || (state?.publishedAtIso ? `Live since ${dhaka.format(new Date(state.publishedAtIso))}` : 'Nothing published yet — the storefront uses built-in text')}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={!dirty || busy} onClick={() => state && setDraft(state.draft)} className="min-h-[40px] rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-4 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-50">Discard</button>
            <button type="button" disabled={!dirty || busy} onClick={() => void saveDraft()} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#1E1710] px-4 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save draft
            </button>
            {confirmPublish ? (
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={publish} className="min-h-[40px] rounded-lg bg-[#B47B2B] px-4 text-xs font-semibold text-white hover:bg-[#96621B] disabled:opacity-50">Confirm publish</button>
                <button type="button" onClick={() => setConfirmPublish(false)} className="min-h-[40px] rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3 text-xs font-medium hover:bg-[#F4EFE6]">Cancel</button>
              </div>
            ) : (
              <button type="button" disabled={busy || dirty || !(state?.hasUnpublishedChanges)} onClick={() => setConfirmPublish(true)} className="min-h-[40px] rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50">Publish</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.14)] bg-white text-[#635647] hover:bg-[#F4EFE6] disabled:opacity-30 ${danger ? 'hover:border-red-300 hover:text-red-700' : ''}`}>
      {children}
    </button>
  );
}
