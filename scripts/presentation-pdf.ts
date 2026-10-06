/** One PDF of the HTML defense deck (presentation/<variant>/index.html?static), one page per slide.
 *
 *   npx tsx scripts/presentation-pdf.ts [--variant route] [--backup] [--dir presentation] [--out output/pdf/…]
 *
 * Each slide is opened by its hash in `?static` mode (every step shown, nothing moves) and captured
 * at 1920×1080 as JPEG. The pages go into one PDF; the size limit of the submission is 20 MB. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { resolveChannel } from '../playwright.config';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const variant = arg('variant', 'route');
const withBackup = process.argv.includes('--backup');
const deckDir = resolve(arg('dir', 'presentation'));
const out = resolve(arg('out', join('output', 'pdf', 'ops-digital-twin-defense.pdf')));
const limitBytes = 20 * 1024 * 1024;

const deckUrl = `${pathToFileURL(join(deckDir, variant, 'index.html')).href}?static`;
statSync(join(deckDir, variant, 'index.html'));

const browser = await chromium.launch({ channel: resolveChannel(process.env.PW_CHANNEL) });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(deckUrl);
  const ids = await page.$$eval('.slide', (slides, backup) =>
    slides.filter((s) => s.getAttribute('data-kind') === 'main' || (backup && s.getAttribute('data-kind') === 'backup')).map((s) => s.id), withBackup);
  if (ids.length === 0) throw new Error(`в ${deckUrl} нет слайдов`);

  const shots: string[] = [];
  for (const id of ids) {
    await page.goto(`${deckUrl}#${id}`);
    await page.locator(`#${id}.active`).waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    });
    await page.waitForTimeout(600);
    const jpeg = await page.locator('#stage').screenshot({ type: 'jpeg', quality: 88, animations: 'disabled' });
    shots.push(jpeg.toString('base64'));
    console.log(`[pdf] ${id}`);
  }

  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:1920px 1080px;margin:0}
html,body{margin:0}img{display:block;width:1920px;height:1080px;break-after:page}</style>
${shots.map((b64) => `<img src="data:image/jpeg;base64,${b64}">`).join('')}`;
  const sheet = await context.newPage();
  await sheet.setContent(html, { waitUntil: 'load' });
  mkdirSync(dirname(out), { recursive: true });
  await sheet.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, pageRanges: `1-${shots.length}` });

  const size = statSync(out).size;
  console.log(`[pdf] ${out}: ${ids.length} стр., ${(size / 1024 / 1024).toFixed(2)} МБ`);
  if (errors.length) console.warn(`[pdf] ошибки страницы:\n${errors.join('\n')}`);
  if (size > limitBytes) throw new Error(`PDF больше 20 МБ: ${size} Б`);
  writeFileSync(`${out}.sha256`, `${createHash('sha256').update(readFileSync(out)).digest('hex')}  ${out.split('/').pop()}\n`);
} finally {
  await browser.close();
}
