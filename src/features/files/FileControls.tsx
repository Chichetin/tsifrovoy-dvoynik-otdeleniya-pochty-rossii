/**
 * IO03 (controls): open a plan, save it, start a new one, and do not lose work
 * to a closed tab.
 *
 * Every outcome is visible. A file that cannot be read leaves the open document
 * exactly where it was and says why in plain language; technical codes stay
 * available in a collapsed detail only when somebody needs diagnostics; a save
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
import { planPhysicsIssues } from '../../domain/physics';
import { NBSP } from '../../domain/number-format';
import type { OpenedPlan } from '../../persistence/format';
import { pngFileName, renderPlanPng } from '../../persistence/plan-png';
import { planFileName, renderPlanSvg, svgFileName } from '../../persistence/plan-svg';
import { FileDialog } from './FileDialog';

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

/**
 * D-291: сколько живёт полоса сообщений о файле. Раньше она висела над планом
 * постоянно — менялась только надпись. Успешное сообщение само уходит через
 * этот срок; ошибка не уходит по времени никогда (см. `useEffect` ниже).
 */
const NOTICE_LIFETIME_MS = 7_000;

/** Сколько нарушений физики показать в окне отказа: остальное — во вкладке «Проверка». */
const PHYSICS_SHOWN = 5;

const RESTORE_WARNING =
  'План уже изменён с момента открытия страницы. Восстановить черновик и потерять эти правки?';

const ORGANIZER_NOTE =
  'План импортирован из формата организаторов (example_plan.json) с допущениями команды. ' +
  'Пункт «Экспорт → JSON» запишет его уже в формате редактора.';

