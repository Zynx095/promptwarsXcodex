import type { Db } from '../db/db';
import type { IndustryKey } from '../../shared/industries';
import type { OrgSettings, OrgSummary } from '../../shared/types';

export interface OrgRow extends OrgSummary {
  settings: OrgSettings;
}

export function getOrg(db: Db, id: string): OrgRow | undefined {
  const row = db.get<{
    id: string;
    name: string;
    industry: IndustryKey;
    timezone: string;
    currency: string;
    settings_json: string;
    is_synthetic: number;
  }>(`SELECT id, name, industry, timezone, currency, settings_json, is_synthetic FROM organizations WHERE id = @id`, { id });
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    timezone: row.timezone,
    currency: row.currency,
    synthetic: Boolean(row.is_synthetic),
    settings: withDefaults(JSON.parse(row.settings_json) as Partial<OrgSettings> & Pick<OrgSettings, 'pay' | 'fatigue'>),
  };
}

/** Settings saved before a rule group existed get its defaults. */
function withDefaults(s: Partial<OrgSettings> & Pick<OrgSettings, 'pay' | 'fatigue'>): OrgSettings {
  return { pay: s.pay, fatigue: s.fatigue, attendance: s.attendance ?? { requireSiteCode: false } };
}

export function requireOrg(db: Db, id: string): OrgRow {
  const org = getOrg(db, id);
  if (!org) throw new Error(`Organisation ${id} missing`);
  return org;
}

export function updateOrgSettings(db: Db, id: string, settings: OrgSettings): void {
  db.run(`UPDATE organizations SET settings_json = @json WHERE id = @id`, { id, json: JSON.stringify(settings) });
}

export function toSummary(org: OrgRow): OrgSummary {
  const { settings: _settings, ...summary } = org;
  return summary;
}
