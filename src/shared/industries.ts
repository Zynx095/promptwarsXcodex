// Industry configurations. Organisations reference one of these by key; all business
// logic is shared, only terminology and category lists differ.

export const INDUSTRY_KEYS = ['construction', 'education'] as const;
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

/** Things a worker can point out in a safety photo (multi-select on the report form). */
export const INSPECTION_CHECKS = [
  'helmet',
  'vest',
  'footwear',
  'eye',
  'gloves',
  'electrical',
  'fire',
  'machinery',
  'structure',
  'housekeeping',
  'restricted',
  'chemical',
  'heat',
  'emergency',
] as const;
export type InspectionCheck = (typeof INSPECTION_CHECKS)[number];

/** Protective gear that photo analysis can look for. Which of it is required depends on the work. */
export const PPE_ITEMS = ['helmet', 'vest', 'footwear', 'eye', 'gloves'] as const;
export type PpeItem = (typeof PPE_ITEMS)[number];

export interface IndustryConfig {
  key: IndustryKey;
  label: string;
  /** What a work location is called, e.g. "Site" or "Campus area". */
  locationLabel: string;
  /** What a worker's team is called, e.g. "Crew" or "Department". */
  teamLabel: string;
  hazardCategories: { key: string; label: string }[];
  feedbackCategories: { key: string; label: string }[];
  /** Inspection points offered on the report form, in this order. */
  inspectionChecks: readonly InspectionCheck[];
  /**
   * Gear expected on everyone at work. Photo analysis says "may be missing" only for these; an
   * organisation can override the list in its safety settings.
   */
  requiredPpe: readonly PpeItem[];
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
    inspectionChecks: [
      'helmet',
      'vest',
      'footwear',
      'eye',
      'gloves',
      'electrical',
      'fire',
      'machinery',
      'structure',
      'housekeeping',
      'restricted',
      'heat',
      'emergency',
    ],
    requiredPpe: ['helmet', 'vest', 'footwear'],
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
    // Campus support work: gloves and eye protection depend on the task, so none is required everywhere
    inspectionChecks: ['gloves', 'eye', 'chemical', 'electrical', 'fire', 'housekeeping', 'emergency', 'restricted', 'heat'],
    requiredPpe: [],
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
