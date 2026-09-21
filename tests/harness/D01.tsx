// D01 stand: View3D on the rotated fixture, with a button that moves the object —
// the scene has no state of its own, so the prism follows the plan.
import { useState } from 'react';
import rotated from '../../src/contracts/fixtures/rotated.json';
import type { PlanDocument, Ref } from '../../src/contracts/model';
import { parsePlanDocument } from '../../src/contracts/schema';
import { View3D } from '../../src/features/view3d/View3D';

const parsed = parsePlanDocument(rotated);

export default function D01Stand() {
  const [plan, setPlan] = useState<PlanDocument | null>(parsed.ok ? parsed.value : null);
  const [selection, setSelection] = useState<Ref | null>(null);

  if (plan === null) {
    return <p role="alert">Фикстура rotated.json не разобралась: {JSON.stringify(parsed)}</p>;
  }

  const first = plan.objects[0];
  const nudge = () => {
    if (!first) return;
    const moved = { ...first, position: [first.position[0] + 0.5, first.position[1]] as [number, number] };
    setPlan({ ...plan, objects: [moved, ...plan.objects.slice(1)] });
  };

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh' }}>
      <div style={{ padding: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={nudge}>
          Сдвинуть объект на +0,5 м по X
        </button>
        <button
          type="button"
          onClick={() => setSelection(first ? { kind: 'object', id: first.id } : null)}
        >
          Выбрать объект
        </button>
        <button type="button" onClick={() => setSelection(null)}>
          Снять выбор
        </button>
        <code data-testid="d01-position">{first ? JSON.stringify(first.position) : '—'}</code>
      </div>
      <div style={{ position: 'relative' }}>
        <View3D document={plan} selection={selection} onSelect={setSelection} />
      </div>
    </div>
  );
}
