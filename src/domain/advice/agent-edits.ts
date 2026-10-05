/**
 * #126: the model's edit proposal, checked by code before a person sees it.
 *
 * Each edit becomes an ordinary editor command and is checked on the plan the
 * edits before it left: the id exists, `applyCommand` accepts the command,
 * physics does not refuse it (`editRejection`, the same gate as a drag), and
 * the plan gets no new validation error. A refused edit keeps its reason and
 * stays out of the commands. A new object goes where `findPlacements` puts
 * it — the model's point is only the anchor of the search.
 *
 * Nothing here edits the document: the commands reach the store as one batch
 * only when a person presses «Применить правки».
 */

import type { Fact } from '../../contracts/advice';
import type { AgentEdit, AgentEditPose, AgentEditProposal } from '../../contracts/advice-chat';
import type { Command } from '../../contracts/commands';
import type { Equipment, Id, Issue, PlanDocument, Ref } from '../../contracts/model';
import { applyCommand, nextFreeId, takenIds } from '../commands';
import { measurePlan } from '../metrics';
import { editRejection } from '../physics';
import { validatePlan } from '../validation';
import { candidateObjectForInsert } from './candidate-object';
import { findPlacements, issueKey } from './placement';
import type { RelocationOption } from './relocation';

const cm = (value: number): number => Math.round(value * 100) / 100;

export function pose(object: Equipment): AgentEditPose {
  return { position: [cm(object.position[0]), cm(object.position[1])], rotation_deg: object.rotation_deg, zoneId: object.zoneId };
}

type Step = { command: Command; put: Equipment | null; before: Equipment | null } | { reason: string };

function editStep(plan: PlanDocument, edit: AgentEdit, retired: readonly Id[]): Step {
  if (edit.op === 'add') {
    if (!plan.catalog.objectTypes.some((type) => type.id === edit.typeId)) return { reason: `Типа «${edit.typeId}» нет в справочнике.` };
    if (edit.zoneId !== null && !plan.zones.some((zone) => zone.id === edit.zoneId)) return { reason: `Зоны «${edit.zoneId}» нет в плане.` };
    const anchor = edit.position_m === null ? {} : { anchor: edit.position_m };
    const found = findPlacements(plan, { scenario: 'place', typeId: edit.typeId, zoneId: edit.zoneId, ...anchor });
    if (!found.ok) return { reason: found.issues.map((issue) => issue.message).join('; ') };
    const candidate = found.value[0];
    if (candidate === undefined) return { reason: 'Свободного места, которое проходит проверку, не найдено.' };
    const object = candidateObjectForInsert(plan, candidate, retired);
    return { command: { type: 'object.put', object }, put: object, before: null };
  }
  const existing = plan.objects.find((object) => object.id === edit.id);
  if (existing === undefined) return { reason: `Объекта «${edit.id}» нет в плане.` };
  if (edit.op === 'delete') return { command: { type: 'object.delete', id: existing.id }, put: null, before: existing };
  if (edit.op === 'move' && edit.dx_m === 0 && edit.dy_m === 0) return { reason: 'Смещение равно нулю.' };
  const object: Equipment =
    edit.op === 'move'
      ? { ...existing, position: [cm(existing.position[0] + edit.dx_m), cm(existing.position[1] + edit.dy_m)] }
      : { ...existing, rotation_deg: existing.rotation_deg + edit.by_deg };
  return { command: { type: 'object.put', object }, put: object, before: existing };
}

export const errorKeys = (issues: readonly Issue[]): Set<string> =>
  new Set(issues.filter((issue) => issue.severity === 'error').map(issueKey));

export function count(issues: readonly Issue[], errors: boolean): number {
  return issues.filter((issue) => (issue.severity === 'error') === errors).length;
}

/** Free and occupied area before → after, objects added and removed: all by code. */
export function effectFacts(id: Id, before: PlanDocument, after: PlanDocument, added: number, removed: number): Fact[] {
  const refs: Ref[] = [{ kind: 'room', id: before.room.id }];
  const facts: Fact[] = [];
  const was = measurePlan(before);
  const now = measurePlan(after);
  if (was.ok && now.ok) {
    for (const metric of ['area.free', 'area.occupied'] as const) {
      const key = metric === 'area.free' ? 'free_m2' : 'occupied_m2';
      const pair = [cm(was.value.room[key]), cm(now.value.room[key])] as const;
      facts.push(
        { id: `${id}.${metric}.before`, metric, phase: 'before', value: pair[0], unit: 'm2', refs },
        { id: `${id}.${metric}.after`, metric, phase: 'after', value: pair[1], unit: 'm2', refs },
        { id: `${id}.${metric}.delta`, metric, phase: 'delta', value: cm(pair[1] - pair[0]), unit: 'm2', refs },
      );
    }
  }
  facts.push(
    { id: `${id}.objects.added`, metric: 'objects.added', phase: 'delta', value: added, unit: 'count', refs },
    { id: `${id}.objects.removed`, metric: 'objects.removed', phase: 'delta', value: removed, unit: 'count', refs },
  );
  return facts;
}

