/**
 * IO03 (controls): open a plan, save it, start a new one, and do not lose work
 * to a closed tab.
 *
 * Every outcome is visible. A file that cannot be read leaves the open document
 * exactly where it was and says why, with the codes the reader returned; a save
 * claims nothing beyond "the browser was handed the file", because a page
 * cannot know what happened in the download folder; a draft says "в браузере",
 * because localStorage is not the disk.
 *
 * The button takes both formats the jury can bring — our versioned file and the
 * organizers' `example_plan.json` — and the file itself decides which one it
 * is (`readPlanFile`). An imported example says so on screen: the values the
 * example never stated are assumptions of this team, and the next save writes
 * our format, not theirs.
 *
 * Replacing a plan with unsaved edits asks first — the store reports `dirty`,
 * it does not decide. Replacing a plan that already has zones or objects in it
 * asks too, saved or not: a file opened a minute ago is clean by `dirty` and is
 * still the user's work.
 *
 * The draft offer blocks writing only until the user does something with the
 * document — starts a new plan, opens a file, or makes the first edit. From
 * that moment the draft is written again, or a whole session of work would be
 * lost to a closed tab because a question stayed on screen unanswered.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentOrigin } from '../../contracts/commands';
import type { Issue, PlanDocument, Result } from '../../contracts/model';
import type { RequestState } from '../../contracts/ui';
import {
  clearDraft,
  createDraftWriter,
  draftDiffers,
  readDraft,
  type DraftStorage,
  type DraftWriter,
  type PlanDraft,
} from '../../persistence/browser-draft';
import type { OpenedPlan } from '../../persistence/format';
import { planFileName, renderPlanSvg, svgFileName } from '../../persistence/plan-svg';

export type FileControlsProps = {
  document: PlanDocument;
  dirty: boolean;
  /** A fresh, untouched plan starts at revision 0 even though it is not exported. */
  revision: number;
  /** Reads a file of either supported format; see `persistence/format.ts`. */
  read: (text: string) => Result<OpenedPlan>;
  encode: (plan: PlanDocument) => Result<string>;
  /** `origin` отличает файл от восстановленного черновика: черновик не сохранён. */
  onReplace: (plan: PlanDocument, origin: DocumentOrigin) => void;
  onNew: () => void;
  /** Told the revision that has just been written out, for the dirty flag. */
  onExported: () => void;
  /**
   * Where the draft lives. `undefined` means the browser's localStorage;
   * `null` switches the draft off, which is what a stand or a test wants.
   */
  storage?: DraftStorage | null;
};

const RESTORE_WARNING =
  'План уже изменён с момента открытия страницы. Восстановить черновик и потерять эти правки?';

const ORGANIZER_NOTE =
  'План импортирован из формата организаторов (example_plan.json) с допущениями команды. ' +
  'Кнопка «Сохранить» запишет его уже в формате редактора.';

function describe(issues: Issue[]): string {
  return issues
    .slice(0, 4)
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join('; ');
}

/** Есть ли в плане что терять: помещение и слои даёт и пустой новый план. */
function hasContent(plan: PlanDocument): boolean {
  return plan.zones.length > 0 || plan.objects.length > 0;
}

function needsReplacementWarning(plan: PlanDocument, dirty: boolean, revision: number): boolean {
  return hasContent(plan) || (dirty && revision > 0);
}

function replacementWarning(action: 'Новый' | 'Открыть', dirty: boolean): string {
  const consequence = dirty ? 'Несохранённые правки будут потеряны.' : 'Текущий план будет заменён.';
  return `${consequence} ${action === 'Новый' ? 'Создать новый план?' : 'Открыть другой файл?'}`;
}

function fileName(plan: PlanDocument): string {
  return planFileName(plan, 'json');
}

