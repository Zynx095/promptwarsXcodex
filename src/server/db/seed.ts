// Deterministic synthetic demonstration data for one construction site and one college campus.
// All people, phone numbers, shifts, reports and payslips are fictional and flagged is_synthetic.
// Dates are generated relative to the seeding day from a fixed pseudo-random sequence, so the
// same seed day always yields the same dataset.
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import type { OrgSettings, Role, Severity } from '../../shared/types';
import type { IndustryKey } from '../../shared/industries';
import { addDays, localDate, startOfLocalDay } from '../../shared/time';
import { hashPin } from '../auth/crypto';
import { requireOrg, type OrgRow } from '../repositories/orgs';
import { recordAudit } from '../repositories/audit';
import { evaluateWorkerFatigue } from '../services/fatigue';
import { issuePayslip } from '../services/payslips';
import { generateReceiptForShift } from '../services/receipts';
import { createReport, transitionReport } from '../services/reports';
import { submitFeedback } from '../services/feedback';
import { addSkill } from '../services/skills';
import { createSite } from '../repositories/sites';
import { createNotification } from '../repositories/notifications';

export const DEMO_PIN = '1234';
const TZ = 'Asia/Kolkata';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pattern returns [start minute of local day, duration minutes] or null for a day off. */
type Pattern = (weekday: number, dayIndex: number, rand: () => number) => [number, number] | null;

interface SeedWorker {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  team: string;
  rate: number;
  pattern: Pattern;
}

interface SeedOrg {
  id: string;
  name: string;
  industry: IndustryKey;
  settings: OrgSettings;
  admin: { id: string; name: string; phone: string; jobTitle: string };
  workers: SeedWorker[];
}

const jitter = (rand: () => number, spread: number) => Math.round((rand() - 0.5) * 2 * spread);
const dayShift =
  (start: number, hours: number, spread = 10): Pattern =>
  (wd, _i, rand) =>
    wd === 0 ? null : [start + jitter(rand, spread), Math.round(hours * 60) + jitter(rand, 15)];

