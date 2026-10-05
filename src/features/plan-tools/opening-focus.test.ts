/**
 * U03: когда Enter (или смена инструмента) «завершает» выделенный проём —
 * снимает выделение — а когда нет.
 */
import { describe, expect, it } from 'vitest';
import { shouldFinishOpeningSelection } from './opening-focus';

describe('завершение проёма', () => {
  it('выделенный проём без черновика — завершить', () => {
    expect(shouldFinishOpeningSelection({ kind: 'opening', id: 'op_1' }, false)).toBe(true);
  });

  it('черновик контура или стены побеждает: выделение остаётся', () => {
    expect(shouldFinishOpeningSelection({ kind: 'opening', id: 'op_1' }, true)).toBe(false);
  });

  it('выбор другой сущности этому правилу не принадлежит', () => {
    expect(shouldFinishOpeningSelection({ kind: 'zone', id: 'z_1' }, false)).toBe(false);
    expect(shouldFinishOpeningSelection({ kind: 'wall', id: 'w_1' }, false)).toBe(false);
    expect(shouldFinishOpeningSelection({ kind: 'room', id: 'room_main' }, false)).toBe(false);
  });

  it('пустой выбор — нечего завершать', () => {
    expect(shouldFinishOpeningSelection(null, false)).toBe(false);
    expect(shouldFinishOpeningSelection(null, true)).toBe(false);
  });

  it('смена инструмента не передаёт hasDraft — черновик проёма не касается', () => {
    expect(shouldFinishOpeningSelection({ kind: 'opening', id: 'op_1' })).toBe(true);
  });
});
