export type AffectedTests = {
  runAllUnit: boolean;
  runAllE2e: boolean;
  unitInputs: string[];
  e2eSpecs: string[];
};

type E2eRule = {
  prefixes: string[];
  specs: string[];
};

type UnitDataRule = {
  prefixes: string[];
  tests: string[];
};

const E2E_RULES: E2eRule[] = [
  {
    prefixes: ['src/features/assistant/', 'src/domain/advice/', 'server/advice-route.ts'],
    specs: ['tests/e2e/assistant.spec.ts'],
  },
  {
    prefixes: ['src/features/catalog-editor/', 'src/domain/catalog/', 'data/catalog/'],
    specs: ['tests/e2e/catalog-editor.spec.ts', 'tests/e2e/catalog-extension.spec.ts'],
  },
  {
    prefixes: ['src/features/editor/'],
    specs: [
      'tests/e2e/editor.spec.ts',
      'tests/e2e/focus.spec.ts',
      'tests/e2e/group-edit.spec.ts',
      'tests/e2e/group-select.spec.ts',
      'tests/e2e/history-keys.spec.ts',
    ],
  },
  {
    prefixes: ['src/features/equipment/'],
    specs: ['tests/e2e/equipment.spec.ts', 'tests/e2e/camera.spec.ts'],
  },
  {
    prefixes: ['src/features/files/', 'src/persistence/', 'scripts/package-demo.ts'],
    specs: ['tests/e2e/files.spec.ts', 'tests/e2e/round-trip.spec.ts', 'tests/e2e/demo.spec.ts'],
  },
  {
    prefixes: ['src/features/inventory/', 'src/domain/inventory/'],
    specs: ['tests/e2e/inventory.spec.ts'],
  },
  {
    prefixes: ['src/domain/metrics/'],
    specs: ['tests/e2e/inventory.spec.ts', 'tests/e2e/assistant.spec.ts'],
  },
  {
    prefixes: ['src/features/layers/', 'src/domain/content-layer'],
    specs: ['tests/e2e/layers.spec.ts', 'tests/e2e/layers-ux.spec.ts'],
  },
  {
    prefixes: ['src/features/library/'],
    specs: ['tests/e2e/catalog-extension.spec.ts', 'tests/e2e/equipment.spec.ts'],
  },
  {
    prefixes: ['src/features/onboarding/'],
    specs: ['tests/e2e/onboarding.spec.ts'],
  },
  {
    prefixes: ['src/features/plan-tools/', 'src/domain/commands/'],
    specs: ['tests/e2e/plan-tools.spec.ts', 'tests/e2e/editor.spec.ts'],
  },
  {
    prefixes: ['src/features/properties/'],
    specs: ['tests/e2e/properties.spec.ts', 'tests/e2e/right-column.spec.ts'],
  },
  {
    prefixes: ['src/features/validation/', 'src/domain/validation/', 'src/domain/relations/'],
    specs: ['tests/e2e/issue-highlight.spec.ts', 'tests/e2e/issues-on-plan.spec.ts'],
  },
  {
    prefixes: ['src/features/view3d/'],
    specs: ['tests/e2e/view3d.spec.ts'],
  },
  {
    prefixes: ['src/domain/geometry/'],
    specs: ['tests/e2e/plan-tools.spec.ts', 'tests/e2e/equipment.spec.ts', 'tests/e2e/camera.spec.ts'],
  },
  {
    prefixes: ['src/state/'],
    specs: ['tests/e2e/editor.spec.ts', 'tests/e2e/files.spec.ts', 'tests/e2e/round-trip.spec.ts'],
  },
  {
    prefixes: ['src/app/'],
    specs: [
      'tests/e2e/shell.spec.ts',
      'tests/e2e/right-column.spec.ts',
      'tests/e2e/round-trip.spec.ts',
      'tests/e2e/demo-refit.spec.ts',
    ],
  },
  {
    prefixes: ['src/contracts/', 'src/main.tsx', 'index.html'],
    specs: ['tests/e2e/round-trip.spec.ts'],
  },
  {
    prefixes: ['server/main.ts', 'server/config.ts'],
    specs: ['tests/e2e/deployment.spec.ts'],
  },
  {
    prefixes: ['server/llm-client.ts'],
    specs: ['tests/e2e/assistant.spec.ts'],
  },
  {
    prefixes: ['public/'],
    specs: ['tests/e2e/assets.spec.ts'],
  },
];

