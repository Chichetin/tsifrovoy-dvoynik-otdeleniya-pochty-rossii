/**
 * V02: the list of problems.
 *
 * Errors first, then team warnings, each one clickable straight to the thing
 * it is about — a list that only prints sentences makes the jury hunt for the
 * spot on the plan.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candidate } from '../../contracts/advice';
import type { Id, Issue, PlanDocument, Ref, Result } from '../../contracts/model';
import type { FocusRequest, ValidationPanelProps } from '../../contracts/ui';
import { EMPTY_INDEX, planIndex } from '../../domain/plan-index';
import { PHYSICS_RULES } from '../../domain/physics';
import type { ValidationIssue } from '../../domain/validation';
import { formatLength, formatNumber } from '../../domain/number-format';
import { explainFinding, findFix, planFix, type FixResult } from './finding-why';
import { type IssueGroup, groupIssuesBySubject } from './issue-highlight';

/**
 * The document is optional: without it the list keeps working and names each
 * finding by id, exactly as it did before names existed.
 */
export type ValidationPanelViewProps = Omit<ValidationPanelProps, 'issues'> & {
  issues: ValidationIssue[];
  document?: PlanDocument;
  /**
   * A click on the plan's marker or an agent's ring (V02-marker-click):
   * scrolls to and outlines every finding about this entity. `sequence`
   * fires the scroll again for a repeated click on the same marker.
   */
  focus?: FocusRequest | null;
  /** #33: shows the fix variant on the plan as a ghost; `null` hides it. */
  onPreview?: (candidate: Candidate | null) => void;
  /** «Подтвердить» под вариантом исправления: одна команда, одна отмена. */
  onApplyFix?: (application: FixApplication) => Result<PlanDocument>;
};

/**
 * What «Подтвердить» does: puts the shown variant on the plan (`movedId` is
 * the object that moves, `null` — a new object is added) or deletes one.
 */
export type FixApplication =
  | { kind: 'put'; candidate: Candidate; movedId: Id | null }
  | { kind: 'delete'; id: Id };

type FixState = { key: string; plan: PlanDocument } & (
  | { status: 'loading' }
  | { status: 'done'; result: FixResult }
);

function order(issue: Issue): number {
  return issue.severity === 'error' ? 0 : 1;
}

function mentions(issue: ValidationIssue, ref: Ref): boolean {
  return issue.refs.some((entry) => entry.kind === ref.kind && entry.id === ref.id);
}

