// Industry configurations. Organisations reference one of these by key; all business
// logic is shared, only terminology and category lists differ.

export const INDUSTRY_KEYS = ['construction', 'education'] as const;
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

export interface IndustryConfig {
  key: IndustryKey;
  label: string;
  /** What a work location is called, e.g. "Site" or "Campus area". */
  locationLabel: string;
  /** What a worker's team is called, e.g. "Crew" or "Department". */
  teamLabel: string;
  hazardCategories: { key: string; label: string }[];
  feedbackCategories: { key: string; label: string }[];
}

const commonFeedback = [
  { key: 'pay', label: 'Pay and wages' },
  { key: 'hours', label: 'Working hours and breaks' },
  { key: 'treatment', label: 'Respect and treatment by supervisors' },
  { key: 'facilities', label: 'Drinking water, toilets and rest areas' },
];

export const INDUSTRIES: Record<IndustryKey, IndustryConfig> = {
  construction: {
    key: 'construction',
    label: 'Construction',
    locationLabel: 'Site',
    teamLabel: 'Crew',
    hazardCategories: [
      { key: 'fall', label: 'Fall from height / missing guardrail' },
      { key: 'ppe', label: 'Missing or damaged safety gear (PPE)' },
      { key: 'electrical', label: 'Exposed wiring / electrical' },
      { key: 'machinery', label: 'Unsafe machinery or vehicles' },
      { key: 'scaffolding', label: 'Unstable scaffolding' },
      { key: 'heat', label: 'Heat stress / no shade or water' },
      { key: 'other', label: 'Other' },
    ],
    feedbackCategories: [...commonFeedback, { key: 'equipment', label: 'Tools and equipment' }],
  },
  education: {
    key: 'education',
    label: 'Educational institution (campus support staff)',
    locationLabel: 'Campus area',
    teamLabel: 'Department',
    hazardCategories: [
      { key: 'chemical', label: 'Cleaning chemicals / no gloves or masks' },
      { key: 'slip', label: 'Wet floor / slip or trip hazard' },
      { key: 'electrical', label: 'Exposed wiring / electrical' },
      { key: 'waste', label: 'Unsafe waste handling (sharp, biomedical)' },
      { key: 'security', label: 'Personal security / harassment risk' },
      { key: 'lifting', label: 'Heavy lifting without equipment' },
      { key: 'other', label: 'Other' },
    ],
    feedbackCategories: [...commonFeedback, { key: 'workload', label: 'Workload and staffing' }],
  },
};

export function getIndustry(key: string): IndustryConfig {
  const cfg = INDUSTRIES[key as IndustryKey];
  if (!cfg) throw new RangeError(`Unknown industry: ${key}`);
  return cfg;
}

export function isHazardCategory(industry: IndustryKey, category: string): boolean {
  return INDUSTRIES[industry].hazardCategories.some((c) => c.key === category);
}

export function isFeedbackCategory(industry: IndustryKey, category: string): boolean {
  return INDUSTRIES[industry].feedbackCategories.some((c) => c.key === category);
}
