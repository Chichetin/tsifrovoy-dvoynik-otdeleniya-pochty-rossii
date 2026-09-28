/** The server's demo files are the only source; never embed a second plan in UI. */
export type DemoPlan = 'before' | 'after';

export const DEMO_PLANS: ReadonlyArray<{ id: DemoPlan; label: string; url: string }> = [
  { id: 'before', label: 'Исходный демо-план', url: '/demo/before.json' },
  { id: 'after', label: 'Изменённый демо-план', url: '/demo/after.json' },
];

/** Returns text for the same readPlanFile codec used by a local file. */
export async function readDemoText(
  variant: DemoPlan,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<string> {
  const entry = DEMO_PLANS.find((item) => item.id === variant);
  if (entry === undefined) throw new Error('Неизвестный вариант демо-плана.');
  const response = await (options.fetch ?? fetch)(entry.url, { signal: options.signal });
  if (!response.ok) throw new Error(`Демо-план не загрузился (HTTP ${response.status}). Попробуйте ещё раз.`);
  return response.text();
}
