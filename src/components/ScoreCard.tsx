'use client';

import { InvestmentScore, Confidence, Provenance } from '@/core/types';
import { AlertTriangle, Info, ChevronRight } from 'lucide-react';

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-rose-50 text-rose-700 border-rose-200',
};

const PROVENANCE_LABEL: Record<Provenance, string> = {
  live: 'Live',
  structural: 'Estimated',
  enriched: 'Enriched',
  derived: 'Derived',
  unavailable: 'Unavailable',
};

const PILLAR_COLOR: Record<string, string> = {
  demandPressure: 'bg-blue-500',
  networkGravity: 'bg-purple-500',
  revenueQuality: 'bg-emerald-500',
  growthMomentum: 'bg-amber-500',
};

function scoreTone(score: number) {
  if (score >= 70) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (score >= 50) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

export function ScoreCard({ data }: { data: InvestmentScore }) {
  const { airport, pillars, risk, snapshot } = data;

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow flex flex-col">
      <div className="flex justify-between items-start gap-3 border-b border-slate-100 pb-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800 truncate">{airport.name}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {airport.iata} / {airport.icao} &middot; {airport.country} &middot; {airport.runways.count} runway{airport.runways.count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-none">
          <div className={`text-lg font-black w-12 h-12 rounded-xl flex items-center justify-center border ${scoreTone(data.finalScore)}`}>
            {data.finalScore}
          </div>
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${CONFIDENCE_STYLE[data.confidence]}`}>
            {data.confidence} conf.
          </span>
        </div>
      </div>

      <div className="space-y-3.5 flex-1">
        {pillars.map((p) => {
          const excluded = p.weight === 0;
          return (
            <div key={p.key} title={`${p.formula}\n\n${p.rationale}`} className={excluded ? 'opacity-45' : ''}>
              <div className="flex justify-between text-[11px] font-semibold mb-1.5 gap-2">
                <span className="text-slate-500 uppercase tracking-wider truncate">
                  {p.label}
                  <span className="text-slate-300 normal-case tracking-normal ml-1.5">
                    {excluded ? 'excluded' : `w ${(p.weight * 100).toFixed(0)}%`}
                  </span>
                </span>
                <span className="text-slate-800 flex-none">{excluded ? 'n/a' : p.score}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                {!excluded && (
                  <div className={`${PILLAR_COLOR[p.key]} h-2 rounded-full transition-all duration-700 ease-out`} style={{ width: `${p.score}%` }} />
                )}
              </div>
            </div>
          );
        })}
        {data.redistributedFrom.length > 0 && (
          <p className="text-[9px] text-slate-400 leading-snug pt-0.5">
            No data for {data.redistributedFrom.length} pillar; its weight was redistributed across the rest rather than scored as neutral.
          </p>
        )}
      </div>

      {risk.flags.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
          {risk.flags.slice(0, 2).map((f) => (
            <div key={f.code} className="flex gap-1.5 text-[10px] text-amber-700 leading-snug">
              <AlertTriangle size={12} className="flex-none mt-0.5" />
              <span>{f.message}</span>
            </div>
          ))}
          <p className="text-[9px] text-slate-400 uppercase tracking-wider pt-1">
            Risk multiplier applied: x{risk.multiplier.toFixed(3)}
          </p>
        </div>
      )}

      <ScoreAudit data={data} />

      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-y-1.5 text-[10px]">
        <Metric label="Departures/day" value={String(snapshot.dailyDepartures.value)} provenance={snapshot.dailyDepartures.provenance} note={snapshot.dailyDepartures.note} />
        <Metric label="Destinations" value={String(snapshot.uniqueDestinations.value)} provenance={snapshot.uniqueDestinations.provenance} note={snapshot.uniqueDestinations.note} />
        <Metric label="Long-haul" value={`${(snapshot.longHaulShare.value * 100).toFixed(0)}%`} provenance={snapshot.longHaulShare.provenance} note={snapshot.longHaulShare.note} />
        <Metric
          label="Unmet demand"
          value={snapshot.delayShare.provenance === 'unavailable' ? 'n/a' : `${(data.unmetDemandShare * 100).toFixed(0)}%`}
          provenance={snapshot.delayShare.provenance}
          note={`Departures delayed beyond 15 minutes or cancelled outright. Delayed ${(snapshot.delayShare.value * 100).toFixed(0)}%, cancelled ${(snapshot.cancelledShare.value * 100).toFixed(0)}%.`}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, provenance, note }: { label: string; value: string; provenance: Provenance; note?: string }) {
  const tone =
    provenance === 'live' ? 'text-emerald-600'
    : provenance === 'enriched' ? 'text-blue-600'
    : provenance === 'derived' ? 'text-slate-500'
    : provenance === 'structural' ? 'text-amber-600'
    : 'text-slate-300';

  return (
    <div className="flex flex-col" title={note ?? `Source: ${PROVENANCE_LABEL[provenance]}`}>
      <span className="text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-slate-700 font-semibold flex items-center gap-1">
        {value}
        <span className={`text-[8px] uppercase tracking-wider ${tone}`}>{PROVENANCE_LABEL[provenance]}</span>
        {note && <Info size={9} className="text-slate-300" />}
      </span>
    </div>
  );
}

/**
 * The arithmetic behind this specific score, expanded on demand.
 *
 * This is the methodology made concrete. The Methodology tab explains the model
 * in general; this shows the analyst the exact chain of numbers that produced
 * the score they are looking at, straight out of the deterministic engine. No
 * figure on this card originates in a language model.
 */
function ScoreAudit({ data }: { data: InvestmentScore }) {
  const scoring = data.pillars.filter((p) => p.weight > 0);

  return (
    <details className="mt-4 pt-3 border-t border-slate-100 group">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600 hover:text-blue-700">
        <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
        Show the arithmetic
      </summary>

      <div className="mt-3 space-y-3">
        {scoring.map((p) => (
          <div key={p.key} className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">{p.label}</span>
              <span className="text-[10px] font-mono text-slate-500">
                {p.score} × {(p.weight * 100).toFixed(0)}% = {p.contribution}
              </span>
            </div>
            <pre className="text-[9px] font-mono text-emerald-700 whitespace-pre-wrap leading-relaxed mb-1.5">{p.formula}</pre>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {Object.entries(p.inputs).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-[9px]">
                  <dt className="text-slate-400 truncate">{k}</dt>
                  <dd className="text-slate-700 font-mono flex-none">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        <div className="rounded-lg bg-slate-900 text-slate-100 p-2.5 font-mono text-[9px] leading-relaxed">
          <div className="flex justify-between">
            <span className="text-slate-400">weighted sum</span><span>{data.rawScore}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">risk multiplier</span><span>× {data.risk.multiplier.toFixed(3)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-700 mt-1 pt-1 font-bold">
            <span>final score</span><span>{data.finalScore}</span>
          </div>
        </div>

        {data.redistributedFrom.length > 0 && (
          <p className="text-[9px] text-slate-400 leading-relaxed">
            {data.redistributedFrom.join(', ')} could not be measured, so it was excluded
            and its weight redistributed. The percentages above already reflect that.
          </p>
        )}
      </div>
    </details>
  );
}
