/** Read-only release check. No LLM request, browser or deployment is started. */
import { execFileSync } from 'node:child_process';

async function check(): Promise<void> {
  let expected = process.argv[2];
  if (expected === undefined) {
    try { expected = execFileSync('git', ['rev-parse', '--short', 'origin/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { throw new Error('Не найден origin/main. Передайте ожидаемый SHA аргументом.'); }
  }
  if (!/^[0-9a-f]{7,40}$/i.test(expected)) throw new Error('Ожидаемый SHA должен содержать от 7 до 40 шестнадцатеричных символов.');
  let endpoint: URL;
  try {
    const base = new URL(process.env['DEPLOY_URL'] ?? 'http://127.0.0.1:8080');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error();
    endpoint = new URL('/api/health', base);
  } catch { throw new Error('DEPLOY_URL должен быть адресом HTTP(S) без логина и пароля.'); }

  let response: Response;
  try { response = await fetch(endpoint, { signal: AbortSignal.timeout(5000), redirect: 'error' }); }
  catch { throw new Error('Сервис не ответил за 5 секунд или соединение недоступно.'); }
  if (!response.ok) throw new Error(`Проверка health завершилась HTTP ${response.status}.`);
  let health: unknown;
  try { health = await response.json(); }
  catch { throw new Error('Сервис не вернул корректный JSON за время ожидания.'); }
  if (health === null || typeof health !== 'object' || !('status' in health) || health.status !== 'ok') {
    throw new Error('Сервис не подтвердил status=ok.');
  }
  if (!('build' in health) || typeof health.build !== 'string' || !/^[0-9a-f]{7,40}$/i.test(health.build)) {
    throw new Error('Сервис не сообщает SHA сборки. Актуальность версии не подтверждена.');
  }
  // Both full and abbreviated SHAs identify the same build; require >= 7 digits.
  const actual = health.build.toLowerCase();
  expected = expected.toLowerCase();
  if (!actual.startsWith(expected) && !expected.startsWith(actual)) {
    throw new Error(`Сервис работает на ${actual}, ожидалась сборка ${expected}.`);
  }
  console.log(JSON.stringify({ status: 'ok', service: endpoint.origin, build: actual, expected }));
}

await check().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Проверка сервиса не завершена.');
  process.exitCode = 1;
});
