// Normalização para achar candidatos a duplicata. Gera candidatos para
// revisão humana; nunca decide sozinha que duas empresas são a mesma.

const TRACKING_PARAM = /^(utm_.+|gclid|gbraid|wbraid|fbclid|msclkid|igshid|mc_cid|mc_eid|ref|ref_src|si|srsltid|_ga)$/i;

export function normalizeWebsiteForComparison(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) return null;
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  return `${host}${path}${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

// Últimos 10 dígitos (DDD + número no Brasil; código de área + número nos EUA),
// ignorando código de país e formatação. Menos de 10 dígitos não compara.
export function normalizePhoneForComparison(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export type DuplicateReason = 'SAME_WEBSITE' | 'SAME_PHONE_CITY';

export interface DuplicateComparable {
  id: string;
  website: string | null;
  phone: string | null;
  city: string | null;
}

export interface DuplicatePair {
  leadAId: string;
  leadBId: string;
  reasons: DuplicateReason[];
}

function cityKey(city: string | null): string | null {
  if (!city || city.trim() === '') return null;
  return city.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Pares (A < B) que compartilham site normalizado ou telefone + cidade.
// `onlyInvolving` limita aos pares que tocam esses ids (ingestão incremental).
export function findDuplicatePairs(leads: DuplicateComparable[], onlyInvolving?: ReadonlySet<string>): DuplicatePair[] {
  const buckets = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const list = buckets.get(key);
    if (list) list.push(id);
    else buckets.set(key, [id]);
  };
  for (const lead of leads) {
    const site = normalizeWebsiteForComparison(lead.website);
    if (site) add(`SAME_WEBSITE ${site}`, lead.id);
    const phone = normalizePhoneForComparison(lead.phone);
    const city = cityKey(lead.city);
    if (phone && city) add(`SAME_PHONE_CITY ${phone}|${city}`, lead.id);
  }
  const pairs = new Map<string, DuplicatePair>();
  for (const [key, ids] of buckets) {
    if (ids.length < 2) continue;
    const reason = key.slice(0, key.indexOf(' ')) as DuplicateReason;
    const sorted = [...new Set(ids)].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (onlyInvolving && !onlyInvolving.has(a) && !onlyInvolving.has(b)) continue;
        const pairKey = `${a}|${b}`;
        const pair = pairs.get(pairKey) ?? { leadAId: a, leadBId: b, reasons: [] };
        if (!pair.reasons.includes(reason)) pair.reasons.push(reason);
        pairs.set(pairKey, pair);
      }
    }
  }
  return [...pairs.values()];
}
