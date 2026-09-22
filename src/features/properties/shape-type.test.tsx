// @vitest-environment jsdom
/**
 * D-279: форма объекта в карточке — «Сбросить форму к типу» и «Сохранить
 * форму как новый тип». Карточка живая: команды применяются к плану.
 */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import minimal from '../../contracts/fixtures/minimal.json';
import type { Equipment, PlanDocument, Polygon } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { CommandSink } from '../../contracts/ui';
import { applyCommand } from '../../domain/commands';
import { PropertiesPanel } from './PropertiesPanel';
import { hasOwnShape, shapeTypeFrom } from './shape-type';

afterEach(cleanup);

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plain: PlanDocument = parsed.value;
const source = plain.objects[0]!;
const L_SHAPE: Polygon = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0],
  [0, 0],
  [0, 0.5],
  [-0.5, 0.5],
];
const shaped: Equipment = { ...source, outline: L_SHAPE };
const put = applyCommand(plain, { type: 'object.put', object: shaped });
if (!put.ok) throw new Error('объект с формой не принят');
const plan = put.value;

describe('shapeTypeFrom', () => {
  test('новый тип копирует исходный и берёт форму и размер объекта', () => {
    const created = shapeTypeFrom(plan.catalog, shaped, '  Угловой стол ');
    expect(created).not.toBeNull();
    const type = created!.catalog.objectTypes.find((entry) => entry.id === created!.id)!;
    const origin = plan.catalog.objectTypes.find((entry) => entry.id === source.typeId)!;
    expect(created!.id).toBe('ot_shape_1');
    expect(type.label).toBe('Угловой стол');
    expect(type.outline).toEqual(L_SHAPE);
    expect(type.defaultSize_m).toEqual(source.size_m);
    expect(type.category).toBe(origin.category);
    expect(type.attributes).toEqual(origin.attributes);
    expect(type.provenance).toMatch(/^Допущение команды/);
  });

  test('без названия или без своей формы типа нет', () => {
    expect(shapeTypeFrom(plan.catalog, shaped, '   ')).toBeNull();
    expect(shapeTypeFrom(plan.catalog, source, 'Стол')).toBeNull();
  });

  test('форма, унаследованная от типа, своей не считается', () => {
    expect(hasOwnShape(plan.catalog, shaped)).toBe(true);
    expect(hasOwnShape(plain.catalog, source)).toBe(false);
  });
});

function Live(): React.JSX.Element {
  const [document, setDocument] = useState(plan);
  const onCommand: CommandSink = (command) => {
    const result = applyCommand(document, command);
    if (result.ok) setDocument(result.value);
    return result;
  };
  return (
    <>
      <PropertiesPanel
        document={document}
        session={{
          tool: { kind: 'select' },
          viewport: { origin: [0, 0], scale: 40 },
          selection: { kind: 'object', id: source.id },
          preview: null,
          focus: null,
        }}
        onCommand={onCommand}
      />
      <output data-testid="types">{document.catalog.objectTypes.map((type) => type.id).join(',')}</output>
      <output data-testid="outline">{JSON.stringify(document.objects[0]?.outline ?? null)}</output>
    </>
  );
}

describe('карточка: блок «Форма»', () => {
  test('сохранить как тип, затем сбросить форму к типу', () => {
    render(<Live />);
    expect(screen.getByTestId('props-shape').textContent).toContain('вершин — 6');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить форму как новый тип' }));
    expect(screen.getByRole('alert').textContent).toBe('Введите название типа.');

    fireEvent.change(screen.getByLabelText('Название нового типа'), { target: { value: 'Угловой стол' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить форму как новый тип' }));
    expect(screen.getByTestId('types').textContent).toContain('ot_shape_1');
    expect(screen.getByText('Тип «Угловой стол» добавлен в библиотеку.').getAttribute('role')).toBe('status');

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить форму к типу' }));
    expect(screen.getByTestId('outline').textContent).toBe('null');
    expect(screen.getByTestId('props-shape').textContent).toContain('Форма: как у типа');
  });
});
