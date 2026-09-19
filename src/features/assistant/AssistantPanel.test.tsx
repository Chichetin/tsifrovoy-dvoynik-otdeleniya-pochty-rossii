// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { AssistantPanel } from './AssistantPanel';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');

afterEach(cleanup);

function changedCatalog(plan: PlanDocument): PlanDocument {
  const source = plan.catalog.objectTypes[0];
  if (source === undefined) throw new Error('в minimal.json нет типов объектов');
  return {
    ...plan,
    zones: [],
    catalog: {
      ...plan.catalog,
      objectTypes: [{ ...source, id: 'ot_other', label: 'Другой тип' }],
      rules: [],
    },
  };
}

test('после открытия другого плана не отправляет тип и зону прежнего документа', () => {
  const onAsk = vi.fn();
  const props = {
    revision: 0,
    response: null,
    state: { status: 'idle' as const },
    onPreview: vi.fn(),
    onFocus: vi.fn(),
    onAsk,
  };
  const { rerender } = render(<AssistantPanel {...props} document={parsed.value} />);

  const oldZone = parsed.value.zones[0];
  if (oldZone === undefined) throw new Error('в minimal.json нет зон');
  fireEvent.change(screen.getByLabelText('Зона'), { target: { value: oldZone.id } });

  const next = changedCatalog(parsed.value);
  rerender(<AssistantPanel {...props} document={next} revision={1} />);

  expect((screen.getByLabelText('Объект') as HTMLSelectElement).value).toBe('ot_other');
  expect((screen.getByLabelText('Зона') as HTMLSelectElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Спросить' }));
  expect(onAsk).toHaveBeenCalledWith(
    { scenario: 'place', typeId: 'ot_other', zoneId: null },
    undefined,
  );
});
