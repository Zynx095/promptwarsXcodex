// Advisory photo analysis with Google Cloud Vision (label and object detection). The result helps
// a reviewer look in the right place; it never decides anything. Every finding names the labels
// and the confidence the provider returned, so a reviewer can see why it was raised. When the
// provider is not configured or fails, the photo goes to manual review and no finding is made up.
//
// "No visible issue" means only that none of the signals below appeared in this one photo. It is
// not evidence that the place is safe, and the interface says so.
import type { PpeItem } from '../../shared/industries';
import type { EvidenceAnalysisDTO, EvidenceFinding, EvidenceOutcome } from '../../shared/types';

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
export const VISION_PROVIDER = 'Google Cloud Vision (label and object detection)';

interface Signal {
  name: string;
  score: number;
}

const PATTERNS: Record<'fire' | 'electrical' | 'machinery' | 'structure' | 'chemical' | 'person', RegExp> = {
  fire: /^(fire|flame|smoke|explosion|bonfire|wildfire|heat)$/i,
  electrical: /(electrical wiring|electricity|electrical supply|electric power|junction box|power cord|cable|wire|fuse|circuit|transformer)/i,
  machinery: /(heavy machinery|machine|crane|excavator|forklift|bulldozer|tractor|loader|construction equipment|power tool|grinder|saw)/i,
  structure: /(scaffolding|ladder|rubble|collapse|demolition|construction site|trench|beam|formwork)/i,
  chemical: /(chemical|hazardous|barrel|drum|gas cylinder|cleaning agent|bleach|solvent)/i,
  person: /^(person|man|woman|worker|construction worker|people|human|tradesman|laborer|labourer)$/i,
};
const PPE_PATTERNS: Record<PpeItem, RegExp> = {
  helmet: /^(helmet|hard hat|hardhat|personal protective equipment|safety helmet)$/i,
  vest: /(high-visibility clothing|high visibility|safety vest|reflective vest|vest)/i,
  footwear: /(footwear|boot|work boots|safety shoe|shoe)/i,
  eye: /(goggles|safety glasses|eyewear|glasses|face shield)/i,
  gloves: /(glove)/i,
};
/** Footwear and hands are often outside the frame: their absence is "cannot tell", not "missing". */
const OFTEN_OUT_OF_FRAME: ReadonlySet<PpeItem> = new Set(['footwear', 'gloves', 'eye']);

const HAZARD_MIN = 0.6;
const PRESENT_MIN = 0.5;
const RANK: Record<EvidenceOutcome, number> = {
  potential_hazard: 4,
  ppe_may_be_missing: 3,
  manual_inspection_required: 2,
  unable_to_determine: 1,
  no_visible_issue: 0,
};

/** Turns provider labels and objects into advisory findings. Pure, so it is tested directly. */
export function interpret(labels: Signal[], objects: Signal[], requiredPpe: readonly PpeItem[]): Pick<EvidenceAnalysisDTO, 'outcome' | 'findings'> {
  const all = [...labels, ...objects];
  const matches = (re: RegExp, min: number) => all.filter((s) => re.test(s.name) && s.score >= min).sort((a, b) => b.score - a.score);
  const findings: EvidenceFinding[] = [];

  const fire = matches(PATTERNS.fire, HAZARD_MIN);
  if (fire.length) findings.push({ kind: 'fire', outcome: 'potential_hazard', signals: fire.slice(0, 3) });
  const chemical = matches(PATTERNS.chemical, HAZARD_MIN);
  if (chemical.length) findings.push({ kind: 'chemical', outcome: 'manual_inspection_required', signals: chemical.slice(0, 3) });
  const electrical = matches(PATTERNS.electrical, HAZARD_MIN);
  if (electrical.length) findings.push({ kind: 'electrical', outcome: 'manual_inspection_required', signals: electrical.slice(0, 3) });
  const machinery = matches(PATTERNS.machinery, HAZARD_MIN);
  if (machinery.length) findings.push({ kind: 'machinery', outcome: 'manual_inspection_required', signals: machinery.slice(0, 3) });
  const structure = matches(PATTERNS.structure, HAZARD_MIN);
  if (structure.length) findings.push({ kind: 'structure', outcome: 'manual_inspection_required', signals: structure.slice(0, 3) });

  const people = matches(PATTERNS.person, HAZARD_MIN);
  if (people.length) {
    for (const item of requiredPpe) {
      const seen = matches(PPE_PATTERNS[item], PRESENT_MIN);
      if (seen.length) continue;
      findings.push({
        kind: item,
        outcome: OFTEN_OUT_OF_FRAME.has(item) ? 'unable_to_determine' : 'ppe_may_be_missing',
        signals: people.slice(0, 1),
      });
    }
  }

  let outcome: EvidenceOutcome;
  if (all.length === 0) outcome = 'unable_to_determine';
  else if (findings.length === 0) outcome = 'no_visible_issue';
  else outcome = findings.reduce((worst, f) => (RANK[f.outcome] > RANK[worst] ? f.outcome : worst), 'no_visible_issue' as EvidenceOutcome);
  return { outcome, findings };
}

export type AnalysisResult = { status: 'completed'; analysis: EvidenceAnalysisDTO } | { status: 'failed' | 'not_configured' };

/** Sends the cleaned photo (no metadata, no report text, no names) for labels and objects. */
export async function analyzeImage(
  apiKey: string | undefined,
  doFetch: typeof fetch,
  image: Buffer,
  requiredPpe: readonly PpeItem[],
  at: string,
): Promise<AnalysisResult> {
  if (!apiKey) return { status: 'not_configured' };
  try {
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image.toString('base64') },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 25 },
              { type: 'OBJECT_LOCALIZATION', maxResults: 25 },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[fairshift] image analysis provider returned ${res.status}`);
      return { status: 'failed' };
    }
    const body = (await res.json()) as {
      responses?: {
        error?: { message?: string };
        labelAnnotations?: { description?: string; score?: number }[];
        localizedObjectAnnotations?: { name?: string; score?: number }[];
      }[];
    };
    const r = body.responses?.[0];
    if (!r || r.error) return { status: 'failed' };
    const clean = (list: { name: string; score: number }[]) =>
      list
        .filter((s) => s.name && typeof s.score === 'number' && s.score >= 0 && s.score <= 1)
        .map((s) => ({ name: s.name, score: Math.round(s.score * 100) / 100 }));
    const labels = clean((r.labelAnnotations ?? []).map((l) => ({ name: l.description ?? '', score: l.score ?? -1 })));
    const objects = clean((r.localizedObjectAnnotations ?? []).map((o) => ({ name: o.name ?? '', score: o.score ?? -1 })));
    const { outcome, findings } = interpret(labels, objects, requiredPpe);
    return {
      status: 'completed',
      analysis: {
        provider: VISION_PROVIDER,
        outcome,
        findings,
        labels: [...labels, ...objects].sort((a, b) => b.score - a.score).slice(0, 15),
        analyzedAt: at,
      },
    };
  } catch (err) {
    console.warn('[fairshift] image analysis provider unreachable:', err instanceof Error ? err.name : 'error');
    return { status: 'failed' };
  }
}