const ORGS: SeedOrg[] = [
  {
    id: 'org_demo_construction',
    name: 'Sunrise Infra Builders – Site 14 (synthetic demo)',
    industry: 'construction',
    settings: {
      pay: {
        scheduledDailyMinutes: 480,
        overtimeMultiplierBp: 20000,
        deductions: [
          { code: 'pf', label: 'Provident fund (demo rule)', kind: 'percent_of_base', value: 1200 },
          { code: 'welfare', label: 'Welfare fund (demo rule)', kind: 'percent_of_gross', value: 100 },
        ],
      },
      fatigue: { maxDailyMinutes: 600, maxWeeklyMinutes: 3600, minRestMinutes: 600, overtimeDaysPerWeek: 3 },
      attendance: { requireSiteCode: false },
    },
    admin: { id: 'usr_demo_c_admin', name: 'Priya Raman', phone: '9000000100', jobTitle: 'Site manager' },
    workers: [
      { id: 'usr_demo_c_ravi', name: 'Ravi Kumar', phone: '9000000001', jobTitle: 'Mason', team: 'Crew A', rate: 9500, pattern: dayShift(8 * 60, 8.5) },
      { id: 'usr_demo_c_lakshmi', name: 'Lakshmi Devi', phone: '9000000002', jobTitle: 'Helper', team: 'Crew A', rate: 7500, pattern: dayShift(8 * 60, 8) },
      {
        id: 'usr_demo_c_irfan',
        name: 'Mohammed Irfan',
        phone: '9000000003',
        jobTitle: 'Electrician',
        team: 'Crew B',
        rate: 12000,
        // Long days early in the week: produces overtime and excessive-hours warnings.
        pattern: (wd, _i, rand) => (wd === 0 ? null : [7 * 60 + jitter(rand, 10), (wd <= 4 ? 10.75 : 8) * 60 + jitter(rand, 10)]),
      },
      {
        id: 'usr_demo_c_suresh',
        name: 'Suresh Naik',
        phone: '9000000004',
        jobTitle: 'Scaffolder',
        team: 'Crew B',
        rate: 9000,
        // A late Wednesday finish followed by an early Thursday start: a short-rest warning.
        pattern: (wd, _i, rand) => {
          if (wd === 0) return null;
          if (wd === 3) return [13 * 60, 9.5 * 60];
          if (wd === 4) return [6 * 60, 8 * 60];
          return [8 * 60 + jitter(rand, 10), 8 * 60 + jitter(rand, 15)];
        },
      },
    ],
  },
  {
    id: 'org_demo_campus',
    name: 'Greenfield Institute of Technology – Campus Services (synthetic demo)',
    industry: 'education',
    settings: {
      pay: {
        scheduledDailyMinutes: 480,
        overtimeMultiplierBp: 15000,
        deductions: [
          { code: 'pf', label: 'Provident fund (demo rule)', kind: 'percent_of_base', value: 1200 },
          { code: 'health', label: 'Health insurance contribution (demo rule)', kind: 'percent_of_gross', value: 75 },
        ],
      },
      fatigue: { maxDailyMinutes: 600, maxWeeklyMinutes: 2880, minRestMinutes: 660, overtimeDaysPerWeek: 3 },
      attendance: { requireSiteCode: false },
    },
    admin: { id: 'usr_demo_e_admin', name: 'Anita Desai', phone: '9100000100', jobTitle: 'Facilities officer' },
    workers: [
      {
        id: 'usr_demo_e_manjula',
        name: 'Manjula S',
        phone: '9100000001',
        jobTitle: 'Housekeeping staff',
        team: 'Hostel blocks',
        rate: 7000,
        pattern: dayShift(7 * 60, 8),
      },
      {
        id: 'usr_demo_e_ramesh',
        name: 'Ramesh Gowda',
        phone: '9100000002',
        jobTitle: 'Security guard',
        team: 'Security',
        rate: 8000,
        // 12-hour night shifts five nights a week.
        pattern: (wd) => (wd === 0 || wd === 6 ? null : [20 * 60, 12 * 60]),
      },
      {
        id: 'usr_demo_e_fatima',
        name: 'Fatima Begum',
        phone: '9100000003',
        jobTitle: 'Sanitation worker',
        team: 'Sanitation',
        rate: 7200,
        pattern: dayShift(6 * 60, 8.5),
      },
      {
        id: 'usr_demo_e_venkatesh',
        name: 'Venkatesh R',
        phone: '9100000004',
        jobTitle: 'Maintenance technician',
        team: 'Maintenance',
        rate: 10000,
        pattern: (wd, i, rand) => (wd === 0 ? null : [9 * 60 + jitter(rand, 10), (i % 3 === 0 ? 9.5 : 8) * 60 + jitter(rand, 10)]),
      },
    ],
  },
];

export function seedIfEmpty(ctx: AppContext): boolean {
  const existing = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM organizations')!.n;
  if (existing > 0) return false;
  ctx.db.tx(() => {
    for (const org of ORGS) seedOrg(ctx, org);
  });
  return true;
}

function insertUser(
  ctx: AppContext,
  orgId: string,
  role: Role,
  u: { id: string; name: string; phone: string; jobTitle: string; team?: string; rate?: number },
  at: string,
) {
  ctx.db.run(
    `INSERT INTO users (id, org_id, role, name, phone, pin_hash, job_title, team, hourly_rate_minor, is_synthetic, created_at)
     VALUES (@id, @orgId, @role, @name, @phone, @pinHash, @jobTitle, @team, @rate, 1, @at)`,
    { id: u.id, orgId, role, name: u.name, phone: u.phone, pinHash: hashPin(DEMO_PIN), jobTitle: u.jobTitle, team: u.team ?? '', rate: u.rate ?? 0, at },
  );
  ctx.db.run(
    `INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, email, created_at, last_sign_in_at)
     VALUES (@identId, @userId, 'phone_pin', @phone, @email, @at, @at)`,
    {
      identId: `ident_${u.id}`,
      userId: u.id,
      phone: u.phone,
      email: `${u.id.replace('usr_demo_', '')}@fairshift.demo`,
      at,
    },
  );
}

