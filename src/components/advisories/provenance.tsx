import { ExternalLink, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react';
import { ProvenanceBadge } from '@/components/ui/badges';
import { DATA_KIND_META, fmtDateTime, type DataKind } from '@/lib/domain';
import { ProviderChip } from './badges';

export type ProvenanceInfo = {
  provider: string;
  modelName: string;
  promptVersion: string;
  fallbackReason: string | null;
  generatedAt: string;
  generatedByName?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Who/what generated the advisory and how — shown on every advisory. */
export function ProvenanceList({ p }: { p: ProvenanceInfo }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="divide-y divide-line">
        <Row label="Provider">
          <ProviderChip provider={p.provider} modelName={p.modelName} fallback={Boolean(p.fallbackReason)} />
        </Row>
        <Row label="Model">
          <span className="font-mono text-xs">{p.modelName}</span>
        </Row>
        <Row label="Prompt / template">
          <span className="font-mono text-xs">{p.promptVersion}</span>
        </Row>
        <Row label="Generated">
          {fmtDateTime(p.generatedAt)}
          {p.generatedByName ? <span className="text-fg-muted"> · {p.generatedByName}</span> : null}
        </Row>
        {p.approvedAt && (
          <Row label="Approved">
            {fmtDateTime(p.approvedAt)}
            {p.approvedByName ? <span className="text-fg-muted"> · {p.approvedByName}</span> : null}
          </Row>
        )}
        {p.publishedAt && <Row label="Published">{fmtDateTime(p.publishedAt)}</Row>}
      </dl>
      {p.fallbackReason && (
        <p className="flex gap-2 rounded-xl border border-dashed border-[var(--sev-moderate)] px-3 py-2 text-xs leading-relaxed text-fg-muted" role="note">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--sev-moderate-fg)]" />
          <span>
            <strong className="text-fg">Fallback used:</strong> {p.fallbackReason}
          </span>
        </p>
      )}
    </div>
  );
}

const KINDS = new Set(Object.keys(DATA_KIND_META));

/** Server-attached data-source references (never produced by the model). */
export function SourceRefs({ refs }: { refs: { name: string; url?: string; kind: string; retrievedAt?: string }[] }) {
  if (!refs.length) return <p className="text-sm text-fg-muted">No source references recorded.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {refs.map((r, i) => (
        <li key={i} className="flex flex-col gap-1">
          <span className="flex items-start gap-1.5 text-sm font-medium">
            {r.url && /^https?:\/\//.test(r.url) ? (
              <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-accent hover:underline">
                {r.name} <ExternalLink aria-hidden className="size-3 shrink-0" />
              </a>
            ) : r.url?.startsWith('/') ? (
              <a href={r.url} className="hover:text-accent hover:underline">
                {r.name}
              </a>
            ) : (
              r.name
            )}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {KINDS.has(r.kind) ? <ProvenanceBadge kind={r.kind as DataKind} /> : <span className="text-[11px] text-fg-subtle">{r.kind}</span>}
            {r.retrievedAt && <span className="text-[11px] text-fg-subtle">run {fmtDateTime(r.retrievedAt)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Official warnings are kept visually separate from CLIMATIQ content. None are ingested today. */
export function OfficialWarningsNotice({
  warnings,
  compact = false,
}: {
  warnings: { id: number; title: string; colorCode: string; regionName: string; url: string; issuedAt: string }[];
  compact?: boolean;
}) {
  return (
    <section aria-label="Official warnings" className="rounded-2xl border border-[#1d4f7a]/30 bg-[#1d4f7a]/[0.04] px-4 py-3 dark:border-[#7fb2e5]/30 dark:bg-[#7fb2e5]/[0.05]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-[#1d4f7a] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          <ShieldCheck aria-hidden className="size-3" /> Official warnings · IMD
        </span>
        {warnings.length === 0 && (
          <span className="flex items-center gap-1.5 text-sm text-fg-muted">
            <ShieldOff aria-hidden className="size-3.5" /> None available in CLIMATIQ
          </span>
        )}
      </div>
      {warnings.length === 0 ? (
        !compact && (
          <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
            CLIMATIQ has no verified official warning feed, so no IMD warnings are shown here. Everything else on this page is CLIMATIQ-generated decision support. Always check{' '}
            <a href="https://mausam.imd.gov.in/" target="_blank" rel="noreferrer noopener" className="font-medium text-accent hover:underline">
              mausam.imd.gov.in
            </a>{' '}
            and state disaster-management advisories before acting.
          </p>
        )
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li key={w.id} className="text-sm">
              <a href={w.url} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">
                {w.title}
              </a>{' '}
              <span className="text-fg-muted">
                · {w.regionName} · {w.colorCode} · issued {fmtDateTime(w.issuedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Inspect inputs": the exact, validated forecast bundle the provider received. */
export function BundleInspector({ bundle }: { bundle: unknown }) {
  if (!bundle) return <p className="text-sm text-fg-muted">The input bundle was not recorded for this advisory.</p>;
  const json = JSON.stringify(bundle, null, 2);
  return (
    <details className="group rounded-2xl border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-semibold hover:bg-accent-soft">
        <span>Inspect inputs — exact forecast bundle sent to the provider</span>
        <span className="text-xs font-normal text-fg-subtle group-open:hidden">Show JSON ({Math.round(json.length / 1024)} KB)</span>
        <span className="hidden text-xs font-normal text-fg-subtle group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 text-xs text-fg-muted">
          Validated with the <code className="font-mono">ForecastBundleSchema</code> before generation. The provider may only use these facts; source references are attached by the server.
        </p>
        <pre className="max-h-[28rem] overflow-auto rounded-xl bg-[color-mix(in_srgb,var(--fg)_6%,transparent)] p-3 font-mono text-[11px] leading-relaxed" tabIndex={0}>
          {json}
        </pre>
      </div>
    </details>
  );
}