function technicalDetails(issues: Issue[]): string[] {
  return issues
    .slice(0, 4)
    .map((issue) => `${issue.code}: ${issue.message}`)
    ;
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

/**
 * «Тронут ли план» судится по содержимому без видимости слоёв: показать слой —
 * не правка (D-207), и черновик от этого ни писаться, ни спрашивать
 * подтверждения не должен. В сам черновик план идёт как есть.
 */
function fingerprint(encode: FileControlsProps['encode'], document: PlanDocument): string | null {
  const shown = encode({ ...document, layers: document.layers.map((layer) => ({ ...layer, visible: true })) });
  return shown.ok ? shown.value : null;
}

/** Отдаёт готовый файл браузеру: одна ссылка на все три пункта «Экспорта». */
function handToBrowser(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
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
  /** Bumped by every export: a late PNG must not overwrite a later export's result. */
  const exportSequence = useRef(0);
  const currentDocument = useRef({ plan, revision });
  useLayoutEffect(() => {
    currentDocument.current = { plan, revision };
  }, [plan, revision]);
  useEffect(() => () => { openSequence.current += 1; }, []);
  const [state, setState] = useState<RequestState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<readonly string[]>([]);
  // D-274: a file error speaks about the plan as it was; the next edit of the
  // plan makes it stale. Adjusted during render, not in an effect: an error
  // raised later («план изменён во время чтения») stays until the next edit.
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (state.status === 'error') {
      setState({ status: 'idle' });
      setErrorDetails([]);
    }
  }
  const dismissError = (): void => {
    setState({ status: 'idle' });
    setErrorDetails([]);
  };
  /** Что именно делает редактор прямо сейчас: читает файл или собирает картинку. */
  const [busy, setBusy] = useState<string>('читаем файл…');
  const [menuOpen, setMenuOpen] = useState(false);
  /** Which item gets focus when the menu opens: ArrowUp on the button starts from the end. */
  const menuStart = useRef<'first' | 'last'>('first');
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const exportMenu = useRef<HTMLDivElement>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [storage] = useState<DraftStorage | null>(() =>
    given === undefined ? browserStorage() : given,
  );
  // Состояние первого рендера: с чем страница открылась и есть ли черновик,
  // который стоит предложить. Читается один раз — пока предложение висит,
  // писать нельзя, иначе пустой план затрёт то, что предлагаем восстановить.
  const [start] = useState<{ opening: string | null; draft: PlanDraft | null }>(() => {
    if (storage === null) return { opening: null, draft: null };
    const opening = fingerprint(encode, plan);
    const draft = readDraft(storage);
    // The draft is compared by the same fingerprint: one that differs from the
    // opening plan only by which layers are shown is nothing to offer.
    const draftShown = draft === null ? null : read(draft.text);
    const comparable =
      draft !== null && draftShown !== null && draftShown.ok
        ? { ...draft, text: fingerprint(encode, draftShown.value.plan) ?? draft.text }
        : draft;
    return { opening, draft: comparable !== null && draftDiffers(comparable, opening) ? draft : null };
  });
  const [offered, setOffered] = useState<PlanDraft | null>(start.draft);
  // Ответил ли пользователь на предложение действием с документом: «Создать новый»,
  // «Открыть существующий», «Восстановить», «Удалить». Пока нет — нетронутый стартовый план
  // в черновик не пишется, иначе он затрёт то, что мы предлагаем восстановить.
  const [answered, setAnswered] = useState<boolean>(start.draft === null);
  /**
   * D-286: нарушения физики, из-за которых сохранение остановлено. `null` —
   * вопрос не задан; непустой список — окно с отказом и выбором.
   */
  const [blocking, setBlocking] = useState<Issue[] | null>(null);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const writer = useRef<DraftWriter | null>(null);

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
      if (!answered && fingerprint(encode, plan) === start.opening) return null;
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
    setDropped(opened.dropped);
    setNotice(
      opened.format === 'organizer' ? ORGANIZER_NOTE : `План «${opened.plan.name}» открыт.`,
    );
    setErrorDetails([]);
    setState({ status: 'done' });
  };

  const showIssueError = (message: string, issues: Issue[]): void => {
    setErrorDetails(technicalDetails(issues));
    setState({ status: 'error', message });
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
        setErrorDetails([]);
        return false;
      }
      return true;
    };
    setBusy('читаем файл…');
    setState({ status: 'loading' });
    setNotice(null);
    setErrorDetails([]);
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      if (!stillCurrent()) return;
      setState({
        status: 'error',
        message: `Файл не прочитался: ${error instanceof Error ? error.message : String(error)}`,
      });
      setErrorDetails([]);
      return;
    }

    if (!stillCurrent()) return;
    const opened = read(text);
    if (!opened.ok) {
      // The open document stays untouched: a rejected file never replaces it.
      // Документ не сменился: допущения прежнего файла уже неверны для сообщения
      // об отказе, а список полей вне формата относится к оставшемуся плану.
      setAssumptions([]);
      showIssueError('План не открыт: файл не соответствует поддерживаемому формату.', opened.issues);
      return;
    }
    accept(opened.value, 'file');
  };

  const restore = (draft: PlanDraft): void => {
    // Спрашиваем, когда в плане уже что-то есть: только что открытый файл по
    // `dirty` чист, но это работа пользователя. И когда план тронут с момента
    // открытия страницы: зон и объектов может не быть, а контур, стены и
    // название уже правились. Нетронутый пустой план терять нечего.
    const current = fingerprint(encode, plan);
    const touched = current === null || current !== start.opening;
    if ((hasContent(plan) || touched) && !window.confirm(RESTORE_WARNING)) return;
    openSequence.current += 1;
    const opened = read(draft.text);
    setOffered(null);
    setAnswered(true);
    if (!opened.ok) {
      // Черновик оказался мусором: открытый план не трогаем, черновик убираем.
      if (storage !== null) clearDraft(storage);
      showIssueError('Черновик не восстановлен, текущий план не изменён.', opened.issues);
      return;
    }
    accept(opened.value, 'draft');
  };

  /**
   * «Не сейчас»: вопрос уходит с экрана, но ответом не считается — `answered`
   * не трогаем. Иначе запись черновика возобновилась бы сразу и затёрла бы
   * пустым планом ровно то, что мы только что предлагали сохранить. Так
   * черновик доживает до следующего открытия страницы, а первая настоящая
   * правка этого плана, как и прежде, пишется поверх него.
   */
  const later = (): void => {
    setOffered(null);
  };

  const dismiss = (): void => {
    // Стираем только пока в хранилище лежит именно предложенный черновик: если
    // запись уже возобновилась (`draftAt`), там текущая работа пользователя, и
    // удалять её никто не просил.
    if (storage !== null && draftAt === null) clearDraft(storage);
    setOffered(null);
    setAnswered(true);
  };

  /**
   * D-286: план с нарушением физики файлом не уходит с первого нажатия.
   * Проверка считается по тому же `validatePlan`, что показывает вкладка
   * «Проверка», поэтому окно отказа и панель не могут разойтись.
   *
   * Отказ не окончательный (`force`): нарушения приходят и файлом — их три
   * пары в `example_plan.json` — и проверяющий, открывший чужой план, должен
   * уметь сохранить его обратно, а не чинить чужую геометрию руками. Картинки
   * PNG и SVG и черновик в браузере гейт не трогает: первое — не план, второе
   * — защита от закрытой вкладки.
   */
  const save = (force = false): void => {
    if (!force) {
      const violations = planPhysicsIssues(plan);
      if (violations.length > 0) {
        setBlocking(violations);
        return;
      }
    }
    exportSequence.current += 1;
    setBusy('читаем файл…');
    setState({ status: 'loading' });
    const encoded = encode(plan);
    if (!encoded.ok) {
      showIssueError('План не сохранён: сначала исправьте ошибки в его данных.', encoded.issues);
      return;
    }

    handToBrowser(new Blob([encoded.value], { type: 'application/json' }), fileName(plan));
    onExported();
    setErrorDetails([]);
    setNotice(`Файл ${fileName(plan)} передан браузеру на скачивание.`);
    setState({ status: 'done' });
  };

  /**
   * Картинка плана для согласования — SVG из того же документа (D-061). Это
   * не сохранение: план после выгрузки остаётся таким же «несохранённым»,
   * каким был, и черновик не трогается.
   */
  const exportSvg = (): void => {
    exportSequence.current += 1;
    handToBrowser(new Blob([renderPlanSvg(plan)], { type: 'image/svg+xml' }), svgFileName(plan));
    // Own result state, like «Сохранить»: otherwise a stale «План не открыт…»
    // would stay on screen next to a file that downloaded fine.
    setErrorDetails([]);
    setNotice(`Картинка ${svgFileName(plan)} передана браузеру на скачивание.`);
    setState({ status: 'done' });
  };

  /**
   * PNG — тот же SVG, растеризованный браузером (D-255). Растеризация
   * асинхронная, поэтому у пункта есть все три состояния: «готовим», файл
   * передан браузеру, и отказ с причиной вместо пустого файла.
   */
  const exportPng = (): void => {
    const name = pngFileName(plan);
    // Opening a file, «Создать новый», a draft restore or a later export bump
    // a sequence: a late raster must not overwrite their state with its own.
    const sequence = openSequence.current;
    const request = ++exportSequence.current;
    const stale = (): boolean => sequence !== openSequence.current || request !== exportSequence.current;
    setBusy('готовим картинку PNG…');
    setNotice(null);
    setState({ status: 'loading' });
    renderPlanPng(plan).then(
      (blob) => {
        if (stale()) return;
        handToBrowser(blob, name);
        setErrorDetails([]);
        setNotice(`Картинка ${name} передана браузеру на скачивание.`);
        setState({ status: 'done' });
      },
      (error: unknown) => {
        if (stale()) return;
        const reason = error instanceof Error ? error.message : String(error);
        setErrorDetails([]);
        setState({ status: 'error', message: `Картинка PNG не выгружена. ${reason}` });
      },
    );
  };

  /**
   * Пункты «Экспорта» в одном списке: план файлом и две картинки. Меню вместо
   * трёх кнопок — шапка обязана оставаться одной строкой на 1280 px
   * (`tests/e2e/shell.spec.ts`), а выгрузки редки по сравнению с «Открыть».
   */
  const exportItems: { key: 'json' | 'png' | 'svg'; label: string; hint: string }[] = [
    {
      key: 'json',
      label: 'JSON — файл плана',
      hint: 'Сохранить план файлом .json: зоны, оборудование, идентификаторы и атрибуты',
    },
    {
      key: 'png',
      label: 'PNG — картинка',
      hint: 'Растровая картинка плана для презентации и переписки',
    },
    {
      key: 'svg',
      label: 'SVG — векторная картинка',
      hint: 'Векторная картинка плана для согласования и печати',
    },
  ];

  const closeMenu = (returnFocus: boolean): void => {
    setMenuOpen(false);
    if (returnFocus) exportTrigger.current?.focus();
  };

  /** Открытое меню забирает фокус на первый пункт: дальше — стрелками. */
  useEffect(() => {
    if (!menuOpen) return;
    const items = exportMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[menuStart.current === 'last' ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (exportMenu.current?.contains(target ?? null) === true) return;
      if (exportTrigger.current?.contains(target ?? null) === true) return;
      setMenuOpen(false);
    };
    window.document.addEventListener('pointerdown', outside);
    return () => window.document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      exportMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const at = items.indexOf(window.document.activeElement as HTMLElement);
    const focusAt = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    if (event.key === 'ArrowDown') focusAt(at + 1);
    else if (event.key === 'ArrowUp') focusAt(at - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
  };

  /**
   * D-291: сообщение об успехе — «План … открыт», «Файл … передан браузеру»,
   * допущения импорта и поля вне формата — само уходит через
   * `NOTICE_LIFETIME_MS` после появления. Отсчёт заводится заново на каждое
   * новое сообщение (`notice` и списки в зависимостях), поэтому вторая подряд
   * выгрузка не гасит полосу по таймеру первой.
   *
   * Ошибка по времени не уходит: у файловой ошибки есть свой крестик и она
   * снимается следующей правкой плана (D-274), а ошибка записи черновика
   * держится, пока запись не удалась — гасить её молча значит соврать, что
   * работа сохраняется.
   */
  useEffect(() => {
    if (state.status !== 'done') return;
    if (notice === null && dropped.length === 0 && assumptions.length === 0) return;
    const timer = window.setTimeout(() => {
      setState({ status: 'idle' });
      setNotice(null);
      setDropped([]);
      setAssumptions([]);
    }, NOTICE_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [state, notice, dropped, assumptions]);

  // Полоса сообщений существует, только когда в ней что-то есть (D-288).
  const hasMessages =
    state.status === 'loading' ||
    state.status === 'error' ||
    (state.status === 'done' && notice !== null) ||
    draftError !== null ||
    dropped.length > 0 ||
    assumptions.length > 0;

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
          setDropped([]);
          setNotice(null);
          setErrorDetails([]);
          setState({ status: 'idle' });
        }}
      >
        Создать новый
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
        Открыть существующий
      </button>

      <div className="files__export">
        <button
          ref={exportTrigger}
          type="button"
          className="files__button is-primary"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Скачать план: файл JSON или картинку"
          onClick={() => {
            menuStart.current = 'first';
            setMenuOpen((open) => !open);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            menuStart.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setMenuOpen(true);
          }}
        >
          Экспорт
        </button>

        {!menuOpen ? null : (
          <div
            ref={exportMenu}
            className="files__menu"
            role="menu"
            aria-label="Экспорт"
            onKeyDown={onMenuKeyDown}
          >
            {exportItems.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="files__menu-item"
                title={item.hint}
                data-testid={`export-${item.key}`}
                onClick={() => {
                  closeMenu(true);
                  if (item.key === 'json') save();
                  else if (item.key === 'png') exportPng();
                  else exportSvg();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

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

    </div>

    {/* D-288: полоса под шапкой существует, только когда ей есть что сказать.
        Постоянная строка «черновик в браузере: …» висела над планом у всех и
        всегда; теперь пустая полоса не занимает ряд, а сообщение о загрузке,
        результате или отказе по-прежнему приходит сюда. */}
    {!hasMessages ? null : (
    <div className="files__messages">
      {state.status === 'loading' ? (
        <span className="files__status" data-testid="files-loading">
          {busy}
        </span>
      ) : null}

      {draftError === null ? null : (
        <span className="files__status is-dirty" data-testid="draft-error">
          {draftError}
        </span>
      )}

      {state.status === 'done' && notice !== null ? (
        <span className="files__status is-closable" data-testid="files-notice">
          <span className="files__notice-text">{notice}</span>
          {/* D-292: the success line can be closed by hand, like the file error. */}
          <button
            type="button"
            className="files__error-close"
            aria-label="Скрыть сообщение"
            title="Скрыть сообщение"
            onClick={() => setNotice(null)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      ) : null}

      {dropped.length === 0 ? null : (
        <details className="files__status" data-testid="dropped-fields">
          <summary>Поля вне формата ({dropped.length}) — при сохранении не запишутся</summary>
          <ul>
            {dropped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="panel__note">Своё поле лучше положить в «extensions»: этот блок файл переносит целиком.</p>
        </details>
      )}

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
        <>
          <p className="files__error" role="alert">
            <span className="files__error-text">{state.message}</span>
            <button
              type="button"
              className="files__error-close"
              aria-label="Скрыть сообщение"
              title="Скрыть сообщение"
              onClick={dismissError}
            >
              <span aria-hidden="true">×</span>
            </button>
          </p>
          {errorDetails.length === 0 ? null : (
            <details className="files__error-details" data-testid="file-error-details">
              <summary>Технические сведения ({errorDetails.length})</summary>
              <ul>
                {errorDetails.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </details>
          )}
        </>
      ) : null}
    </div>
    )}

    {offered === null ? null : (
      <FileDialog
        title="Черновик в браузере"
        describedBy="draft-offer-body"
        testId="draft-restore"
        onClose={later}
        actions={
          <>
            <button
              type="button"
              className="files__button is-primary"
              onClick={() => restore(offered)}
            >
              Восстановить
            </button>
            <button type="button" className="files__button" onClick={dismiss}>
              Удалить черновик
            </button>
            <button type="button" className="files__button" onClick={later}>
              Не сейчас
            </button>
          </>
        }
      >
        <p>
          В этом браузере остался черновик «{offered.name}» от {atTime(offered.savedAt)} — работа,
          которую не успели сохранить файлом.
          {draftAt === null ? '' : ' Текущая работа уже пишется в браузер поверх него.'}
        </p>
        <p className="panel__note">
          «Восстановить» заменит открытый сейчас план. «Не сейчас» оставит черновик на месте: он
          предложится снова, пока вы не начнёте править этот план.
        </p>
      </FileDialog>
    )}

    {blocking === null ? null : (
      <FileDialog
        title="План нарушает физику"
        describedBy="physics-block-body"
        testId="save-blocked"
        onClose={() => setBlocking(null)}
        actions={
          <>
            <button
              type="button"
              className="files__button is-primary"
              onClick={() => setBlocking(null)}
            >
              Вернуться и исправить
            </button>
            <button
              type="button"
              className="files__button"
              data-testid="save-anyway"
              onClick={() => {
                setBlocking(null);
                save(true);
              }}
            >
              Сохранить всё равно
            </button>
          </>
        }
      >
        <p>
          Файл не сохранён: в плане {blocking.length}{NBSP}
          {blocking.length === 1 ? 'нарушение' : 'нарушения и больше'} правил физики — такого
          отделения не бывает в натуре.
        </p>
        <ul className="file-dialog__list">
          {blocking.slice(0, PHYSICS_SHOWN).map((entry, index) => (
            <li key={`${entry.code}-${index}`}>{entry.message}</li>
          ))}
        </ul>
        {blocking.length <= PHYSICS_SHOWN ? null : (
          <p className="panel__note">
            И ещё {blocking.length - PHYSICS_SHOWN}: весь список — во вкладке «Проверка».
          </p>
        )}
        <p className="panel__note">
          Правила физики — допущение команды, а не норматив Почты. Сохранить с нарушениями всё
          же можно: файл откроется и покажет их в проверке.
        </p>
      </FileDialog>
    )}
    </>
  );
}
