/**
 * U01: the one place where the editor is assembled.
 *
 * Panels are independent modules that know nothing about each other; this file
 * holds the session (tool, viewport, selection, preview) and routes every
 * command into the single store. Derived data — inventory, issues — is
 * recomputed from the document, never stored beside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AdviceRequest, AdviceResponse, Candidate } from '../contracts/advice';
import type { Command, DocumentOrigin } from '../contracts/commands';
import type { Id, PlanDocument, Ref, Result, Viewport } from '../contracts/model';
import type { AssistantPanelRequest, EditorSession, RequestState, Tool } from '../contracts/ui';
import { buildInventory } from '../domain/inventory';
import { measurePlan } from '../domain/metrics';
import { formatArea } from '../domain/number-format';
import { planIndex } from '../domain/plan-index';
import { validatePlan } from '../domain/validation';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { AssistantLauncher } from '../features/assistant/AssistantLauncher';
import { requestAdvice } from '../features/assistant/advice-client';
import { EditorCanvas } from '../features/editor/EditorCanvas';
import { historyHotkey } from '../features/editor/hotkeys';
import { EquipmentLayer } from '../features/equipment/EquipmentLayer';
import { findPlacementPick } from '../features/equipment/placement-pick';
import { useEquipmentToolController } from '../features/equipment/use-equipment-tool-controller';
import { FileControls } from '../features/files/FileControls';
import { CatalogPanel } from '../features/catalog-editor/CatalogPanel';
import { InventoryPanel } from '../features/inventory/InventoryPanel';
import { InformationLayer } from '../features/layers/InformationLayer';
import { LayersPanel } from '../features/layers/LayersPanel';
import { MetricsPanel } from '../features/inventory/MetricsPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { Onboarding } from '../features/onboarding/Onboarding';
import { browserStorage as tourStorage, rememberTour, shouldShowTour, type TourOutcome } from '../features/onboarding/tour';
import { PlanGeometryLayer } from '../features/plan-tools/PlanGeometryLayer';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';
import { PlanTools } from '../features/plan-tools/PlanTools';
import { ZoneNameLayer } from '../features/plan-tools/ZoneNameLayer';
import { usePlanToolController } from '../features/plan-tools/use-plan-tool-controller';
import { IssueLayer } from '../features/validation/IssueLayer';
import { ValidationPanel } from '../features/validation/ValidationPanel';
import { View3D } from '../features/view3d/View3D';
import { encodePlan } from '../persistence/codec';
import { readPlanFile } from '../persistence/format';
import { ORGANIZER_CATALOG_VERSION, withTeamCatalog } from '../persistence/organizer-import';
import { createPlanStore } from '../state/plan-store';
import { catalog, createEmptyPlan } from './default-plan';
import { createObjectGesturePreviewChannel } from './gesture-preview';
import {
  browserStorage as rightColumnStorage,
  expandSection,
  loadSectionState,
  pluralRu,
  saveSectionState,
  toggleSection,
  type SectionId,
  type SectionState,
} from './right-column';
import { Section } from './Section';
import { HotkeysMapDialog } from './HotkeysMapDialog';
import { useHotkeysMapDialog } from './hotkeys-map';
import './styles.css';

const START_VIEWPORT: Viewport = { origin: [0, 0], scale: 48 };

export function App(): React.JSX.Element {
  const [store, setStore] = useState(() => createPlanStore(createEmptyPlan(), 'new'));
  const [gesturePreview] = useState(createObjectGesturePreviewChannel);
  const document = useStore(store, (state) => state.document);
  const baseline = useStore(store, (state) => state.baseline);
  const revision = useStore(store, (state) => state.revision);
  const selection = useStore(store, (state) => state.selection);
  const dirty = useStore(store, (state) => state.dirty);

  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  // 3D is an overlay over the same document; the 2D canvas stays mounted below it.
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const [lastError, setLastError] = useState<string | null>(null);
  const focusSequence = useRef(0);
  // First-run tour: whether it was seen is a fact about this browser, kept in
  // localStorage and never in the plan (D-194).
  const [tourOpen, setTourOpen] = useState(() => shouldShowTour(tourStorage()));
  const closeTour = useCallback((outcome: TourOutcome) => {
    rememberTour(tourStorage(), outcome);
    setTourOpen(false);
  }, []);
  // UX-3: карта горячих клавиш по «?» — открытие, закрытие и возврат фокуса
  // живут в самом хуке (hotkeys-map.ts), здесь только кнопка и накладка.
  const hotkeysMap = useHotkeysMapDialog();

  // Ctrl+Z / Ctrl+Y — те же undo/redo, что и кнопки в шапке: история живёт в
  // store, поэтому слушатель один, здесь, а не в каждом слое холста.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = historyHotkey(event);
      if (action === null) return;
      event.preventDefault();
      store.getState()[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
  const [focus, setFocus] = useState<EditorSession['focus']>(null);
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  // A response belongs to the latest request, not merely to a plan revision.
  // A new plan starts at revision 0 too, so comparing revisions cannot reject
  // a late answer from the document that was open before «Новый».
  const adviceRequestSequence = useRef(0);
  /**
   * Сколько раз документ заменяли целиком. Холст помнит, какой документ он уже
   * вписал, по `id` и имени, а два файла могут нести одну личность:
   * `demo/before.json` и `demo/after.json` именно такие — второй это тот же
   * план после рекомендации. Жюри открывает их подряд, поэтому «документ
   * заменили» решается по самому действию, а не по содержимому файла: смена
   * этого числа пересоздаёт холст, и вид считается заново.
   */
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [adviceState, setAdviceState] = useState<RequestState>({ status: 'idle' });

  // UI-2Б: which right-column sections are collapsed — a fact about this
  // browser, kept in localStorage exactly like the tour (D-217), never in the
  // plan. Every section is open on the first visit.
  const [sections, setSections] = useState(() => loadSectionState(rightColumnStorage()));
  // UI-2В: the value `sections` starts with is just what `loadSectionState`
  // returned — writing it straight back would put a `{}` key in localStorage
  // before the person ever touched a header (D-226). A "have we run before"
  // ref flag looked like the fix, but `StrictMode` (`src/main.tsx`) invokes
  // this effect twice on mount without resetting refs in between, so the
  // second invocation saw the flag already set and wrote anyway. Comparing
  // `sections` by reference to the exact object the initializer produced
  // sidesteps that: every real toggle (`toggleSection`, `expandSection`,
  // `without`) returns a new object, so identity only holds while nothing
  // has been touched yet, StrictMode's extra pass included.
  const initialSections = useRef(sections);
  useEffect(() => {
    if (sections === initialSections.current) return;
    saveSectionState(rightColumnStorage(), sections);
  }, [sections]);
  /**
   * D-236: «Свойства» следуют за выбором — раскрыты, когда есть что показать,
   * и свёрнуты, когда выбора нет: пустая карточка «ничего не выбрано» не
   * занимает место в колонке. Остальные разделы живут своим состоянием и при
   * выборе не прячутся: поставленный объект сразу выбран (D-147), поэтому
   * скрытый при выборе обзор был бы скрыт почти всегда.
   *
   * Это не состояние, а вывод из выбора: в localStorage не пишется и чужую
   * сохранённую раскладку не затирает.
   */
  const autoCollapsed = (id: SectionId): boolean =>
    id === 'properties' ? selection === null : sections[id] === true;
  /**
   * Разделы, которые человек сам свернул или раскрыл при нынешнем выборе:
   * щелчок по заголовку сильнее автоматики и живёт до смены выбора — иначе
   * заглянуть в «Площади», не бросая выбранный объект, было бы нечем.
   */
  const [manualSections, setManualSections] = useState<SectionState>({});
  const collapsedOf = (id: SectionId): boolean => manualSections[id] ?? autoCollapsed(id);
  const toggleSectionState = useCallback(
    (id: SectionId) => {
      setSections((prev) => toggleSection(prev, id));
      setManualSections((prev) => ({ ...prev, [id]: !collapsedOf(id) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collapsedOf зависит от выбора и читается в момент щелчка
    [selection, sections, manualSections],
  );
  // The launcher is deliberately only an entry point: the right-column panel
  // remains the one place where assistant state and future chat history live.
  // Ручную отметку «свёрнут» с него тоже снимаем: иначе кнопка прокрутит к
  // заголовку, под которым по-прежнему пусто.
  const openAssistant = useCallback(() => {
    setSections((prev) => expandSection(prev, 'assistant'));
    setManualSections((prev) => ({ ...prev, assistant: false }));
    window.requestAnimationFrame(() => {
      globalThis.document.getElementById('right-section-assistant')?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  const retired = useStore(store, (state) => state.retired);
  const selected = useStore(store, (state) => state.selected);
  const session: EditorSession = useMemo(
    () => ({ tool, viewport, selection, selected, preview, focus, retired }),
    [tool, viewport, selection, selected, preview, focus, retired],
  );

  // Смена выбора возвращает колонку к автоматике (D-236): ручные щелчки по
  // заголовкам относились к прошлому выбранному объекту, а не к новому.
  // Раскрывать «Свойства» отдельной командой больше не нужно — при выборе
  // они раскрыты по определению.
  const select = useCallback(
    (ref: Ref | null) => {
      store.getState().select(ref);
      setManualSections({});
    },
    [store],
  );
  const selectMany = useCallback(
    (ids: readonly Id[]) => {
      store.getState().selectMany(ids);
      setManualSections({});
    },
    [store],
  );

  const dispatch = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = store.getState().dispatch(command);
      // A refused command is not a silent no-op: the user has to learn why the
      // thing they just dragged snapped back.
      setLastError(result.ok ? null : result.issues.map((issue) => issue.message).join('; '));
      return result;
    },
    [store],
  );

  // A drawing tool that just created something hands it over selected: the
  // card shows what was drawn, not what was picked a minute ago (operator
  // finding 9). The room is not created, only reshaped, so `room.set` stays
  // out.
  //
  // A `put` from a tool also arrives when an existing entity is dragged or
  // resized, and it selects that entity too: the person has just handled it,
  // so the card follows their hand. Deletions and commands from panels go
  // through plain `dispatch` and leave the selection alone.
  const dispatchAndSelect = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatch(command);
      if (!result.ok) return result;
      if (command.type === 'zone.put') select({ kind: 'zone', id: command.zone.id });
      if (command.type === 'object.put') select({ kind: 'object', id: command.object.id });
      if (command.type === 'wall.put') select({ kind: 'wall', id: command.wall.id });
      if (command.type === 'opening.put') select({ kind: 'opening', id: command.opening.id });
      return result;
    },
    [dispatch, select],
  );

  const focusOn = useCallback(
    (ref: Ref) => {
      focusSequence.current += 1;
      setFocus({ ref, sequence: focusSequence.current });
      select(ref);
    },
    [select],
  );

  const planTool = usePlanToolController({ document, session, onCommand: dispatchAndSelect });
  const placedType = useRef<Id | null>(null);
  const dispatchEquipmentCommand = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatchAndSelect(command);
      // Remember an accepted placement until pointer-up. Keeping the placement
      // tool through the matching click prevents that same click from falling
      // through to the room selection layer after React re-renders.
      if (result.ok && tool.kind === 'object.place' && command.type === 'object.put') {
        placedType.current = tool.typeId;
      }
      return result;
    },
    [dispatchAndSelect, tool],
  );
  const equipmentTool = useEquipmentToolController({
    document,
    session,
    onCommand: dispatchEquipmentCommand,
  });

  const inventory = useMemo(() => buildInventory(document), [document]);
  const issues = useMemo(() => validatePlan(document), [document]);
  const metrics = useMemo(() => measurePlan(document), [document]);

  // UI-2В (D-226): `planIndex(document)` only depends on the plan, not on
  // the assistant's own state — building it here keeps `sectionSummaries`
  // below from rebuilding the whole index on every advice request or object
  // pick, the way the other consumers of `planIndex` already memoize it by
  // `[plan]` alone (`EquipmentLayer`, `AssistantPanel`, `ValidationPanel`,
  // `InventoryPanel`).
  const names = useMemo(() => planIndex(document), [document]);

  // UI-2Б: a line for each section's collapsed header, so it stays useful
  // closed. Every number here already exists — `metrics`, `issues` and
  // `inventory` above, `advice` below — this only picks words around it.
  const sectionSummaries = useMemo<Record<SectionId, string>>(() => {
    const properties = selection === null ? 'ничего не выбрано' : (names.nameOf(selection) ?? selection.id);
    const assistant =
      adviceState.status === 'loading'
        ? 'запрос отправлен'
        : adviceState.status === 'error'
          ? 'ошибка запроса'
          : advice === null
            ? 'без рекомендации'
            : `${advice.recommendations.length} ${pluralRu(advice.recommendations.length, 'рекомендация', 'рекомендации', 'рекомендаций')}`;
    const areas = metrics.ok ? formatArea(metrics.value.room.total_m2) : 'ошибка расчёта';
    const found = `${issues.length} ${pluralRu(issues.length, 'находка', 'находки', 'находок')}`;
    const placed = `${inventory.rows.length} ${pluralRu(inventory.rows.length, 'объект', 'объекта', 'объектов')}`;
    const types = document.catalog.objectTypes.length;
    const catalogSummary = `${types} ${pluralRu(types, 'тип', 'типа', 'типов')}`;
    return { properties, assistant, metrics: areas, validation: found, inventory: placed, catalog: catalogSummary };
  }, [selection, names, document, adviceState, advice, metrics, issues, inventory]);

  // UI-2В (D-226, по ревью MR !177): the same test `ValidationPanel` uses for
  // its own red `panel__count` (`issue.severity === 'error'`) — a collapsed
  // «Проверка» section must not read as calm when the plan has real errors,
  // not just team warnings.
  const validationHasErrors = useMemo(() => issues.some((issue) => issue.severity === 'error'), [issues]);

  const askAssistant = useCallback(
    (request: AssistantPanelRequest, query?: string) => {
      const sequence = ++adviceRequestSequence.current;
      setAdviceState({ status: 'loading' });
      // Ответ привязан к ревизии запроса: панель сама скажет, что он устарел,
      // если план успели поправить, пока сервер считал.
      // The panel knows no document history and sends the current plan as
      // "before"; only the app knows the real one.
      const grounded: AdviceRequest =
        request.scenario === 'compare' ? { ...request, before: baseline } : request;
      const asked = { plan: document, revision, request: grounded, ...(query === undefined ? {} : { query }) };
      void requestAdvice(asked).then((result) => {
        // The document may have been replaced, or another request may have
        // started while this one was in flight. In either case this answer no
        // longer owns the panel.
        if (sequence !== adviceRequestSequence.current) return;
        if (!result.ok) {
          setAdvice(null);
          setAdviceState({
            status: 'error',
            message: result.issues.map((issue) => issue.message).join('; '),
          });
          return;
        }
        setAdvice(result.value);
        setAdviceState({ status: 'done' });
      });
    },
    [baseline, document, revision],
  );

  // A recommendation belongs to the plan it was computed for: after «Открыть»
  // or «Новый» its ids point at objects that no longer exist, and «план
  // изменился» is too mild a warning for that — the answer goes away entirely.
  const forgetAdvice = useCallback(() => {
    // Invalidates an in-flight answer before clearing the visible one. Without
    // this, «Новый» briefly clears the panel and the old answer repopulates it.
    adviceRequestSequence.current += 1;
    setAdvice(null);
    setAdviceState({ status: 'idle' });
    setPreview(null);
  }, []);

  const replaceDocument = useCallback(
    (plan: PlanDocument, origin: DocumentOrigin) => {
      // 'file' — план пришёл из файла и считается сохранённым состоянием;
      // 'draft' — восстановленный черновик, он никуда ещё не выгружен.
      // Пример организаторов приходит без наших правил и слоёв: сомкнуть с
      // командным справочником здесь, где он есть, — иначе на примере видны
      // только геометрические ошибки, а «терминал не далее 3 м» молчит.
      const merged =
        plan.catalog.version === ORGANIZER_CATALOG_VERSION ? withTeamCatalog(plan, catalog) : null;
      const document = merged?.ok ? merged.value : plan;
      store.getState().replaceDocument(document, origin);
      // A refused merge is not a silent success: the plan opens as it came,
      // and the user is told the team rules and layers did not apply.
      setLastError(
        merged === null || merged.ok
          ? null
          : `Справочник команды к примеру не применён (план открыт без правил комплектования и информационных слоёв): ${merged.issues
              .map((issue) => issue.message)
              .join('; ')}`,
      );
      // Открыт другой документ: вид считается заново, даже если файл несёт ту
      // же личность, что и прежний.
      setDocumentEpoch((epoch) => epoch + 1);
      forgetAdvice();
    },
    [store, forgetAdvice],
  );

  const startNewPlan = useCallback(() => {
    const fresh = createPlanStore(createEmptyPlan(), 'new');
    setStore(fresh);
    setTool({ kind: 'select' });
    setLastError(null);
    setDocumentEpoch((epoch) => epoch + 1);
    forgetAdvice();
  }, [forgetAdvice]);

  return (
    <div className="shell">
      <header className="shell__bar">
        <h1 className="shell__title">Цифровой двойник ОПС</h1>
        {/* data-tour marks what the first-run tour highlights; display: contents keeps the header layout. */}
        <div className="shell__anchor" data-tour="tools">
          <PlanTools document={document} session={session} onTool={setTool} onCommand={dispatch} />
        </div>
        <div className="shell__view" role="group" aria-label="Вид плана">
          <button type="button" className="files__button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
            2D
          </button>
          <button type="button" className="files__button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            3D
          </button>
        </div>
        <div className="shell__right">
        <div className="shell__history" role="group" aria-label="История правок">
          <button type="button" className="shell__quiet" title="Отменить последнюю правку (Ctrl+Z)" onClick={() => store.getState().undo()}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5 2.5 6.5l3 3" />
              <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-3" />
            </svg>
            <span className="shell__label">Отменить</span>
          </button>
          <button type="button" className="shell__quiet" title="Вернуть отменённую правку (Ctrl+Y или Ctrl+Shift+Z)" onClick={() => store.getState().redo()}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10.5 3.5 3 3-3 3" />
              <path d="M13.5 6.5h-7a4 4 0 0 0 0 8h3" />
            </svg>
            <span className="shell__label">Вернуть</span>
          </button>
        </div>
        {/* D-254: карта клавиш — иконка в шапке, без подписи: текстовая кнопка
            возвращала перенос шапки на вторую строку при 1280 px. */}
        <button
          type="button"
          className="shell__quiet shell__keys"
          title="Горячие клавиши (?)"
          aria-label="Горячие клавиши (?)"
          onClick={hotkeysMap.show}
        >
          <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
            <path d="M4 6h.01M7 6h.01M10 6h.01M12.5 6h.01M4 8.5h.01M6.5 8.5h.01M9 8.5h.01M12 8.5h.01M5 10.8h6" />
          </svg>
        </button>
        </div>
        <div className="shell__anchor" data-tour="files">
        <FileControls
          document={document}
          dirty={dirty}
          revision={revision}
          read={readPlanFile}
          encode={encodePlan}
          onReplace={replaceDocument}
          onNew={startNewPlan}
          onExported={() => {
            store.getState().markExported(revision);
          }}
        />
        </div>
      </header>

      <div className="shell__body">
        <aside className="shell__side" data-tour="side-left">
          <LayersPanel
            document={document}
            session={session}
            onCommand={dispatch}
            onSelect={select}
          />
          <LibraryPanel
            catalog={document.catalog}
            activeTypeId={tool.kind === 'object.place' ? tool.typeId : null}
            onTool={setTool}
          />
          <button
            type="button"
            className="shell__tour"
            title="Четыре шага: открыть план, изменить, проверить, сохранить"
            onClick={() => setTourOpen(true)}
          >
            Обучение
          </button>
        </aside>

        <main className="shell__canvas">
          {/* The refusal floats over the canvas: a row above it would push the
              plan down under the pointer that just made the gesture. */}
          {lastError === null ? null : (
            <p className="shell__error" role="alert">
              Правка отклонена: {lastError}
            </p>
          )}
          <EditorCanvas
            key={documentEpoch}
            document={document}
            session={session}
            onPointer={(event) => {
              planTool.handlePointer(event);
              if (event.phase === 'down' && tool.kind === 'object.place') {
                const existing = findPlacementPick(
                  document,
                  tool.typeId,
                  event.point,
                  viewport.scale,
                );
                if (existing !== null) {
                  select({ kind: 'object', id: existing.id });
                  return;
                }
              }
              equipmentTool.handlePointer(event);
              if (event.phase === 'up' && placedType.current !== null) {
                const completedType = placedType.current;
                placedType.current = null;
                // Browser click follows pointer-up. Disarm after it, so the
                // placement click cannot also select the room underneath.
                window.setTimeout(() => {
                  setTool((current) =>
                    current.kind === 'object.place' && current.typeId === completedType
                      ? { kind: 'select' }
                      : current,
                  );
                }, 0);
              }
            }}
            onViewport={setViewport}
            onSelect={select}
          >
            <PlanGeometryLayer
              document={document}
              session={session}
              draft={planTool.draft}
              onCommand={dispatch}
              onSelect={select}
            />
            <EquipmentLayer
              document={document}
              session={session}
              issues={issues}
              onCommand={dispatch}
              onSelect={select}
              onSelectMany={selectMany}
              preview={preview}
              onGesturePreview={gesturePreview.publish}
            />
            {/* После оборудования — иначе объект, вставший на подпись, закрывает
                название зоны целиком; полупрозрачность не даёт подписи закрыть
                сам объект. */}
            <ZoneNameLayer document={document} viewport={viewport} />
            <InformationLayer document={document} session={session} />
            {/* Подсветка идёт от выделения, не от фокуса: клик по объекту на холсте
                тоже показывает его находки, а Escape гасит подсветку вместе с выбором. */}
            <IssueLayer issues={issues} focus={selection} viewport={viewport} />
          </EditorCanvas>
          {view === '3d' ? (
            <View3D document={document} selection={selection} onSelect={select} />
          ) : null}
        </main>

        <aside className="shell__side shell__side--wide" data-tour="side-right">
          <Section
            id="properties"
            title="Свойства"
            summary={sectionSummaries.properties}
            collapsed={collapsedOf('properties')}
            onToggle={() => toggleSectionState('properties')}
          >
            <PropertiesPanel
              document={document}
              session={session}
              onCommand={dispatch}
              gesturePreview={gesturePreview}
            />
          </Section>
          <Section
            id="assistant"
            title="Ассистент"
            summary={sectionSummaries.assistant}
            collapsed={collapsedOf('assistant')}
            onToggle={() => toggleSectionState('assistant')}
          >
            <AssistantPanel
              document={document}
              revision={revision}
              response={advice}
              state={adviceState}
              onPreview={setPreview}
              onFocus={focusOn}
              onAsk={askAssistant}
            />
          </Section>
          <Section
            id="metrics"
            title="Площади"
            summary={sectionSummaries.metrics}
            collapsed={collapsedOf('metrics')}
            onToggle={() => toggleSectionState('metrics')}
          >
            <MetricsPanel document={document} metrics={metrics} onFocus={focusOn} />
          </Section>
          <Section
            id="validation"
            title="Проверка"
            summary={sectionSummaries.validation}
            summaryTone={validationHasErrors ? 'error' : undefined}
            collapsed={collapsedOf('validation')}
            onToggle={() => toggleSectionState('validation')}
          >
            <ValidationPanel issues={issues} document={document} onFocus={focusOn} />
          </Section>
          <Section
            id="inventory"
            title="Инвентаризация"
            summary={sectionSummaries.inventory}
            collapsed={collapsedOf('inventory')}
            onToggle={() => toggleSectionState('inventory')}
          >
            <InventoryPanel inventory={inventory} document={document} onFocus={focusOn} />
          </Section>
          <Section
            id="catalog"
            title="Справочник"
            summary={sectionSummaries.catalog}
            collapsed={collapsedOf('catalog')}
            onToggle={() => toggleSectionState('catalog')}
          >
            <CatalogPanel document={document} onCommand={dispatch} />
          </Section>
        </aside>
      </div>

      <Onboarding open={tourOpen} onClose={closeTour} />
      <AssistantLauncher onOpen={openAssistant} />
      <HotkeysMapDialog open={hotkeysMap.open} onClose={hotkeysMap.hide} />
    </div>
  );
}
