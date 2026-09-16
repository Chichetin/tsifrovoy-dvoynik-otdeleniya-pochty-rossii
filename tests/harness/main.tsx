// Dev-only stand loader: /tests/harness/?id=<PACKAGE_ID> renders tests/harness/<PACKAGE_ID>.tsx.
// Each stand module default-exports a component; the stand owner creates the file.
import type { ComponentType } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const stands = import.meta.glob<{ default: ComponentType }>(['./*.tsx', '!./main.tsx']);
const id = new URLSearchParams(location.search).get('id') ?? '';
const root = createRoot(document.getElementById('root')!);
const load = stands[`./${id}.tsx`];

if (!load) {
  root.render(<p role="alert">Стенд «{id}» не найден. Есть: {Object.keys(stands).join(', ')}</p>);
} else {
  const { default: Stand } = await load();
  root.render(
    <StrictMode>
      <div data-testid="harness-ready">
        <Stand />
      </div>
    </StrictMode>,
  );
}