/** Links of a grouped row: each entity once, in order of first mention. */
function uniqueRefs(issues: ValidationIssue[]): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const issue of issues) {
    for (const ref of issue.refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

export function ValidationPanel({
  issues,
  document: plan,
  onFocus,
  focus,
  onPreview,
  onApplyFix,
}: ValidationPanelViewProps): React.JSX.Element {
  const [openWhy, setOpenWhy] = useState<ReadonlySet<string>>(() => new Set());
  const [fixState, setFix] = useState<FixState | null>(null);
  // The row of a fixed finding is gone from the list, so the result of
  // «Подтвердить» is said here, above the list.
  const [applied, setApplied] = useState<string | null>(null);

  // Every click, hide and edit starts a new sequence: a search that finishes
  // late for an older plan or an older click shows nothing.
  const fixSequence = useRef(0);
  const ghostShown = useRef(false);
  const fixTimer = useRef<number | null>(null);

  // A variant belongs to the plan it was searched on: an edit or unmounting
  // the panel cancels a pending search and takes the ghost off the plan.
  const fix = fixState !== null && fixState.plan === plan ? fixState : null;
  useEffect(
    () => () => {
      fixSequence.current += 1;
      if (fixTimer.current !== null) window.clearTimeout(fixTimer.current);
      fixTimer.current = null;
      if (ghostShown.current) {
        ghostShown.current = false;
        onPreview?.(null);
      }
    },
    [plan, onPreview],
  );

  const toggleWhy = (key: string): void => {
    setOpenWhy((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showFix = (key: string, issue: ValidationIssue): void => {
    if (plan === undefined || onPreview === undefined) return;
    const planned = planFix(plan, issue, issues);
    if (planned.kind === 'none') return;
    const sequence = ++fixSequence.current;
    setFix({ key, plan, status: 'loading' });
    onPreview(null);
    ghostShown.current = false;
    // The search runs after the «ищет» state is painted: it may take a moment.
    if (fixTimer.current !== null) window.clearTimeout(fixTimer.current);
    fixTimer.current = window.setTimeout(() => {
      fixTimer.current = null;
      if (sequence !== fixSequence.current) return;
      const result = findFix(plan, planned);
      setFix({ key, plan, status: 'done', result });
      if (!result.ok) return;
      if (result.candidate === null) {
        onFocus({ kind: 'object', id: result.fix.object.id });
        return;
      }
      ghostShown.current = true;
      onPreview(result.candidate);
    }, 0);
  };

  const hideFix = (): void => {
    fixSequence.current += 1;
    setFix(null);
    ghostShown.current = false;
    onPreview?.(null);
  };
  const applyFix = (result: Extract<FixResult, { ok: true }>): void => {
    if (onApplyFix === undefined) return;
    const { candidate, fix: planned } = result;
    const outcome = onApplyFix(
      candidate === null
        ? { kind: 'delete', id: planned.object.id }
        : { kind: 'put', candidate, movedId: planned.kind === 'move' ? planned.object.id : null },
    );
    if (!outcome.ok) {
      setApplied(`Не применено: ${outcome.issues.map((issue) => issue.message).join('; ')}`);
      return;
    }
    hideFix();
    if (candidate === null) {
      setApplied(`Применено: удалён объект «${planned.object.label}». Отменить — Ctrl+Z.`);
      return;
    }
    if (planned.kind === 'add') {
      setApplied(`Применено: на план добавлен объект «${candidate.object.label}». Отменить — Ctrl+Z.`);
      return;
    }
    const [width, depth] = candidate.object.size_m;
    const resized = width !== planned.object.size_m[0] || depth !== planned.object.size_m[1];
    setApplied(
      `Применено: объект «${planned.object.label}» переставлен${resized ? `, размер по справочнику ${formatNumber(width)} × ${formatNumber(depth)} м` : ''}. Отменить — Ctrl+Z.`,
    );
  };
  // One index per document (D-202): names come from the plan itself, so a
  // rename in the card renames the finding; an id with nothing behind it
  // stays raw.
  const names = useMemo(() => (plan === undefined ? EMPTY_INDEX : planIndex(plan)), [plan]);
  const sorted = [...issues].sort((a, b) => order(a) - order(b));
  // #14: all findings about one object form one row with a list, the same
  // grouping the plan's marker counts.
  const groups = groupIssuesBySubject(sorted);
  const errors = issues.filter((issue) => issue.severity === 'error').length;

  // The column may be scrolled past the row a marker click asks about; the
  // row comes to the viewer, the same way «Свойства» does for a card.
  const firstMatch = useRef<HTMLLIElement>(null);
  const groupMentions = (group: IssueGroup<ValidationIssue>, ref: Ref): boolean =>
    group.issues.some((issue) => mentions(issue, ref));
  const matchIndex = focus == null ? -1 : groups.findIndex((group) => groupMentions(group, focus.ref));
  const focusSequence = focus?.sequence ?? null;
  useEffect(() => {
    if (focusSequence === null) return;
    firstMatch.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSequence]);

  // #33: «Почему?» belongs to one finding, also inside a grouped row (#14).
  const why = (issue: ValidationIssue, whyId: string): React.ReactNode => {
    if (plan === undefined) return null;
    const key = issueKey(issue);
    const whyOpen = openWhy.has(key);
    return (
      <>
        <p className="issues__refs">
          <button
            type="button"
            className="table__link"
            aria-expanded={whyOpen}
            aria-controls={whyOpen ? whyId : undefined}
            data-testid="issue-why"
            onClick={() => toggleWhy(key)}
          >
            Почему?
          </button>
        </p>
        {!whyOpen ? null : (
          <FindingWhyDetails
            id={whyId}
            plan={plan}
            issue={issue}
            issues={issues}
            fix={fix?.key === key ? fix : null}
            canPreview={onPreview !== undefined}
            onShowFix={() => showFix(key, issue)}
            onHideFix={hideFix}
            onApplyFix={onApplyFix === undefined ? undefined : applyFix}
          />
        )}
      </>
    );
  };

  return (
    <section className="panel" aria-label="Проверка плана">
      <h2 className="panel__title">
        Проверка{' '}
        <span className={errors > 0 ? 'panel__count is-error' : 'panel__count'}>
          {issues.length}
        </span>
      </h2>

      {applied === null ? null : (
        <p className="panel__note" role="status" data-testid="issue-fix-applied">{applied}</p>
      )}

      {issues.length === 0 ? (
        <p className="panel__empty">Нарушений не найдено</p>
      ) : (
        <>
          <ul className="issues">
            {groups.map((group, index) => {
              const isMatch = focus != null && groupMentions(group, focus.ref);
              const first = group.issues[0];
              const refs = uniqueRefs(group.issues);
              const subject = group.ref === null ? '' : (names.nameOf(group.ref) ?? group.ref.id);
              return (
                <li
                  key={`${first?.code ?? 'group'}-${index}`}
                  ref={index === matchIndex ? firstMatch : undefined}
                  className={`issues__item is-${group.severity}${isMatch ? ' is-focused' : ''}`}
                  aria-current={isMatch ? 'true' : undefined}
                >
                  {group.issues.length === 1 ? (
                    <p className="issues__message"><FindingMessage message={first?.message ?? ''} /></p>
                  ) : (
                    <>
                      <p className="issues__message">
                        <strong>{subject}</strong> — нарушений: {group.issues.length}
                      </p>
                      <ul className="issues__group" style={{ margin: '0 0 0.25rem', paddingLeft: '1.125rem' }}>
                        {group.issues.map((issue, line) => (
                          <li key={`${issue.code}-${line}`} className="issues__message">
                            <FindingMessage message={issue.message} />
                            {why(issue, `issue-why-${index}-${line}`)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {refs.length === 0 ? null : (
                    <p className="issues__refs">
                      {refs.map((ref) => {
                        const name = names.nameOf(ref);
                        const label = name ?? ref.id;
                        return (
                          <button
                            key={`${ref.kind}-${ref.id}`}
                            type="button"
                            className="table__link"
                            title={`Показать на плане: ${label}`}
                            data-ref-id={ref.id}
                            onClick={() => onFocus(ref)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </p>
                  )}
                  {group.issues.length === 1 && first !== undefined ? why(first, `issue-why-${index}`) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* D-286: набор правил физики — то, чего план не может нарушить и
          остаться сохраняемым. Список читается из `PHYSICS_RULES`, а не
          переписан здесь словами: новое правило появляется в панели само. */}
      <details className="issues__physics" data-testid="physics-rules">
        <summary>Правила физики ({PHYSICS_RULES.length})</summary>
        <p className="panel__note">
          Нарушение любого из них останавливает сохранение плана файлом и не даёт поставить
          объект.
        </p>
        <dl>
          {PHYSICS_RULES.map((rule) => (
            <div key={rule.id}>
              <dt>{rule.title}</dt>
              <dd>{rule.detail}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

/** Keep the source below the finding without changing the diagnostic contract. */
function FindingMessage({ message }: { message: string }): React.JSX.Element {
  const sourceStart = message.lastIndexOf('Источник правила:');
  return sourceStart < 0 ? <>{message}</> : (
    <>
      {message.slice(0, sourceStart).trimEnd()}
      <em className="issues__source">{message.slice(sourceStart)}</em>
    </>
  );
}

/** One finding is one code about one set of entities; the key survives re-sorting. */
function issueKey(issue: ValidationIssue): string {
  return `${issue.code}:${issue.refs.map((ref) => `${ref.kind}:${ref.id}`).join(',')}`;
}

function FindingWhyDetails({
  id,
  plan,
  issue,
  issues,
  fix,
  canPreview,
  onShowFix,
  onHideFix,
  onApplyFix,
}: {
  id: string;
  plan: PlanDocument;
  issue: ValidationIssue;
  issues: ValidationIssue[];
  fix: FixState | null;
  canPreview: boolean;
  onShowFix: () => void;
  onHideFix: () => void;
  onApplyFix: ((result: Extract<FixResult, { ok: true }>) => void) | undefined;
}): React.JSX.Element {
  const why = explainFinding(plan, issue);
  const planned = planFix(plan, issue, issues);
  const ready = fix?.status === 'done' && fix.result.ok ? fix.result : null;
  const shown = ready !== null;
  return (
    <div className="issues__technical" id={id} data-testid="issue-why-details">
      <p className="panel__note">
        <strong>{why.title}</strong>
      </p>
      {why.rationale === null ? null : <p className="panel__note">{why.rationale}</p>}
      {why.params.length === 0 ? null : (
        <ul className="panel__note" aria-label="Параметры правила">
          {why.params.map((param) => (
            <li key={param.label}>
              {param.label}: {param.value}
            </li>
          ))}
        </ul>
      )}
      <p className="panel__note">Откуда число: {why.method}</p>
      <p className="panel__note" data-testid="issue-why-source">
        <em>{why.sourceNote}</em>
      </p>
      {planned.kind === 'none' ? (
        <p className="panel__note">{planned.reason}</p>
      ) : !canPreview ? null : (
        <>
          <p className="issues__refs">
            <button
              type="button"
              className="table__link"
              data-testid="issue-fix"
              disabled={fix?.status === 'loading'}
              onClick={shown ? onHideFix : onShowFix}
            >
              {shown ? 'Скрыть вариант' : 'Показать вариант исправления'}
            </button>
            {ready === null || onApplyFix === undefined ? null : (
              <button
                type="button"
                className="files__button is-primary"
                data-testid="issue-fix-apply"
                onClick={() => onApplyFix(ready)}
              >
                Подтвердить
              </button>
            )}
          </p>
          <p className="panel__note" role="status" data-testid="issue-fix-status">
            {fix === null ? null : fixText(plan, fix)}
          </p>
        </>
      )}
    </div>
  );
}

function fixText(plan: PlanDocument, fix: FixState): string {
  if (fix.status === 'loading') return 'Ассистент ищет место…';
  const { result } = fix;
  if (!result.ok) return `Варианта нет: ${result.message}`;
  if (result.candidate === null) {
    const { object, retired } = result.fix;
    return `Удалить «${object.label}» (${retired ? 'выведено из эксплуатации' : 'последний в списке'}). Объект выделен на плане, план не изменён: «Подтвердить» удалит его. Расчёт без LLM.`;
  }
  const object = result.candidate.object;
  const zone = plan.zones.find((entry) => entry.id === object.zoneId)?.name ?? 'вне зон';
  const where = `(${formatNumber(object.position[0])}; ${formatLength(object.position[1])}), поворот ${object.rotation_deg}°, зона «${zone}»`;
  const action =
    result.fix.kind === 'add'
      ? `Добавить «${object.label}»`
      : `Переставить «${result.fix.object.label}»${result.fix.toEntrance ? ' ближе к входу' : ''}`;
  return `${action}: ${where}. Вариант показан на плане полупрозрачно, план не изменён: «Подтвердить» ставит его. Размер — по типу из справочника. Расчёт без LLM.`;
}
