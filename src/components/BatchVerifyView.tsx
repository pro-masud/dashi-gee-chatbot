'use client';

import { FormEvent, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ExternalLink,
  FileCheck2,
  Loader2,
  QrCode,
  Search,
} from 'lucide-react';
import {
  BatchRecord,
  fetchBatchRecord,
} from '../lib/firebase';
import { Lang } from '../data/deshiGeeData';

interface BatchVerifyViewProps {
  lang: Lang;
  initialBatchCode: string;
  onBackHome: () => void;
}

export function BatchVerifyView({
  lang,
  initialBatchCode,
  onBackHome,
}: BatchVerifyViewProps) {
  const [codeInput, setCodeInput] = useState(initialBatchCode || '');
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const bn = lang === 'bn';

  const lookupBatch = async (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      setBatch(null);
      setNotFound(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const record = await fetchBatchRecord(clean);
      if (!record || !record.batchCode) {
        setBatch(null);
        setNotFound(true);
      } else {
        setBatch(record);
        const verifyLink = `${window.location.origin}/batch?code=${encodeURIComponent(record.batchCode)}`;
        const qrData = await QRCode.toDataURL(verifyLink, {
          width: 220,
          margin: 1,
          color: { dark: '#1E1710', light: '#FAF7F2' },
        });
        setQrUrl(qrData);
      }
    } catch {
      setBatch(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialBatchCode) {
      lookupBatch(initialBatchCode);
    }
  }, [initialBatchCode]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    lookupBatch(codeInput);
  };

  return (
    <section className="mx-auto min-h-[75vh] max-w-4xl px-4 py-10 sm:px-8 sm:py-14">
      <button
        type="button"
        onClick={onBackHome}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-[var(--c-muted)] hover:text-[var(--c-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{bn ? 'স্টোরফ্রন্টে ফিরে যান' : 'Back to Deshi Gee'}</span>
      </button>

      <div className="mt-6">
        <p className="text-xs font-medium text-[var(--c-gold-text)]">
          {bn ? 'ব্যাচ ও উৎস যাচাইকরণ' : 'Batch Provenance & Verification'}
        </p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight text-[var(--c-ink)] sm:text-5xl">
          {bn
            ? 'জারের ব্যাচ নম্বর ও ল্যাব তথ্য যাচাই করুন'
            : 'Verify Jar Batch & Lab Transparency'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex flex-col gap-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-5 sm:flex-row sm:p-6"
      >
        <input
          type="text"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          placeholder={bn ? 'জারের গায়ে থাকা ব্যাচ কোড লিখুন' : 'Enter batch code from jar label'}
          aria-label="Batch code"
          className="min-h-[48px] flex-1 rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] px-4 py-2.5 font-mono text-base uppercase text-[var(--c-ink)] focus:border-[var(--c-accent)] focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={loading || !codeInput.trim()}
          className="btn-primary min-h-[48px] px-7"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          <span>{bn ? 'যাচাই করুন' : 'Verify Batch'}</span>
        </button>
      </form>

      {!loading && !batch && !notFound && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-6 text-center sm:p-8">
          <p className="font-display text-lg font-semibold text-[var(--c-ink)]">
            {bn ? 'ব্যাচ কোড দিয়ে যাচাই করুন' : 'Enter a Batch Code to Verify'}
          </p>
          <p className="mt-2 text-sm text-[var(--c-muted)]">
            {bn
              ? 'জারের ট্যাগে থাকা ব্যাচ কোড লিখুন। কোনো ব্যাচ এখনো যুক্ত না হয়ে থাকলে রেকর্ডটি পেন্ডিং হিসেবে দেখাবে।'
              : 'Enter the batch code printed on your jar label. Unrecorded batches will show as pending entry.'}
          </p>
        </div>
      )}

      {notFound && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-6 text-center sm:p-8">
          <p className="font-display text-xl font-semibold text-[var(--c-ink)]">
            {bn ? 'ব্যাচ পাওয়া যায়নি / এন্ট্রি পেন্ডিং' : 'Batch Not Found / Pending Entry'}
          </p>
          <p className="mt-2 text-sm text-[var(--c-muted)]">
            {bn
              ? 'এই ব্যাচ কোডটি এখনো আমাদের যাচাইকৃত রেকর্ডে যুক্ত হয়নি। জারের ট্যাগ মিলিয়ে আবার চেষ্টা করুন।'
              : 'This batch code is not yet recorded in our verified registry. Please check your jar tag or contact support.'}
          </p>
        </div>
      )}

      {batch && (
        <div className="mt-8 grid grid-cols-1 gap-6 rounded-2xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-5 sm:gap-8 sm:p-8 md:grid-cols-12">
          <div className="flex flex-col items-center justify-center rounded-xl border border-[rgb(var(--c-tint)/0.10)] bg-[var(--c-bg)] p-6 md:col-span-4">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={`QR code for batch ${batch.batchCode}`}
                className="h-44 w-44 rounded-lg"
              />
            ) : (
              <QrCode className="h-24 w-24 text-[var(--c-gold-text)]" />
            )}
            <p className="mt-3 font-mono text-xs font-medium text-[var(--c-ink)]">
              {batch.batchCode}
            </p>
            <p className="mt-1 text-center text-[11px] text-[var(--c-muted)]">
              {bn
                ? 'এই ব্যাচের সরাসরি লিংক স্ক্যান করুন'
                : 'Scan to open this batch record'}
            </p>
          </div>

          <div className="space-y-4 md:col-span-8">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--c-gold-text)]">
              <FileCheck2 className="h-4 w-4" />
              <span>
                {batch.active
                  ? bn
                    ? 'সক্রিয় ব্যাচ রেকর্ড'
                    : 'Active Recorded Batch'
                  : bn
                    ? 'আর্কাইভ ব্যাচ'
                    : 'Archived Batch'}
              </span>
            </div>

            <dl className="divide-y divide-[rgb(var(--c-tint)/0.10)] border-y border-[rgb(var(--c-tint)/0.10)] text-sm">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="shrink-0 text-[var(--c-muted)]">{bn ? 'উৎপাদন উৎস' : 'Milk Origin'}</dt>
                <dd className="text-right font-medium text-[var(--c-ink)]">
                  {batch.originDistrict}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="shrink-0 text-[var(--c-muted)]">{bn ? 'উপাদান' : 'Source Material'}</dt>
                <dd className="text-right font-medium text-[var(--c-ink)]">
                  {batch.milkSource}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-[var(--c-muted)]">{bn ? 'উৎপাদনের তারিখ' : 'Production Date'}</dt>
                <dd className="font-mono text-right text-[var(--c-ink)]">
                  {batch.productionDate}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-[var(--c-muted)]">{bn ? 'মেয়াদোত্তীর্ণ' : 'Best Before'}</dt>
                <dd className="font-mono text-right text-[var(--c-ink)]">
                  {batch.expiryDate}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-[var(--c-muted)]">{bn ? 'লাইসেন্স তথ্য' : 'Regulatory Licence'}</dt>
                <dd className="text-right text-[var(--c-ink)]">{batch.licenceDetails}</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-[var(--c-muted)]">{bn ? 'ল্যাব রিপোর্ট' : 'Lab Report Status'}</dt>
                <dd className="text-right text-[var(--c-ink)]">{batch.labReportStatus}</dd>
              </div>
            </dl>

            {batch.labReportUrl ? (
              <a
                href={batch.labReportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--c-accent)] px-5 py-2.5 text-xs font-medium text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)]"
              >
                <span>{bn ? 'ল্যাব রিপোর্ট PDF খুলুন' : 'View / Download Lab Report PDF'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-xs text-[var(--c-muted)]">
                {bn
                  ? 'অ্যাডমিন প্যানেল থেকে পিডিএফ রিপোর্ট লিংক যুক্ত করলে এখান থেকে ডাউনলোড করা যাবে।'
                  : 'Verified PDF download appears automatically once uploaded or linked in the Admin Dashboard.'}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
