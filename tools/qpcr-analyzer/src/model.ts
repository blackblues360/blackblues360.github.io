export const ENGINE_VERSION = '0.1.0';
export type Control = 'sample' | 'NTC' | 'No-RT' | 'positive';
export interface Well {
  well: string; sample: string; target: string; task: string; ct: number | null; ctRaw: string;
  tm: number | null; instrumentOmit: boolean;
  amplification: { cycle: number; rn: number | null; deltaRn: number | null; raw?: Record<string, number> }[];
  melt: { temperature: number; rn: number | null; derivativeTemperature?: number; derivative: number | null }[];
}
export interface Dataset {
  name: string; format: 'eds' | 'xlsx'; instrument: string; rows: number; columns: number;
  samples: string[]; targets: string[]; wells: Well[]; metadata: Record<string, unknown>;
  rawTables: Record<string, unknown[][] | string>; warnings: string[];
}
export interface Sample { id: string; group: string; biologicalId: string; control: Control; concentration: number | null; availableRna: number | null; targets?: string[] }
export interface Target { name: string; replicates: number; efficiency: number | null; primerForward: string; primerReverse: string }
export interface Assignment { plate: number; well: string; sample: string; target: string; replicate: number; control: Control }
export interface Config {
  instrument: string; rows: number; columns: number; orientation: 'sample-rows' | 'sample-columns';
  rnaInput: number; rtTotal: number; rtMix: number; rtWaterAfter: number; minPipette: number;
  rtProgram: { temperature: number; minutes: number | null }[];
  pcr: { sybr: number; forward: number; reverse: number; cdna: number; water: number }; excess: number;
  references: string[]; calibratorGroup: string; calibratorSample: string;
  method: 'ddct'; equalEfficiencyConfirmed: boolean;
  qc: { ctMin: number; ctMax: number; sd: number; range: number; minReplicates: number; controlCt: number; peakFraction: number; peakSeparation: number; amplificationRise: number };
}
export interface Issue { well?: string; sample?: string; target?: string; code: string; message: string }
export interface MeanCt { biologicalId: string; sample: string; group: string; target: string; n: number; mean: number; sd: number | null; range: number; wells: string[] }
export interface Quant { biologicalId: string; sample: string; group: string; target: string; ct: number; referenceCt: number; deltaCt: number; deltaDeltaCt: number | null; foldChange: number | null }
export interface Analysis { means: MeanCt[]; quant: Quant[]; issues: Issue[]; formula: string }
export interface Source { id: string; name: string; hash: string; bytes: Uint8Array; dataset: Dataset }
export interface Snapshot { config: Config; samples: Sample[]; targets: Target[]; layout: Assignment[]; exclusions: Record<string, string>; mappings: Record<string, { sample: string; target: string }>; activeSource: string }
export interface Version { id: string; at: string; engine: string; sourceIds: string[]; inputHash: string; snapshot: Snapshot; result: Analysis }
export interface Event { at: string; action: string; detail: unknown; previousHash: string; hash: string }
export interface Project extends Snapshot {
  schema: 1; id: string; name: string; date: string; purpose: string; tissue: string; conditions: string;
  sources: Source[]; activeSource: string; versions: Version[]; events: Event[]; updatedAt: string;
}
export function defaults(): Config {
  return { instrument: 'QuantStudio 7 Flex', rows: 8, columns: 12, orientation: 'sample-rows', rnaInput: 2000, rtTotal: 20, rtMix: 4, rtWaterAfter: 40, minPipette: 0.5,
    rtProgram: [{ temperature: 37, minutes: 15 }, { temperature: 50, minutes: 5 }, { temperature: 98, minutes: 5 }, { temperature: 4, minutes: null }],
    pcr: { sybr: 7.5, forward: 0.3, reverse: 0.3, cdna: 3.75, water: 3.15 }, excess: 0.1,
    references: [], calibratorGroup: '', calibratorSample: '', method: 'ddct', equalEfficiencyConfirmed: false,
    qc: { ctMin: 1, ctMax: 40, sd: 0.3, range: 0.5, minReplicates: 2, controlCt: 35, peakFraction: 0.2, peakSeparation: 1, amplificationRise: 0.05 } };
}
export function newProject(): Project {
  return { schema: 1, id: crypto.randomUUID(), name: '未命名实验', date: new Date().toISOString().slice(0, 10), purpose: '', tissue: '', conditions: '', config: defaults(), samples: [], targets: [], layout: [], exclusions: {}, mappings: {}, sources: [], activeSource: '', versions: [], events: [], updatedAt: new Date().toISOString() };
}
export const wellName = (index: number, columns = 12) => `${String.fromCharCode(65 + Math.floor(index / columns))}${index % columns + 1}`;
export const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
export const sd = (a: number[]) => a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / (a.length - 1)) : null;
