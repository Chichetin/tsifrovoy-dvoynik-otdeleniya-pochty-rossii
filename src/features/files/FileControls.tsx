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
 * it does not decide. A saved plan, or a file just opened, is clean and is
 * replaced without asking (#141).
 *
 * The draft offer blocks writing only until the user does something with the
 * document — starts a new plan, opens a file, or makes the first edit. From
 * that moment the draft is written again, or a whole session of work would be
 * lost to a closed tab because a question stayed on screen unanswered.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { addVersion, readVersions, removeVersion, type PlanVersion } from '../../persistence/plan-versions';
import { physicsIssues } from '../../domain/physics';
import { validatePlan } from '../../domain/validation';
import { NBSP } from '../../domain/number-format';
import type { OpenedPlan } from '../../persistence/format';
import { pngFileName, renderPlanPng } from '../../persistence/plan-png';
import { planFileName, renderPlanSvg, svgFileName } from '../../persistence/plan-svg';
import {
  inventoryCsv,
  inventoryCsvFileName,
  inventoryCsvRows,
  loadColumnChoice,
  visibleAttributeColumns,
} from '../../persistence/inventory-csv';
import { limitRefusal } from './limit-message';
import { FileDialog } from './FileDialog';
import { PrintDialog } from './PrintDialog';
import { DEMO_PLANS, readDemoText, type DemoPlan } from './demo-plan';

export type FileControlsProps = {
  document: PlanDocument;
  dirty: boolean;
  /** A fresh, untouched plan starts at revision 0 even though it is not exported. */
  revision: number;
  /** The start sample, with nothing edited since the app opened: replacing it loses no work. */
  untouchedSample?: boolean;
  /** Reads a file of either supported format; see `persistence/format.ts`. */
  read: (text: string) => Result<OpenedPlan>;
  encode: (plan: PlanDocument) => Result<string>;
  /** `origin` отличает файл от восстановленного черновика: черновик не сохранён. */
  onReplace: (plan: PlanDocument, origin: DocumentOrigin) => void;
  onNew: () => void;
  /** Separate command: redraw the department boundary, not an internal room. */
  onEditBoundary?: () => void;
  /** Told the revision that has just been written out, for the dirty flag. */
  onExported: () => void;
  /** Opens the validation tab; the save-blocked dialog points there instead of listing findings. */
  onShowValidation?: () => void;
  /**
   * Where the draft lives. `undefined` means the browser's localStorage;
   * `null` switches the draft off, which is what a stand or a test wants.
   */
  storage?: DraftStorage | null;
  /** App bridges the first-run tour to the same file-opening controller. */
  demoRequest?: { id: number; variant: DemoPlan } | null;
  /**
   * #38: variants А and Б of one redesign. `null` — one plan. Each variant is
   * saved as its own ordinary plan file, with the variant in the file name.
   */
  variants?: { active: 'А' | 'Б'; otherDirty: boolean } | null;
  onKeepVariant?: () => void;
  onSwitchVariant?: () => void;
};

/**
 * D-291: сколько живёт полоса сообщений о файле. Раньше она висела над планом
 * постоянно — менялась только надпись. Успешное сообщение само уходит через
 * этот срок; ошибка не уходит по времени никогда (см. `useEffect` ниже).
 */
const NOTICE_LIFETIME_MS = 7_000;

const RESTORE_WARNING =
  'План уже изменён с момента открытия страницы. Восстановить черновик и потерять эти правки?';

const ORGANIZER_NOTE =
  'План импортирован из формата организаторов (example_plan.json). ' +
  'Кнопка «Сохранить план» запишет его уже в формате редактора.';

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

function needsReplacementWarning(plan: PlanDocument, dirty: boolean, revision: number, untouchedSample: boolean): boolean {
  // The sample the app opens with, still untouched, is nobody's work: the first
  // «Открыть демо» of the tour must not ask whether to lose it.
  if (untouchedSample) return false;
  // A restored draft or a new plan is dirty from the start; a saved one is not.
  return dirty && (hasContent(plan) || revision > 0);
}

function replacementWarning(action: 'Новый' | 'Открыть', dirty: boolean): string {
  const consequence = dirty ? 'Несохранённые правки будут потеряны.' : 'Текущий план будет заменён.';
  return `${consequence} ${action === 'Новый' ? 'Создать новый план?' : 'Открыть другой файл?'}`;
}

function fileName(plan: PlanDocument, variant: 'А' | 'Б' | null): string {
  const name = planFileName(plan, 'json');
  return variant === null ? name : name.replace(/\.json$/, `-вариант-${variant}.json`);
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

/** Версия живёт дольше дня: время без даты её не отличит. */
function atDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'неизвестного времени';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

/** Отдаёт готовый файл браузеру: одна ссылка на все пункты «Экспорта». */
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
  dirty: activeDirty,
  revision,
  untouchedSample = false,
  read,
  encode,
  onReplace,
  onNew,
  onEditBoundary,
  onExported,
  onShowValidation,
  storage: given,
  demoRequest = null,
  variants = null,
  onKeepVariant,
  onSwitchVariant,
}: FileControlsProps): React.JSX.Element {
  // Replacing the plan drops both variants: unsaved edits of either one count.
  const dirty = activeDirty || variants?.otherDirty === true;
  const variant = variants?.active ?? null;
  const input = useRef<HTMLInputElement>(null);
  const openSequence = useRef(0);
  const activeDemoFetch = useRef<AbortController | null>(null);
  const seenDemoRequest = useRef<number | null>(null);
  /** Bumped by every export: a late PNG must not overwrite a later export's result. */
  const exportSequence = useRef(0);
  const currentDocument = useRef({ plan, revision });
  useLayoutEffect(() => {
    currentDocument.current = { plan, revision };
  }, [plan, revision]);
  useEffect(() => () => { openSequence.current += 1; activeDemoFetch.current?.abort(); }, []);
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
  const fileTrigger = useRef<HTMLButtonElement>(null);
  const fileMenu = useRef<HTMLDivElement>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  // #138: значения атрибутов вне границ типа — план открыт, число исправляют в «Свойствах».
  const [warnings, setWarnings] = useState<string[]>([]);
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
  /** #110: окно версий; список читается из хранилища при каждом открытии. */
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [versionLabel, setVersionLabel] = useState('');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

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
    // Правка за 700 мс до закрытия вкладки не должна пропасть.
    const flushNow = (): void => created.flush();
    const onHide = (): void => {
      if (window.document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    window.document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      window.document.removeEventListener('visibilitychange', onHide);
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

  const accept = useCallback((opened: OpenedPlan, origin: DocumentOrigin): void => {
    openSequence.current += 1;
    // Документ заменён целиком — вопрос о черновике отвечен самим действием.
    setOffered(null);
    setAnswered(true);
    onReplace(opened.plan, origin);
    setAssumptions(opened.format === 'organizer' ? opened.assumptions : []);
    setDropped(opened.dropped);
    setWarnings(opened.warnings);
    setNotice(
      opened.format === 'organizer' ? ORGANIZER_NOTE : `План «${opened.plan.name}» открыт.`,
    );
    setErrorDetails([]);
    setState({ status: 'done' });
  }, [onReplace]);

  const showIssueError = useCallback((message: string, issues: Issue[]): void => {
    setErrorDetails(technicalDetails(issues));
    setState({ status: 'error', message });
  }, []);

  const openSource = useCallback(async (load: () => Promise<string>, demo = false): Promise<void> => {
    activeDemoFetch.current?.abort();
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
    setBusy(demo ? 'загружаем демо-план…' : 'читаем файл…');
    setState({ status: 'loading' });
    setNotice(null);
    setErrorDetails([]);
    let text: string;
    try {
      text = await load();
    } catch (error) {
      if (!stillCurrent()) return;
      setState({
        status: 'error',
        message: `${demo ? 'Демо-план не открыт' : 'Файл не прочитался'}: ${error instanceof Error ? error.message : String(error)}`,
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
      showIssueError(
        limitRefusal(text, opened.issues) ?? 'План не открыт: файл не соответствует поддерживаемому формату.',
        opened.issues,
      );
      return;
    }
    accept(opened.value, 'file');
  }, [plan, revision, read, accept, showIssueError]);

  const open = (file: File): Promise<void> => openSource(() => file.text());

  // #37: a plan file dropped anywhere on the window opens like «Открыть
  // существующий»: the same warning before a plan with content is replaced and
  // the same refusal that leaves the open plan untouched. Only files count —
  // a library type dragged onto the canvas carries text, not files.
  const [dropActive, setDropActive] = useState(false);
  const onDropFile = useRef<((file: File) => void) | null>(null);
  useLayoutEffect(() => {
    onDropFile.current = (file: File): void => {
      if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
        setErrorDetails([]);
        setState({ status: 'error', message: `Файл «${file.name}» не открыт: нужен план в формате JSON.` });
        return;
      }
      if (needsReplacementWarning(plan, dirty, revision, untouchedSample) &&
          !window.confirm(replacementWarning('Открыть', dirty))) return;
      void open(file);
    };
  });
  useEffect(() => {
    const withFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true;
    const enter = (event: DragEvent): void => {
      if (!withFiles(event)) return;
      event.preventDefault();
      setDropActive(true);
    };
    const over = (event: DragEvent): void => {
      if (!withFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    };
    // Leaving the window has no target to move to; moving between elements does.
    const leave = (event: DragEvent): void => {
      if (withFiles(event) && event.relatedTarget === null) setDropActive(false);
    };
    const drop = (event: DragEvent): void => {
      if (!withFiles(event)) return;
      event.preventDefault();
      setDropActive(false);
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) onDropFile.current?.(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  const openDemo = useCallback((variant: DemoPlan): void => {
    setMenuOpen(false);
    fileTrigger.current?.focus();
    if (needsReplacementWarning(plan, dirty, revision, untouchedSample) &&
        !window.confirm(replacementWarning('Открыть', dirty))) return;
    void openSource(() => {
      const controller = new AbortController();
      activeDemoFetch.current = controller;
      return readDemoText(variant, { signal: controller.signal });
    }, true);
  }, [plan, dirty, revision, untouchedSample, openSource]);

  useEffect(() => {
    if (demoRequest === null || demoRequest.id === seenDemoRequest.current) return;
    seenDemoRequest.current = demoRequest.id;
    openDemo(demoRequest.variant);
  }, [demoRequest, openDemo]);

  const restore = (draft: PlanDraft): void => {
    // Спрашиваем, когда в плане уже что-то есть: только что открытый файл по
    // `dirty` чист, но это работа пользователя. И когда план тронут с момента
    // открытия страницы: зон и объектов может не быть, а контур, стены и
    // название уже правились. Нетронутый пустой план терять нечего.
    const current = fingerprint(encode, plan);
    const touched = current === null || current !== start.opening;
    // The start sample, nothing edited since the page opened, is nobody's work.
    const losesWork = touched || (hasContent(plan) && !untouchedSample);
    if (losesWork && !window.confirm(RESTORE_WARNING)) return;
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
      const violations = physicsIssues(validatePlan(plan));
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

    handToBrowser(new Blob([encoded.value], { type: 'application/json' }), fileName(plan, variant));
    // The file now holds this plan: the browser draft, kept against a closed tab,
    // would offer it back as «not saved» after the next reload. The first edit
    // after the save writes a new draft.
    writer.current?.cancel();
    if (storage !== null) clearDraft(storage);
    setDraftAt(null);
    onExported();
    setErrorDetails([]);
    setNotice(`Файл ${fileName(plan, variant)} передан браузеру на скачивание.`);
    setState({ status: 'done' });
  };

  // Ctrl+S saves the plan file instead of the browser's «save page» (#6).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== 'KeyS' && event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Картинка плана для согласования — SVG из того же документа (D-061). Это
   * не сохранение: план после выгрузки остаётся таким же «несохранённым»,
   * каким был, и черновик не трогается.
   */
  const exportSvg = (): void => {
    exportSequence.current += 1;
    handToBrowser(new Blob([renderPlanSvg(plan, { overlays: true })], { type: 'image/svg+xml' }), svgFileName(plan));
    // Own result state, like «Сохранить»: otherwise a stale «План не открыт…»
    // would stay on screen next to a file that downloaded fine.
    setErrorDetails([]);
    setNotice(`Картинка ${svgFileName(plan)} передана браузеру на скачивание.`);
    setState({ status: 'done' });
  };

  /**
   * CSV — весь перечень инвентаризации со столбцами атрибутов, которые выбраны
   * в «Инвентаризации». Фильтр панели сюда не входит: пункт меню выгружает план.
   */
  const exportCsv = (): void => {
    exportSequence.current += 1;
    const name = inventoryCsvFileName(plan);
    const placed = [...new Set(plan.objects.map((object) => object.typeId))];
    const columns = visibleAttributeColumns(plan.catalog, placed, loadColumnChoice());
    handToBrowser(
      new Blob([inventoryCsv(inventoryCsvRows(plan), columns)], { type: 'text/csv;charset=utf-8' }),
      name,
    );
    setErrorDetails([]);
    setNotice(`Перечень ${name} передан браузеру на скачивание: строк ${plan.objects.length}.`);
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
   * Пункты «Экспорта» в одном списке: план файлом, две картинки и перечень. JSON здесь
   * дублирует кнопку «Сохранить план» (#6): по этому пункту ведёт инструкция
   * в ZIP сдачи (demo/README.md).
   */
  const exportItems: { key: 'json' | 'png' | 'svg' | 'csv' | 'print'; label: string; hint: string }[] = [
    {
      key: 'json',
      label: 'JSON — файл плана',
      hint: 'Сохранить план файлом .json: зоны, оборудование, идентификаторы и атрибуты',
    },
    {
      key: 'png',
      label: 'PNG — картинка',
      hint: 'Растровая картинка для презентации и переписки. В неё входят зоны, стены, оборудование, подписи и информационные слои, которые включены, с легендой и маркеры находок проверки',
    },
    {
      key: 'svg',
      label: 'SVG — векторная картинка',
      hint: 'Векторная картинка для согласования и печати. В неё входят зоны, стены, оборудование, подписи и информационные слои, которые включены, с легендой и маркеры находок проверки',
    },
    {
      key: 'csv',
      label: 'CSV — перечень инвентаризации',
      hint: 'Таблица для Excel: все объекты плана и выбранные в «Инвентаризации» столбцы атрибутов',
    },
    {
      key: 'print',
      label: 'Печать…',
      hint: 'Печать плана на A4 или A3 в масштабе 1:50, 1:100 или по листу: с легендой, линейкой и штампом. Печатаются включённые слои',
    },
  ];

  const closeMenu = (returnFocus: boolean): void => {
    setMenuOpen(false);
    if (returnFocus) fileTrigger.current?.focus();
  };

  /** Открытое меню забирает фокус на первый пункт: дальше — стрелками. */
  useEffect(() => {
    if (!menuOpen) return;
    const items = fileMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[menuStart.current === 'last' ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (fileMenu.current?.contains(target ?? null) === true) return;
      if (fileTrigger.current?.contains(target ?? null) === true) return;
      setMenuOpen(false);
    };
    window.document.addEventListener('pointerdown', outside);
    return () => window.document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      fileMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
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
    if (notice === null && dropped.length === 0 && assumptions.length === 0 && warnings.length === 0) return;
    const timer = window.setTimeout(() => {
      setState({ status: 'idle' });
      setNotice(null);
      setDropped([]);
      setAssumptions([]);
      setWarnings([]);
    }, NOTICE_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [state, notice, dropped, assumptions, warnings]);

  const newPlan = (): void => {
    closeMenu(false);
    if (needsReplacementWarning(plan, dirty, revision, untouchedSample) &&
        !window.confirm(replacementWarning('Новый', dirty))) return;
    openSequence.current += 1;
    activeDemoFetch.current?.abort();
    onNew();
    if (storage !== null) clearDraft(storage);
    // Чистый лист — тоже ответ на предложение: черновика больше нет.
    setOffered(null);
    setAnswered(true);
    setDraftAt(null);
    setAssumptions([]);
    setDropped([]);
    setWarnings([]);
    setNotice(null);
    setErrorDetails([]);
    setState({ status: 'idle' });
  };

  const openExisting = (): void => {
    closeMenu(false);
    if (needsReplacementWarning(plan, dirty, revision, untouchedSample) &&
        !window.confirm(replacementWarning('Открыть', dirty))) return;
    openSequence.current += 1;
    activeDemoFetch.current?.abort();
    setState({ status: 'idle' });
    input.current?.click();
  };

  const openVersions = (): void => {
    closeMenu(false);
    setVersionLabel('');
    setVersionError(storage === null ? 'Хранилище браузера недоступно: версии не сохраняются.' : null);
    setVersions(storage === null ? [] : readVersions(storage));
  };

  const closeVersions = (): void => {
    setVersions(null);
    fileTrigger.current?.focus();
  };

  /** Версия — тот же текст, что файл плана: план с ошибкой данных не запишется. */
  const saveVersion = (): void => {
    if (storage === null) return;
    const encoded = encode(plan);
    if (!encoded.ok) {
      setVersionError('Версия не сохранена: сначала исправьте ошибки в данных плана.');
      return;
    }
    const added = addVersion(storage, { label: versionLabel, name: plan.name, text: encoded.value }, Date.now());
    if (!added.ok) {
      setVersionError(added.issues.map((issue) => issue.message).join('; '));
      return;
    }
    setVersions(added.value);
    setVersionLabel('');
    setVersionError(null);
  };

  /**
   * Открыть версию — заменить план, как при открытии файла: история отмены
   * начинается заново (plan-store). Поэтому сначала тот же вопрос, что и для
   * файла. План из версии не выгружен файлом — он открывается несохранённым.
   */
  const openVersion = (version: PlanVersion): void => {
    if (needsReplacementWarning(plan, dirty, revision, untouchedSample) &&
        !window.confirm(`${dirty ? 'Несохранённые правки будут потеряны.' : 'Текущий план будет заменён.'} Открыть версию «${version.label}»?`)) return;
    const opened = read(version.text);
    if (!opened.ok) {
      setVersionError(`Версия «${version.label}» не открылась, текущий план не изменён.`);
      return;
    }
    setVersions(null);
    accept(opened.value, 'draft');
    setNotice(`Открыта версия «${version.label}» от ${atDateTime(version.savedAt)}.`);
  };

  const deleteVersion = (version: PlanVersion): void => {
    if (storage === null || !window.confirm(`Удалить версию «${version.label}»?`)) return;
    const removed = removeVersion(storage, version.id);
    if (!removed.ok) {
      setVersionError(removed.issues.map((issue) => issue.message).join('; '));
      return;
    }
    setVersions(removed.value);
  };

  // Полоса сообщений существует, только когда в ней что-то есть (D-288).
  const hasMessages =
    state.status === 'loading' ||
    state.status === 'error' ||
    (state.status === 'done' && notice !== null) ||
    draftError !== null ||
    dropped.length > 0 ||
    warnings.length > 0 ||
    assumptions.length > 0;

  return (
    <>
    <div className="files" role="group" aria-label="Файл плана">
      <div className="files__export">
        <button
          ref={fileTrigger}
          type="button"
          className="files__button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Создать, открыть, демо-планы, версии и экспорт"
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
          Файл
        </button>

        {!menuOpen ? null : (
          <div
            ref={fileMenu}
            className="files__menu"
            role="menu"
            aria-label="Файл"
            onKeyDown={onMenuKeyDown}
          >
            <button type="button" role="menuitem" className="files__menu-item" onClick={newPlan}>
              Создать новый
            </button>
            <button type="button" role="menuitem" className="files__menu-item" onClick={openExisting}>
              Открыть существующий
            </button>
            {onEditBoundary === undefined ? null : (
              <button type="button" role="menuitem" className="files__menu-item" onClick={() => {
                closeMenu(true);
                onEditBoundary();
              }}>
                Изменить внешний контур отделения…
              </button>
            )}
            <div role="group" aria-labelledby="files-menu-demo">
              <span id="files-menu-demo" className="files__menu-caption">Демо-планы</span>
              {DEMO_PLANS.map((item) => (
                <button key={item.id} type="button" role="menuitem" className="files__menu-item" onClick={() => openDemo(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="menuitem"
              className="files__menu-item"
              title="Сохранить состояние плана с названием и открыть его позже — в этом браузере"
              data-testid="plan-versions"
              onClick={openVersions}
            >
              Версии плана…
            </button>
            {onKeepVariant === undefined || variants !== null ? null : (
              <button
                type="button"
                role="menuitem"
                className="files__menu-item"
                title="Текущий план станет вариантом А, дальше правки идут в вариант Б. Каждый вариант сохраняется своим файлом."
                data-testid="keep-variant"
                onClick={() => {
                  closeMenu(true);
                  onKeepVariant();
                }}
              >
                Запомнить как вариант
              </button>
            )}
            <div role="group" aria-labelledby="files-menu-export">
              <span id="files-menu-export" className="files__menu-caption">Экспорт</span>
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
                    else if (item.key === 'csv') exportCsv();
                    else if (item.key === 'print') setPrintOpen(true);
                    else exportSvg();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="files__button is-primary"
        data-testid="save-plan"
        aria-label="Сохранить план"
        aria-keyshortcuts="Control+S"
        title="Скачать план файлом .json: зоны, оборудование, идентификаторы и атрибуты (Ctrl+S)"
        onClick={() => {
          setMenuOpen(false);
          save();
        }}
      >
        Сохранить
      </button>

      {onSwitchVariant === undefined || variants === null ? null : (
        <div style={{ display: 'contents' }} role="group" aria-label="Вариант перепланировки">
          {(['А', 'Б'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={`files__button${name === variants.active ? ' is-primary' : ''}`}
              aria-pressed={name === variants.active}
              data-testid={`variant-${name}`}
              title={name === variants.active
                ? `Открыт вариант ${name}. «Сохранить» запишет его в свой файл.`
                : `Открыть вариант ${name}${variants.otherDirty ? ' (есть несохранённые правки)' : ''}`}
              onClick={() => {
                if (name !== variants.active) onSwitchVariant();
              }}
            >
              Вариант {name}{name !== variants.active && variants.otherDirty ? ' •' : ''}
            </button>
          ))}
        </div>
      )}

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
    {dropActive ? (
      <div className="files__drop" data-testid="drop-overlay" role="status">
        Отпустите, чтобы открыть план
      </div>
    ) : null}
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
        <span className="files__status" data-testid="files-notice">
          {notice}
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

      {warnings.length === 0 ? null : (
        <details className="files__status" data-testid="attribute-warnings">
          <summary>Значения вне границ или не даты ({warnings.length}) — исправьте в «Свойствах»</summary>
          <ul>
            {warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      {assumptions.length === 0 ? null : (
        <details className="files__status" data-testid="organizer-assumptions">
          <summary>Параметры импорта ({assumptions.length})</summary>
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

    {printOpen ? (
      <PrintDialog
        plan={plan}
        onClose={() => {
          setPrintOpen(false);
          fileTrigger.current?.focus();
        }}
      />
    ) : null}

    {versions === null ? null : (
      <FileDialog
        title="Версии плана"
        describedBy="plan-versions-body"
        testId="plan-versions-dialog"
        onClose={closeVersions}
        actions={
          <button type="button" className="files__button" onClick={closeVersions}>
            Закрыть
          </button>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveVersion();
          }}
        >
          <label>
            Название версии{' '}
            <input
              type="text"
              value={versionLabel}
              maxLength={80}
              placeholder="например, до перепланировки"
              disabled={storage === null}
              onChange={(event) => setVersionLabel(event.target.value)}
            />
          </label>{' '}
          <button type="submit" className="files__button is-primary" disabled={storage === null}>
            Сохранить версию
          </button>
        </form>
        {versionError === null ? null : <p className="files__error" role="alert">{versionError}</p>}
        {versions.length === 0 ? (
          <p className="panel__note">Версий пока нет.</p>
        ) : (
          <ul className="file-dialog__list" data-testid="plan-versions-list">
            {versions.map((version) => (
              <li key={version.id}>
                «{version.label}» — {version.name}, {atDateTime(version.savedAt)}{' '}
                <button type="button" className="files__button" onClick={() => openVersion(version)}>
                  Открыть
                </button>{' '}
                <button type="button" className="files__button" onClick={() => deleteVersion(version)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="panel__note">
          Версии хранятся в этом браузере, не в файле. Файл плана сохраняет кнопка «Сохранить».
        </p>
      </FileDialog>
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
              onClick={() => {
                setBlocking(null);
                onShowValidation?.();
              }}
            >
              Показать в «Проверке»
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
          В плане {blocking.length}{NBSP}
          {blocking.length === 1 ? 'нарушение' : 'нарушений'} физики. Сохранить всё равно?
        </p>
      </FileDialog>
    )}
    </>
  );
}