/** Хранилище браузера, если оно вообще доступно: приватный режим бросает. */
function browserStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function atTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'неизвестного времени';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function FileControls({
  document: plan,
  dirty,
  revision,
  read,
  encode,
  onReplace,
  onNew,
  onExported,
  storage: given,
}: FileControlsProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const openSequence = useRef(0);
  const currentDocument = useRef({ plan, revision });
  useLayoutEffect(() => {
    currentDocument.current = { plan, revision };
  }, [plan, revision]);
  useEffect(() => () => { openSequence.current += 1; }, []);
  const [state, setState] = useState<RequestState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [storage] = useState<DraftStorage | null>(() =>
    given === undefined ? browserStorage() : given,
  );
  // Состояние первого рендера: с чем страница открылась и есть ли черновик,
  // который стоит предложить. Читается один раз — пока предложение висит,
  // писать нельзя, иначе пустой план затрёт то, что предлагаем восстановить.
  const [start] = useState<{ opening: string | null; draft: PlanDraft | null }>(() => {
    if (storage === null) return { opening: null, draft: null };
    const started = encode(plan);
    const opening = started.ok ? started.value : null;
    const draft = readDraft(storage);
    return { opening, draft: draft !== null && draftDiffers(draft, opening) ? draft : null };
  });
  const [offered, setOffered] = useState<PlanDraft | null>(start.draft);
  // Ответил ли пользователь на предложение действием с документом: «Новый»,
  // «Открыть», «Восстановить», «Удалить». Пока нет — нетронутый стартовый план
  // в черновик не пишется, иначе он затрёт то, что мы предлагаем восстановить.
  const [answered, setAnswered] = useState<boolean>(start.draft === null);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const writer = useRef<DraftWriter | null>(null);
  const untouchedNew = dirty && revision === 0 && !hasContent(plan);

  useEffect(() => {
    if (storage === null) return;
    const created = createDraftWriter(storage, {
      onSaved: (draft) => {
        setDraftAt(draft.savedAt);
        setDraftError(null);
      },
      onError: (message) => setDraftError(message),
    });
    writer.current = created;
    return () => {
      created.cancel();
      writer.current = null;
    };
  }, [storage]);

  // План сериализуется в момент записи, а не на каждое движение мыши — и там же
  // решается, писать ли вообще: пока предложение висит без ответа, а план не
  // тронут, писать нечего. Первая же правка документа — это тоже ответ:
  // пользователь работает с тем, что открыто, и терять его работу нельзя.
  useEffect(() => {
    const active = writer.current;
    if (active === null) return;
    active.schedule(() => {
      const encoded = encode(plan);
      // План, который не запишется в файл, не годится и в черновик.
      if (!encoded.ok) return null;
      if (!answered && encoded.value === start.opening) return null;
      return { text: encoded.value, name: plan.name };
    });
    return () => active.cancel();
  }, [plan, answered, encode, start.opening]);

  const accept = (opened: OpenedPlan, origin: DocumentOrigin): void => {
    openSequence.current += 1;
    // Документ заменён целиком — вопрос о черновике отвечен самим действием.
    setOffered(null);
    setAnswered(true);
    onReplace(opened.plan, origin);
    setAssumptions(opened.format === 'organizer' ? opened.assumptions : []);
    setNotice(
      opened.format === 'organizer' ? ORGANIZER_NOTE : `План «${opened.plan.name}» открыт.`,
    );
    setState({ status: 'done' });
  };

  const open = async (file: File): Promise<void> => {
    const sequence = ++openSequence.current;
    const stillCurrent = (): boolean => {
      if (sequence !== openSequence.current) return false;
      if (currentDocument.current.plan !== plan || currentDocument.current.revision !== revision) {
        setState({
          status: 'error',
          message: 'План изменён во время чтения файла. Открытие отменено, ваши правки сохранены.',
        });
        return false;
      }
      return true;
    };
    setState({ status: 'loading' });
    setNotice(null);
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      if (!stillCurrent()) return;
      setState({
        status: 'error',
        message: `Файл не прочитался: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    if (!stillCurrent()) return;
    const opened = read(text);
    if (!opened.ok) {
      // The open document stays untouched: a rejected file never replaces it.
      setAssumptions([]);
      setState({ status: 'error', message: `План не открыт. ${describe(opened.issues)}` });
      return;
    }
    accept(opened.value, 'file');
  };

  const restore = (draft: PlanDraft): void => {
    // Спрашиваем, когда в плане уже что-то есть: только что открытый файл по
    // `dirty` чист, но это работа пользователя. И когда план тронут с момента
    // открытия страницы: зон и объектов может не быть, а контур, стены и
    // название уже правились. Нетронутый пустой план терять нечего.
    const current = encode(plan);
    const touched = !current.ok || current.value !== start.opening;
    if ((hasContent(plan) || touched) && !window.confirm(RESTORE_WARNING)) return;
    openSequence.current += 1;
    const opened = read(draft.text);
    setOffered(null);
    setAnswered(true);
    if (!opened.ok) {
      // Черновик оказался мусором: открытый план не трогаем, черновик убираем.
      if (storage !== null) clearDraft(storage);
      setState({
        status: 'error',
        message: `Черновик не восстановлен, план не изменён. ${describe(opened.issues)}`,
      });
      return;
    }
    accept(opened.value, 'draft');
  };

  const dismiss = (): void => {
    // Стираем только пока в хранилище лежит именно предложенный черновик: если
    // запись уже возобновилась (`draftAt`), там текущая работа пользователя, и
    // удалять её никто не просил.
    if (storage !== null && draftAt === null) clearDraft(storage);
    setOffered(null);
    setAnswered(true);
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
    setNotice(`Файл ${fileName(plan)} передан браузеру на скачивание.`);
    setState({ status: 'done' });
  };

  /**
   * Картинка плана для согласования — SVG из того же документа (D-061). Это
   * не сохранение: план после выгрузки остаётся таким же «несохранённым»,
   * каким был, и черновик не трогается.
   */
  const exportImage = (): void => {
    const svg = renderPlanSvg(plan);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = svgFileName(plan);
    link.click();
    URL.revokeObjectURL(url);
    // Own result state, like «Сохранить»: otherwise a stale «План не открыт…»
    // would stay on screen next to a file that downloaded fine.
    setNotice(`Картинка ${svgFileName(plan)} передана браузеру на скачивание.`);
    setState({ status: 'done' });
  };


  return (
    <>
    <div className="files" role="group" aria-label="Файл плана">
      <button
        type="button"
        className="files__button"
        onClick={() => {
          if (needsReplacementWarning(plan, dirty, revision) &&
              !window.confirm(replacementWarning('Новый', dirty))) return;
          openSequence.current += 1;
          onNew();
          if (storage !== null) clearDraft(storage);
          // Чистый лист — тоже ответ на предложение: черновика больше нет.
          setOffered(null);
          setAnswered(true);
          setDraftAt(null);
          setAssumptions([]);
          setNotice(null);
          setState({ status: 'idle' });
        }}
      >
        Новый
      </button>

      <button
        type="button"
        className="files__button"
        onClick={() => {
          if (needsReplacementWarning(plan, dirty, revision) &&
              !window.confirm(replacementWarning('Открыть', dirty))) return;
          input.current?.click();
        }}
      >
        Открыть
      </button>

      <button
        type="button"
        className="files__button"
        title="Скачать план картинкой (SVG) для согласования и презентации"
        data-testid="export-svg"
        onClick={exportImage}
      >
        Картинка
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
        {untouchedNew ? 'новый план не сохранён' : dirty ? 'есть несохранённые правки' : 'сохранено'}
      </span>

    </div>

    <div className="files__messages">
      {state.status === 'loading' ? (
        <span className="files__status" data-testid="files-loading">
          читаем файл…
        </span>
      ) : null}

      <span className="files__status" data-testid="draft-saved">
        черновик в браузере: {draftAt === null ? 'ещё нет' : atTime(draftAt)}
      </span>

      {draftError === null ? null : (
        <span className="files__status is-dirty" data-testid="draft-error">
          {draftError}
        </span>
      )}

      {offered === null ? null : (
        <span className="files__status" data-testid="draft-restore">
          Черновик «{offered.name}» от {atTime(offered.savedAt)}
          {draftAt === null
            ? ' в этом браузере.'
            : '; в браузере уже сохраняется текущая работа.'}{' '}
          <button type="button" className="files__button" onClick={() => restore(offered)}>
            Восстановить
          </button>{' '}
          <button type="button" className="files__button" onClick={dismiss}>
            Удалить
          </button>
        </span>
      )}

      {state.status === 'done' && notice !== null ? (
        <span className="files__status" data-testid="files-notice">
          {notice}
        </span>
      ) : null}

      {assumptions.length === 0 ? null : (
        <details className="files__status" data-testid="organizer-assumptions">
          <summary>Допущения импорта ({assumptions.length})</summary>
          <ul>
            {assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      {state.status === 'error' ? (
        <p className="files__error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
    </>
  );
}