function seedOrg(ctx: AppContext, spec: SeedOrg) {
  const now = ctx.now();
  const nowIso = now.toISOString();
  const today = localDate(now, TZ);
  ctx.db.run(
    `INSERT INTO organizations (id, name, industry, timezone, currency, settings_json, is_synthetic, created_at)
     VALUES (@id, @name, @industry, @tz, 'INR', @settings, 1, @at)`,
    { id: spec.id, name: spec.name, industry: spec.industry, tz: TZ, settings: JSON.stringify(spec.settings), at: nowIso },
  );
  insertUser(ctx, spec.id, 'admin', spec.admin, nowIso);
  for (const w of spec.workers) insertUser(ctx, spec.id, 'worker', w, nowIso);
  const org = requireOrg(ctx.db, spec.id);

  // ---- Shifts for the last 14 days ----
  spec.workers.forEach((w, wi) => {
    const rand = mulberry32(1000 + wi * 97 + (spec.industry === 'construction' ? 0 : 5000));
    let hasOpen = false;
    for (let i = 14; i >= 1; i--) {
      const date = addDays(today, -i);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const slot = w.pattern(weekday, i, rand);
      if (!slot) continue;
      const start = new Date(startOfLocalDay(date, TZ).getTime() + slot[0] * 60000);
      const end = new Date(start.getTime() + slot[1] * 60000);
      if (start >= now) continue;
      const open = end > now;
      if (open && hasOpen) continue;
      hasOpen ||= open;
      insertSeedShift(ctx, org, w.id, start.toISOString(), open ? null : end.toISOString());
    }
    // The first construction worker is on shift right now.
    if (wi === 0 && spec.industry === 'construction' && !hasOpen) {
      insertSeedShift(ctx, org, w.id, new Date(now.getTime() - 135 * 60000).toISOString(), null);
    }
    evaluateWorkerFatigue(ctx, org, w.id);
  });

  // ---- Payslips for the previous full week (Monday–Sunday) ----
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const lastMonday = addDays(today, -dow - 7);
  const lastSunday = addDays(lastMonday, 6);
  for (const w of spec.workers) {
    try {
      issuePayslip(ctx, org, spec.admin.id, w.id, lastMonday, lastSunday, { synthetic: true });
    } catch {
      // A worker with an open shift in the period gets no issued payslip, as in real use.
    }
  }

  // ---- Safety reports with history ----
  const admin = { id: spec.admin.id, orgId: org.id, role: 'admin' as const };
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();
  const reports: {
    by: number;
    category: string;
    severity: Severity;
    title: string;
    description: string;
    location: string;
    confidential: boolean;
    hoursAgo: number;
    steps: { to: 'acknowledged' | 'in_progress' | 'resolved'; note: string; assignee?: string; hoursAgo: number }[];
  }[] =
    spec.industry === 'construction'
      ? [
          {
            by: 2,
            category: 'fall',
            severity: 'critical',
            title: 'No guardrail on 3rd floor slab edge',
            description: 'The east edge of the 3rd floor slab has no guardrail or toe board. Workers carry blocks along this edge.',
            location: 'Tower B, 3rd floor, east side',
            confidential: false,
            hoursAgo: 30,
            steps: [{ to: 'acknowledged', note: 'Area cordoned off with tape until rail arrives.', assignee: 'Safety supervisor – Crew B', hoursAgo: 26 }],
          },
          {
            by: 1,
            category: 'ppe',
            severity: 'high',
            title: 'Not enough helmets for helpers',
            description: 'New helpers were told to share helmets. Several work without helmets in the morning shift.',
            location: 'Main store / Crew A',
            confidential: true,
            hoursAgo: 50,
            steps: [],
          },
          {
            by: 3,
            category: 'electrical',
            severity: 'medium',
            title: 'Loose wiring near concrete mixer',
            description: 'Temporary power cable to the mixer is lying in standing water with a taped joint.',
            location: 'Batching area',
            confidential: false,
            hoursAgo: 120,
            steps: [
              { to: 'acknowledged', note: 'Electrician informed.', assignee: 'Site electrician', hoursAgo: 118 },
              { to: 'in_progress', note: 'Cable being re-routed overhead.', hoursAgo: 100 },
              { to: 'resolved', note: 'Cable replaced with armoured cable on stand; joint removed.', hoursAgo: 96 },
            ],
          },
        ]
      : [
          {
            by: 2,
            category: 'chemical',
            severity: 'high',
            title: 'Toilet cleaning acid used without gloves',
            description: 'Gloves and masks have not been supplied for two weeks. Staff are using acid cleaner with bare hands.',
            location: 'Academic Block A washrooms',
            confidential: false,
            hoursAgo: 72,
            steps: [
              { to: 'acknowledged', note: 'Purchase order raised for gloves and masks.', assignee: 'Stores in-charge', hoursAgo: 60 },
              { to: 'in_progress', note: 'Partial stock received; distributing to sanitation team first.', hoursAgo: 20 },
            ],
          },
          {
            by: 0,
            category: 'slip',
            severity: 'medium',
            title: 'Wet floor near Block B stairs, no sign',
            description: 'Water leaks from the cooler onto the stair landing every afternoon. No warning sign is available.',
            location: 'Block B, ground floor stairs',
            confidential: false,
            hoursAgo: 10,
            steps: [],
          },
          {
            by: 1,
            category: 'security',
            severity: 'high',
            title: 'Night patrol route unlit behind hostel',
            description: 'Three street lights behind the girls hostel are not working. The patrol route is completely dark after 10 pm.',
            location: 'Hostel rear road',
            confidential: true,
            hoursAgo: 40,
            steps: [{ to: 'acknowledged', note: 'Electrical maintenance asked to inspect lights.', assignee: 'Maintenance team', hoursAgo: 35 }],
          },
        ];
  for (const r of reports) {
    const worker = spec.workers[r.by]!;
    const actor = { id: worker.id, orgId: org.id, role: 'worker' as const };
    const created = createReport(
      ctx,
      org,
      actor,
      { category: r.category, severity: r.severity, title: r.title, description: r.description, location: r.location, confidential: r.confidential },
      { synthetic: true, at: ago(r.hoursAgo) },
    );
    for (const s of r.steps) transitionReport(ctx, admin, created.id, { to: s.to, note: s.note, assignee: s.assignee }, { at: ago(s.hoursAgo) });
  }

  // ---- Anonymous feedback ----
  const feedback: [string, number | null, string | null, number][] =
    spec.industry === 'construction'
      ? [
          ['pay', 2, 'Overtime for last month was paid late.', 3],
          ['pay', 3, null, 5],
          ['pay', 2, null, 6],
          ['facilities', 1, 'Drinking water tank on Tower B is empty by noon.', 2],
          ['facilities', 2, null, 4],
          ['facilities', 2, 'No shade near the batching area.', 8],
          ['hours', 3, null, 1],
          ['treatment', 4, 'Supervisor on Crew A explains tasks clearly.', 9],
        ]
      : [
          ['workload', 2, 'Two people cover four hostel blocks on weekends.', 1],
          ['workload', 2, null, 3],
          ['workload', 3, null, 6],
          ['facilities', 3, 'Rest room for sanitation staff is also used as store.', 4],
          ['pay', 3, null, 2],
          ['pay', 4, null, 7],
          ['pay', 3, null, 9],
          ['treatment', 2, 'Some students shout at cleaning staff.', 5],
        ];
  for (const [category, rating, comment, daysAgo] of feedback) {
    submitFeedback(ctx, org, { category, rating, comment: comment ?? undefined }, { synthetic: true, on: addDays(today, -daysAgo) });
  }

  // ---- Skill passport entries ----
  const adminActor = { id: spec.admin.id, role: 'admin' as const };
  spec.workers.forEach((w, i) => {
    const self = { id: w.id, role: 'worker' as const };
    addSkill(
      ctx,
      org,
      self,
      w.id,
      { kind: 'skill', name: w.jobTitle, description: `${4 + i * 2} years of ${w.jobTitle.toLowerCase()} work (self-reported).`, issuer: '' },
      { synthetic: true },
    );
    addSkill(
      ctx,
      org,
      adminActor,
      w.id,
      {
        kind: 'training',
        name: spec.industry === 'construction' ? 'Site safety induction' : 'Campus safety and hygiene induction',
        description: 'Completed induction session conducted by the employer.',
        issuer: org.name,
        issuedOn: addDays(today, -60 - i * 10),
        expiresOn: null,
      },
      { synthetic: true },
    );
    if (i % 2 === 0) {
      addSkill(
        ctx,
        org,
        self,
        w.id,
        {
          kind: 'certification',
          name: 'First aid (basic)',
          description: 'Certificate held by worker; not yet checked by employer.',
          issuer: 'Local training centre (as stated by worker)',
          issuedOn: addDays(today, -500 + i * 100),
          // One certificate is already expired so the passport shows an expiry state.
          expiresOn: addDays(today, i === 0 ? -30 : 400),
        },
        { synthetic: true },
      );
    }
  });

  // ---- Organization Sites ----
  const defaultSites =
    spec.industry === 'construction'
      ? [
          { name: 'Pier 42 Casting Yard', code: 'P42CY', address: 'Outer Ring Road, Kadubeesanahalli, Bengaluru' },
          { name: 'South Station Excavation', code: 'SSX01', address: 'Silk Board Junction, Bengaluru' },
          { name: 'Depot Admin & Staging Block', code: 'DAB02', address: 'Baiyappanahalli Metro Depot, Bengaluru' },
        ]
      : [
          { name: 'Science & Engineering Complex', code: 'SEC01', address: 'Block C, University Campus, Bengaluru' },
          { name: 'Hostel Cluster Dining Facility', code: 'HCD04', address: 'North Campus Residential Zone, Bengaluru' },
          { name: 'Main Administrative Building', code: 'MAB09', address: 'Central Avenue, University Campus, Bengaluru' },
        ];
  for (const s of defaultSites) {
    createSite(ctx.db, { orgId: org.id, name: s.name, code: s.code, address: s.address, nowIso });
  }

  // ---- Initial Notifications for Workers ----
  for (const w of spec.workers) {
    createNotification(ctx.db, {
      orgId: org.id,
      userId: w.id,
      type: 'system',
      title: 'Welcome to FairShift',
      body: 'Your verifiable work & earnings account is active. Check in each day to generate cryptographic receipts.',
      link: '/worker',
      nowIso,
    });
    createNotification(ctx.db, {
      orgId: org.id,
      userId: w.id,
      type: 'payslip_issued',
      title: 'Previous Period Payslip Available',
      body: 'Your weekly payslip has been finalized. Review your hours, deductions, and verified net earnings.',
      link: '/worker/payslips',
      nowIso,
    });
  }
}

function insertSeedShift(ctx: AppContext, org: OrgRow, workerId: string, checkInAt: string, checkOutAt: string | null) {
  const id = randomUUID();
  ctx.db.run(
    `INSERT INTO shifts (id, org_id, worker_id, check_in_at, check_out_at, source, is_synthetic, created_at, updated_at)
     VALUES (@id, @orgId, @workerId, @checkInAt, @checkOutAt, 'seed', 1, @checkInAt, @updatedAt)`,
    { id, orgId: org.id, workerId, checkInAt, checkOutAt, updatedAt: checkOutAt ?? checkInAt },
  );
  recordAudit(ctx.db, { orgId: org.id, actorId: workerId, entityType: 'shift', entityId: id, action: 'check_in', after: { checkInAt }, at: checkInAt });
  if (checkOutAt) {
    recordAudit(ctx.db, { orgId: org.id, actorId: workerId, entityType: 'shift', entityId: id, action: 'check_out', after: { checkOutAt }, at: checkOutAt });
    generateReceiptForShift(ctx, org, id);
  }
}