/** Checks the edits in order, each on top of those accepted before it. */
export function checkAgentEdits(plan: PlanDocument, edits: readonly AgentEdit[], id: Id, retired: Iterable<Id> = []): AgentEditProposal {
  const retiredIds = [...retired];
  const proposal: AgentEditProposal = {
    id,
    commands: [],
    changes: [],
    rejected: [],
    facts: [],
    findings: { errors: { before: 0, after: 0 }, warnings: { before: 0, after: 0 } },
  };
  const initialIssues = validatePlan(plan);
  let current = plan;
  let known = errorKeys(initialIssues);
  for (const edit of edits) {
    const step = editStep(current, edit, retiredIds);
    if ('reason' in step) {
      proposal.rejected.push({ edit, reason: step.reason });
      continue;
    }
    const applied = applyCommand(current, step.command);
    if (!applied.ok) {
      proposal.rejected.push({ edit, reason: applied.issues.map((issue) => issue.message).join('; ') });
      continue;
    }
    const refused = editRejection(current, applied.value, step.command, retiredIds);
    if (refused !== null) {
      proposal.rejected.push({ edit, reason: refused.message });
      continue;
    }
    const issues = validatePlan(applied.value);
    const fresh = issues.find((issue) => issue.severity === 'error' && !known.has(issueKey(issue)));
    if (fresh !== undefined) {
      proposal.rejected.push({ edit, reason: `Новая ошибка проверки: ${fresh.message}` });
      continue;
    }
    known = errorKeys(issues);
    const after = step.put === null ? null : (applied.value.objects.find((object) => object.id === step.put?.id) ?? null);
    const subject = after ?? step.before;
    if (subject === null) continue;
    proposal.commands.push(step.command);
    proposal.changes.push({
      op: edit.op,
      id: subject.id,
      typeId: subject.typeId,
      label: subject.label,
      before: step.before === null ? null : pose(step.before),
      after: after === null ? null : pose(after),
    });
    current = applied.value;
  }
  const finalIssues = current === plan ? initialIssues : validatePlan(current);
  const added = proposal.changes.filter((change) => change.op === 'add').length;
  const removed = proposal.changes.filter((change) => change.op === 'delete').length;
  proposal.facts = effectFacts(id, plan, current, added, removed);
  proposal.findings = {
    errors: { before: count(initialIssues, true), after: count(finalIssues, true) },
    warnings: { before: count(initialIssues, false), after: count(finalIssues, false) },
  };
  return proposal;
}

/**
 * The proposal's commands for the store as it is now: a new object whose id
 * the store has retired since (D-019) gets a fresh one. Preview and «Применить»
 * call this with the same arguments, so the ghost and the result share ids.
 */
export function proposalCommands(plan: PlanDocument, proposal: AgentEditProposal, retired: Iterable<Id>): Command[] {
  const taken = takenIds(plan, retired);
  return proposal.commands.map((command): Command => {
    if (command.type !== 'object.put' || plan.objects.some((object) => object.id === command.object.id)) return command;
    if (!taken.has(command.object.id)) {
      taken.add(command.object.id);
      return command;
    }
    return { type: 'object.put', object: { ...command.object, id: nextFreeId('eq_', taken) } };
  });
}

/** #177: a move from `findRelocations` as a proposal — one `object.put`, one undo step. */
export function relocationProposal(plan: PlanDocument, option: RelocationOption, id: Id, title: string): AgentEditProposal {
  const before = plan.objects.find((object) => object.id === option.object.id)!;
  const applied = option.command === null ? null : applyCommand(plan, option.command);
  const after = applied?.ok === true ? applied.value : plan;
  const was = validatePlan(plan);
  const now = after === plan ? was : validatePlan(after);
  return {
    id,
    title,
    commands: option.command === null ? [] : [option.command],
    changes: [{ op: 'move', id: before.id, typeId: before.typeId, label: before.label, before: pose(before), after: pose(option.object) }],
    rejected: [],
    facts: effectFacts(id, plan, after, 0, 0),
    findings: { errors: { before: count(was, true), after: count(now, true) }, warnings: { before: count(was, false), after: count(now, false) } },
  };
}
