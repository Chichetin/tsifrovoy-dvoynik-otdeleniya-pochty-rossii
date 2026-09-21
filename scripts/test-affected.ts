import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';
import { selectAffectedTests } from './affected-tests';

type Options = {
  base: string;
  dryRun: boolean;
};

function parseOptions(args: string[]): Options {
  let base = process.env.AFFECTED_BASE ?? 'origin/main';
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--base') {
      base = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!base) throw new Error('--base requires a git ref');
  return { base, dryRun };
}

function gitFiles(args: string[]): string[] {
  const output = execFileSync('git', args, { encoding: 'utf8' });
  return output.split('\n').map((file) => file.trim()).filter(Boolean);
}

function changedFiles(base: string): string[] {
  return [
    ...gitFiles(['diff', '--name-only', '--diff-filter=ACDMR', `${base}...HEAD`]),
    ...gitFiles(['diff', '--name-only', '--diff-filter=ACDMR', 'HEAD']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard']),
  ];
}

function printSelection(files: string[], selection: ReturnType<typeof selectAffectedTests>): void {
  console.log(`Changed files: ${files.length}`);
  if (files.length > 0) console.log(files.map((file) => `  ${file}`).join('\n'));

  if (selection.runAllUnit) {
    console.log('Unit: full suite');
  } else if (selection.unitInputs.length > 0) {
    console.log(`Unit: related to ${selection.unitInputs.length} changed file(s)`);
  } else {
    console.log('Unit: skipped');
  }

  if (selection.runAllE2e) {
    console.log('E2E: full suite');
  } else if (selection.e2eSpecs.length > 0) {
    console.log(`E2E: ${selection.e2eSpecs.join(', ')}`);
  } else {
    console.log('E2E: skipped');
  }
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main(): number {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  let files: string[];
  try {
    files = [...new Set(changedFiles(options.base))].sort();
  } catch (error) {
    console.error(`Cannot inspect changes against ${options.base}:`);
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  const selection = selectAffectedTests(files);
  printSelection(files, selection);
  if (options.dryRun || files.length === 0) return 0;

  if (selection.runAllUnit) {
    const status = run('npm', ['test']);
    if (status !== 0) return status;
  } else if (selection.unitInputs.length > 0) {
    const status = run('npm', [
      'exec', '--', 'vitest', 'related', '--run', '--passWithNoTests', '--reporter=dot', '--no-color',
      ...selection.unitInputs,
    ]);
    if (status !== 0) return status;
  }

  if (selection.runAllE2e) {
    return run('npm', ['run', 'test:e2e']);
  }
  if (selection.e2eSpecs.length > 0) {
    return run('npm', ['run', 'test:e2e', '--', ...selection.e2eSpecs]);
  }
  return 0;
}

process.exitCode = main();
