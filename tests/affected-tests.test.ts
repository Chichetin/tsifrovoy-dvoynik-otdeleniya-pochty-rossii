import { describe, expect, test } from 'vitest';
import { filterExistingE2eSpecs, selectAffectedTests } from '../scripts/affected-tests';

describe('affected test selection', () => {
  test('selects the assistant browser spec and smoke for an assistant change', () => {
    expect(selectAffectedTests(['src/features/assistant/AssistantPanel.tsx'])).toEqual({
      runAllUnit: false,
      runAllE2e: false,
      unitInputs: ['src/features/assistant/AssistantPanel.tsx'],
      e2eSpecs: ['tests/e2e/smoke.spec.ts', 'tests/e2e/assistant.spec.ts'],
    });
  });

  test('does not run tests for documentation-only changes', () => {
    expect(selectAffectedTests(['docs/README.md'])).toEqual({
      runAllUnit: false,
      runAllE2e: false,
      unitInputs: [],
      e2eSpecs: [],
    });
  });

  test('selects only the directly changed browser spec', () => {
    expect(selectAffectedTests(['tests/e2e/files.spec.ts'])).toEqual({
      runAllUnit: false,
      runAllE2e: false,
      unitInputs: [],
      e2eSpecs: ['tests/e2e/files.spec.ts'],
    });
  });

  test('keeps the core round-trip when app composition changes', () => {
    expect(selectAffectedTests(['src/app/App.tsx']).e2eSpecs).toEqual([
      'tests/e2e/smoke.spec.ts',
      'tests/e2e/shell.spec.ts',
      'tests/e2e/right-column.spec.ts',
      'tests/e2e/round-trip.spec.ts',
      'tests/e2e/demo-refit.spec.ts',
    ]);
  });

  test('falls back to the core round-trip for an unmapped product file', () => {
    expect(selectAffectedTests(['src/new-feature.ts'])).toEqual({
      runAllUnit: false,
      runAllE2e: false,
      unitInputs: ['src/new-feature.ts'],
      e2eSpecs: ['tests/e2e/smoke.spec.ts', 'tests/e2e/round-trip.spec.ts'],
    });
  });

  test('runs the complete suites when test infrastructure changes', () => {
    expect(selectAffectedTests(['playwright.config.ts'])).toEqual({
      runAllUnit: false,
      runAllE2e: true,
      unitInputs: [],
      e2eSpecs: [],
    });
  });

  test('maps organizer data changes to tests that read the JSON directly', () => {
    const selection = selectAffectedTests(['example_plan.json']);

    expect(selection.unitInputs).toEqual(
      expect.arrayContaining([
        'src/persistence/format.test.ts',
        'src/persistence/organizer-import.test.ts',
        'tests/example-plan-checks.test.ts',
      ]),
    );
  });

  test('treats the affected-test runner itself as test infrastructure', () => {
    expect(selectAffectedTests(['scripts/test-affected.ts'])).toEqual({
      runAllUnit: true,
      runAllE2e: true,
      unitInputs: [],
      e2eSpecs: [],
    });
  });

  test('does not treat a module README as a product change', () => {
    expect(selectAffectedTests(['src/features/assistant/README.md'])).toEqual({
      runAllUnit: false,
      runAllE2e: false,
      unitInputs: [],
      e2eSpecs: [],
    });
  });

  test('does not pass deleted e2e files to Playwright', () => {
    expect(
      filterExistingE2eSpecs(
        ['tests/e2e/files.spec.ts', 'tests/e2e/removed.spec.ts'],
        (file) => file !== 'tests/e2e/removed.spec.ts',
      ),
    ).toEqual(['tests/e2e/files.spec.ts']);
  });
});