const UNIT_DATA_RULES: UnitDataRule[] = [
  {
    prefixes: ['example_plan.json'],
    tests: [
      'src/persistence/format.test.ts',
      'src/persistence/organizer-import.test.ts',
      'tests/example-plan-checks.test.ts',
    ],
  },
  {
    prefixes: ['data/catalog/'],
    tests: [
      'src/domain/advice/placement.test.ts',
      'src/domain/catalog/catalog.test.ts',
      'src/features/equipment/wall-mount.test.ts',
      'src/features/layers/legend.test.ts',
      'src/persistence/organizer-import.test.ts',
      'tests/example-plan-checks.test.ts',
    ],
  },
  {
    prefixes: ['demo/'],
    tests: [
      'src/domain/advice/placement.test.ts',
      'src/domain/validation/validation.test.ts',
      'src/features/layers/InformationLayer.test.tsx',
      'src/features/layers/LayersPanel.test.tsx',
      'src/features/plan-tools/PlanGeometryLayer.test.tsx',
      'tests/demo.test.ts',
    ],
  },
];

const UNIT_INFRASTRUCTURE = new Set([
  'package.json',
  'package-lock.json',
  'scripts/affected-tests.ts',
  'scripts/test-affected.ts',
  'vitest.config.ts',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tests/setup.ts',
]);

const E2E_INFRASTRUCTURE = new Set([
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'playwright.qa.config.ts',
  'scripts/affected-tests.ts',
  'scripts/test-affected.ts',
  'vite.config.ts',
  'tests/e2e/fixtures.ts',
]);

function normalize(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

function matches(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(prefix);
}

function isUnitInput(file: string): boolean {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return false;
  if (file.startsWith('tests/e2e/') || file.startsWith('tests/perf/')) return false;
  if (file.startsWith('tests/')) return file.endsWith('.test.ts') || file.endsWith('.test.tsx');
  return file.startsWith('src/') || file.startsWith('server/') || file.startsWith('scripts/');
}

function isProductChange(file: string): boolean {
  if (file.endsWith('.md')) return false;
  return (
    file.startsWith('src/') ||
    file.startsWith('server/') ||
    file.startsWith('data/') ||
    file.startsWith('public/') ||
    file.startsWith('tests/harness/') ||
    file === 'index.html' ||
    file === 'example_plan.json' ||
    file === 'scripts/package-demo.ts'
  );
}

function isE2eSpec(file: string): boolean {
  return file.startsWith('tests/e2e/') && file.endsWith('.spec.ts');
}

function orderedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function selectAffectedTests(files: readonly string[]): AffectedTests {
  const changed = orderedUnique(files.map(normalize));
  const runAllUnit = changed.some((file) => UNIT_INFRASTRUCTURE.has(file));
  const runAllE2e = changed.some((file) => E2E_INFRASTRUCTURE.has(file));

  if (runAllUnit || runAllE2e) {
    return { runAllUnit, runAllE2e, unitInputs: [], e2eSpecs: [] };
  }

  const unitInputs = changed.filter(isUnitInput);
  const addUnit = (testFile: string) => {
    if (!unitInputs.includes(testFile)) unitInputs.push(testFile);
  };
  for (const file of changed) {
    for (const rule of UNIT_DATA_RULES) {
      if (rule.prefixes.some((prefix) => matches(file, prefix))) {
        for (const testFile of rule.tests) addUnit(testFile);
      }
    }
  }
  unitInputs.sort();
  const e2eSpecs: string[] = [];
  const addE2e = (spec: string) => {
    if (!e2eSpecs.includes(spec)) e2eSpecs.push(spec);
  };

  for (const file of changed) {
    if (isE2eSpec(file)) addE2e(file);
  }

  const productChanges = changed.filter(isProductChange);
  if (productChanges.length > 0) addE2e('tests/e2e/smoke.spec.ts');

  let mappedProductChange = false;
  for (const file of productChanges) {
    for (const rule of E2E_RULES) {
      if (rule.prefixes.some((prefix) => matches(file, prefix))) {
        mappedProductChange = true;
        for (const spec of rule.specs) addE2e(spec);
      }
    }
  }

  if (productChanges.length > 0 && !mappedProductChange) {
    addE2e('tests/e2e/round-trip.spec.ts');
  }

  return {
    runAllUnit,
    runAllE2e,
    unitInputs,
    e2eSpecs,
  };
}

export function filterExistingE2eSpecs(
  specs: readonly string[],
  isAvailable: (spec: string) => boolean,
): string[] {
  return specs.filter(isAvailable);
}
