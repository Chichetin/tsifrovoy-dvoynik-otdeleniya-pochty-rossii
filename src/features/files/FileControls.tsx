/**
 * IO03 (controls): open a plan, save it, start a new one.
 *
 * Every outcome is visible. A file that cannot be read leaves the open document
 * exactly where it was and says why, with the codes the codec returned; a save
 * claims nothing beyond "the browser was handed the file", because a page
 * cannot know what happened in the download folder.
 *
 * Replacing a plan with unsaved edits asks first — the store reports `dirty`,
 * it does not decide.
 */

import { useRef, useState } from 'react';
import type { Issue, PlanDocument, Result } from '../../contracts/model';
import type { RequestState } from '../../contracts/ui';

export type FileControlsProps = {
  document: PlanDocument;
  dirty: boolean;
  decode: (text: string) => Result<PlanDocument>;
  encode: (plan: PlanDocument) => Result<string>;
  onReplace: (plan: PlanDocument) => void;
  onNew: () => void;
  /** Told the revision that has just been written out, for the dirty flag. */
  onExported: () => void;
};

const DIRTY_WARNING = 'В плане есть несохранённые правки. Открыть другой файл и потерять их?';

function describe(issues: Issue[]): string {
  return issues
    .slice(0, 4)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join('; ');
}

function fileName(plan: PlanDocument): string {
  const stem = plan.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${stem === '' ? 'plan' : stem}.json`;
}

export function FileControls({
  document: plan,
  dirty,
  decode,
  encode,
  onReplace,
  onNew,
  onExported,
}: FileControlsProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<RequestState>({ status: 'idle' });

  const open = async (file: File): Promise<void> => {
    setState({ status: 'loading' });
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      setState({
        status: 'error',
        message: `Файл не прочитался: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    const decoded = decode(text);
    if (!decoded.ok) {
      // The open document stays untouched: a rejected file never replaces it.
      setState({ status: 'error', message: `План не открыт. ${describe(decoded.issues)}` });
      return;
    }
    onReplace(decoded.value);
    setState({ status: 'done' });
  };

  const save = (): void => {
    setState({ status: 'loading' });
    const encoded = encode(plan);
    if (!encoded.ok) {
      setState({ status: 'error', message: `План не сохранён. ${describe(encoded.issues)}` });
      return;
    }

    const url = URL.createObjectURL(new Blob([encoded.value], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = fileName(plan);
    link.click();
    URL.revokeObjectURL(url);

    onExported();
    setState({ status: 'done' });
  };

  return (
    <div className="files" role="group" aria-label="Файл плана">
      <button
        type="button"
        className="files__button"
        onClick={() => {
          if (dirty && !window.confirm(DIRTY_WARNING)) return;
          onNew();
          setState({ status: 'idle' });
        }}
      >
        Новый
      </button>

      <button
        type="button"
        className="files__button"
        onClick={() => {
          if (dirty && !window.confirm(DIRTY_WARNING)) return;
          input.current?.click();
        }}
      >
        Открыть
      </button>

      <button type="button" className="files__button is-primary" onClick={save}>
        Сохранить
      </button>

      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="plan-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so re-opening the same file fires change again.
          event.target.value = '';
          if (file !== undefined) void open(file);
        }}
      />

      <span className={dirty ? 'files__status is-dirty' : 'files__status'}>
        {dirty ? 'есть несохранённые правки' : 'сохранено'}
      </span>

      {state.status === 'loading' ? <span className="files__status">…</span> : null}
      {state.status === 'error' ? (
        <p className="files__error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
