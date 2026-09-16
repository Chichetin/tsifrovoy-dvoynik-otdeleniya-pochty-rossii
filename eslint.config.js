import { readdirSync } from 'node:fs';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Module boundaries from docs/project-structure.md, enforced on relative imports.
const dirs = (...names) => ({ regex: `^\\.{1,2}/(.*/)?(${names.join('|')})(/|$)` });
const packages = (...names) => ({ regex: `^(${names.join('|')})(/|$)` });
const ui = packages('react', 'react-dom', 'react-konva', 'konva', 'three', 'zustand');
const features = readdirSync('src/features', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const restrict = (files, ...patterns) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: patterns.map((p) => ({ ...p, message: 'Нарушена граница модулей: docs/project-structure.md' })) }] },
});

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results', '.claude'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  restrict(['src/contracts/**'], dirs('domain', 'state', 'persistence', 'features', 'app', 'server', 'tests', 'scripts')),
  restrict(['src/domain/**'], ui, dirs('state', 'persistence', 'features', 'app', 'server', 'tests', 'scripts')),
  restrict(['src/state/**'], dirs('persistence', 'features', 'app', 'server', 'tests', 'scripts')),
  restrict(['src/persistence/**'], dirs('state', 'features', 'app', 'server', 'tests', 'scripts')),
  ...features.map((name) =>
    restrict(
      [`src/features/${name}/**`],
      dirs('state', 'app', 'server', 'tests', 'scripts', ...features.filter((other) => other !== name)),
    ),
  ),
  restrict(['src/app/**'], dirs('server', 'tests', 'scripts')),
  restrict(['server/**'], dirs('state', 'features', 'app', 'tests', 'scripts'), { regex: '^\\.{1,2}/(.*/)?contracts/ui(\\.ts)?$' }),
);
