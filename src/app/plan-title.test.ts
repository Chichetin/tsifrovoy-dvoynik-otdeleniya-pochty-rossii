import { describe, expect, it } from 'vitest';
import { renameOutcome } from './plan-title';

describe('renameOutcome', () => {
  it('cancels when the name did not change', () => {
    expect(renameOutcome('ОПС 115534', 'ОПС 115534')).toEqual({ kind: 'cancel' });
  });

  it('reports an empty name, spaces included', () => {
    expect(renameOutcome('', 'ОПС 115534')).toEqual({ kind: 'empty' });
    expect(renameOutcome('   ', 'ОПС 115534')).toEqual({ kind: 'empty' });
  });

  it('renames with the name as typed: plan.rename keeps inner and edge spaces (D-152)', () => {
    expect(renameOutcome('ОПС 115534 после', 'ОПС 115534')).toEqual({ kind: 'rename', name: 'ОПС 115534 после' });
    expect(renameOutcome(' ОПС ', 'ОПС')).toEqual({ kind: 'rename', name: ' ОПС ' });
  });
});
