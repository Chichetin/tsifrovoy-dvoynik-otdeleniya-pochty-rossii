/**
 * Contracts v1: semantic dictionary of explanations. Frozen by F02, see the
 * table in docs/contracts-v1.md.
 *
 * The calculation decides which reason codes are admissible; the model only
 * picks one of them plus the fact ids. Visible text is assembled from these
 * Russian templates, so a model cannot write "уменьшилось" over a rising number.
 * verifyExplanation (A04) checks this table, not merely that ids exist.
 */

import type {
  AdviceScenario,
  FactPhase,
  FactUnit,
  MetricCode,
  ReasonCode,
} from './advice';

export const METRIC_UNITS: Readonly<Record<MetricCode, FactUnit>> = {
  'area.total': 'm2',
  'area.occupied': 'm2',
  'area.free': 'm2',
  'equipment.count': 'count',
  'equipment.min': 'count',
  'equipment.max': 'count',
  'objects.added': 'count',
  'objects.removed': 'count',
  'placement.distance': 'm',
};

/** Metrics whose value must be an integer. */
export const INTEGER_METRICS: readonly MetricCode[] = [
  'equipment.count',
  'equipment.min',
  'equipment.max',
  'objects.added',
  'objects.removed',
];

/** A fact the explanation must cite, identified by metric and phase. */
export type FactSelector = { metric: MetricCode; phase: FactPhase };

export type CandidateRule = 'required' | 'forbidden';

export type ReasonCodeSpec = {
  readonly code: ReasonCode;
  readonly scenarios: readonly AdviceScenario[];
  /** Whether the explanation must name a candidate of its recommendation. */
  readonly candidate: CandidateRule;
  readonly requiredFacts: readonly FactSelector[];
  /** At least one delta fact must be non-zero. */
  readonly requiresNonZeroDelta: boolean;
  /** No delta fact may be non-zero. */
  readonly requiresAllDeltaZero: boolean;
  /**
   * Russian sentence rendered by A03. Every {slot} is filled from the cited
   * facts or from the candidate — never from model output.
   */
  readonly template: string;
  readonly slots: readonly string[];
  /** Must be present in Recommendation.limitations for this code. */
  readonly requiredLimitation: string;
};

export const REASON_CODE_SPECS: Readonly<Record<ReasonCode, ReasonCodeSpec>> = {
  'placement.available': {
    code: 'placement.available',
    scenarios: ['place'],
    candidate: 'required',
    requiredFacts: [
      { metric: 'area.free', phase: 'current' },
      { metric: 'area.free', phase: 'after' },
      { metric: 'equipment.count', phase: 'current' },
      { metric: 'equipment.count', phase: 'after' },
    ],
    requiresNonZeroDelta: false,
    requiresAllDeltaZero: false,
    template:
      'Место найдено: {candidateLabel}, размер {candidateSize} м, центр {candidatePosition}, поворот {candidateRotation}°. ' +
      'Свободная площадь: {area.free.current} → {area.free.after} м². ' +
      'Объектов этого типа: {equipment.count.current} → {equipment.count.after}.',
    slots: [
      'candidateLabel',
      'candidateSize',
      'candidatePosition',
      'candidateRotation',
      'area.free.current',
      'area.free.after',
      'equipment.count.current',
      'equipment.count.after',
    ],
    requiredLimitation:
      'Проверена геометрия размещения, а не доступность прохода, эргономика или нормативы.',
  },
  'placement.none': {
    code: 'placement.none',
    scenarios: ['place'],
    candidate: 'forbidden',
    requiredFacts: [{ metric: 'area.free', phase: 'current' }],
    requiresNonZeroDelta: false,
    requiresAllDeltaZero: false,
    template:
      'Подходящее место не найдено при текущем переборе. Свободная площадь: {area.free.current} м². ' +
      'Перебор ограничен шагом сетки и числом кандидатов.',
    slots: ['area.free.current'],
    requiredLimitation:
      'Результат означает «на этой сетке не найдено», а не «места не существует».',
  },
  'equipment.missing': {
    code: 'equipment.missing',
    scenarios: ['equipment'],
    candidate: 'forbidden',
    requiredFacts: [
      { metric: 'equipment.count', phase: 'current' },
      { metric: 'equipment.min', phase: 'current' },
    ],
    requiresNonZeroDelta: false,
    requiresAllDeltaZero: false,
    template:
      'Не хватает оборудования: {equipment.count.current} при минимуме {equipment.min.current}. ' +
      'Разница: {shortfall}.',
    slots: ['equipment.count.current', 'equipment.min.current', 'shortfall'],
    requiredLimitation:
      'Правило комплектования принято командой и не является нормативом Почты России.',
  },
  'equipment.excess': {
    code: 'equipment.excess',
    scenarios: ['equipment'],
    candidate: 'forbidden',
    requiredFacts: [
      { metric: 'equipment.count', phase: 'current' },
      { metric: 'equipment.max', phase: 'current' },
    ],
    requiresNonZeroDelta: false,
    requiresAllDeltaZero: false,
    template:
      'Оборудования больше нормы: {equipment.count.current} при максимуме {equipment.max.current}. ' +
      'Разница: {excess}.',
    slots: ['equipment.count.current', 'equipment.max.current', 'excess'],
    requiredLimitation:
      'Правило комплектования принято командой и не является нормативом Почты России.',
  },
  'comparison.changed': {
    code: 'comparison.changed',
    scenarios: ['compare'],
    candidate: 'forbidden',
    requiredFacts: [
      { metric: 'area.free', phase: 'before' },
      { metric: 'area.free', phase: 'after' },
      { metric: 'area.free', phase: 'delta' },
    ],
    requiresNonZeroDelta: true,
    requiresAllDeltaZero: false,
    template:
      'Планировка изменилась. Свободная площадь: {area.free.before} → {area.free.after} м² ({area.free.delta} м²). ' +
      'Изменения объектов: {changeSummary}.',
    slots: ['area.free.before', 'area.free.after', 'area.free.delta', 'changeSummary'],
    requiredLimitation:
      'Сравниваются два снимка плана; влияние на очереди, маршруты и загрузку не оценивается.',
  },
  'comparison.unchanged': {
    code: 'comparison.unchanged',
    scenarios: ['compare'],
    candidate: 'forbidden',
    requiredFacts: [{ metric: 'area.free', phase: 'delta' }],
    requiresNonZeroDelta: false,
    requiresAllDeltaZero: true,
    template: 'Изменений нет: снимки планов совпадают по содержимому.',
    slots: [],
    requiredLimitation:
      'Сравнение выполняется по содержимому документа, а не по истории правок.',
  },
};

export const REASON_CODES: readonly ReasonCode[] = Object.keys(
  REASON_CODE_SPECS,
) as ReasonCode[];

/** Reason codes a scenario may produce. */
export function reasonCodesForScenario(scenario: AdviceScenario): ReasonCode[] {
  return REASON_CODES.filter((code) =>
    REASON_CODE_SPECS[code].scenarios.includes(scenario),
  );
}
