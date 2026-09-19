/**
 * U01: the one place where the editor is assembled.
 *
 * Panels are independent modules that know nothing about each other; this file
 * holds the session (tool, viewport, selection, preview) and routes every
 * command into the single store. Derived data — inventory, issues — is
 * recomputed from the document, never stored beside it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AdviceRequest, AdviceResponse, Candidate } from '../contracts/advice';
import type { Command, DocumentOrigin } from '../contracts/commands';
import type { PlanDocument, Ref, Result, Viewport } from '../contracts/model';
import type { EditorSession, RequestState, Tool } from '../contracts/ui';
import { buildInventory } from '../domain/inventory';
import { measurePlan } from '../domain/metrics';
import { validatePlan } from '../domain/validation';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { requestAdvice } from '../features/assistant/advice-client';
import { EditorCanvas } from '../features/editor/EditorCanvas';
import { EquipmentLayer } from '../features/equipment/EquipmentLayer';
import { useEquipmentToolController } from '../features/equipment/use-equipment-tool-controller';
import { FileControls } from '../features/files/FileControls';
import { CatalogPanel } from '../features/catalog-editor/CatalogPanel';
import { InventoryPanel } from '../features/inventory/InventoryPanel';
import { InformationLayer } from '../features/layers/InformationLayer';
import { LayersPanel } from '../features/layers/LayersPanel';
import { MetricsPanel } from '../features/inventory/MetricsPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { PlanGeometryLayer } from '../features/plan-tools/PlanGeometryLayer';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';
import { PlanTools } from '../features/plan-tools/PlanTools';
import { usePlanToolController } from '../features/plan-tools/use-plan-tool-controller';
import { IssueLayer } from '../features/validation/IssueLayer';
import { ValidationPanel } from '../features/validation/ValidationPanel';
import { View3D } from '../features/view3d/View3D';
import { encodePlan } from '../persistence/codec';
import { readPlanFile } from '../persistence/format';
import { ORGANIZER_CATALOG_VERSION, withTeamCatalog } from '../persistence/organizer-import';
import { createPlanStore } from '../state/plan-store';
import { catalog, createEmptyPlan } from './default-plan';
import './styles.css';

const START_VIEWPORT: Viewport = { origin: [0, 0], scale: 48 };

export function App(): React.JSX.Element {
  const [store, setStore] = useState(() => createPlanStore(createEmptyPlan(), 'new'));
  const document = useStore(store, (state) => state.document);
  const revision = useStore(store, (state) => state.revision);
  const selection = useStore(store, (state) => state.selection);
  const dirty = useStore(store, (state) => state.dirty);

  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  // 3D is an overlay over the same document; the 2D canvas stays mounted below it.
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const [lastError, setLastError] = useState<string | null>(null);
  const focusSequence = useRef(0);
  const [focus, setFocus] = useState<EditorSession['focus']>(null);
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  // The "before" of the compare scenario: the plan as opened, as reset by "New"
  // or as last saved; a restored draft is its own "before". The store keeps the
  // same snapshot for the dirty flag, but in a closure — tracking it here is
  // cheaper than widening the store contract for one reader. Updated in the
  // same three places as the store's baseline (D-131).
  const [compareBase, setCompareBase] = useState<PlanDocument>(() => store.getState().document);
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

  const session: EditorSession = useMemo(
    () => ({ tool, viewport, selection, preview, focus }),
    [tool, viewport, selection, preview, focus],
  );

  const select = useCallback(
    (ref: Ref | null) => store.getState().select(ref),
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
  // out. Moves and edits go through `dispatch` untouched.
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
  const equipmentTool = useEquipmentToolController({ document, session, onCommand: dispatchAndSelect });

  const inventory = useMemo(() => buildInventory(document), [document]);
  const issues = useMemo(() => validatePlan(document), [document]);
  const metrics = useMemo(() => measurePlan(document), [document]);

  const askAssistant = useCallback(
    (request: AdviceRequest, query?: string) => {
      setAdviceState({ status: 'loading' });
      // Ответ привязан к ревизии запроса: панель сама скажет, что он устарел,
      // если план успели поправить, пока сервер считал.
      // The panel knows no document history and sends the current plan as
      // "before"; only the app knows the real one.
      const grounded: AdviceRequest =
        request.scenario === 'compare' ? { ...request, before: compareBase } : request;
      const asked = { plan: document, revision, request: grounded, ...(query === undefined ? {} : { query }) };
      void requestAdvice(asked).then((result) => {
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
    [compareBase, document, revision],
  );

  // A recommendation belongs to the plan it was computed for: after «Открыть»
  // or «Новый» its ids point at objects that no longer exist, and «план
  // изменился» is too mild a warning for that — the answer goes away entirely.
  const forgetAdvice = useCallback(() => {
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
      setCompareBase(document);
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
    setCompareBase(fresh.getState().document);
    setTool({ kind: 'select' });
    setLastError(null);
    setDocumentEpoch((epoch) => epoch + 1);
    forgetAdvice();
  }, [forgetAdvice]);

  return (
    <div className="shell">
      <header className="shell__bar">
        <h1 className="shell__title">Цифровой двойник ОПС</h1>
        <PlanTools document={document} session={session} onTool={setTool} onCommand={dispatch} />
        <div className="shell__view" role="group" aria-label="Вид плана">
          <button type="button" className="files__button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
            2D
          </button>
          <button type="button" className="files__button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            3D
          </button>
        </div>
        <div className="shell__history">
          <button type="button" className="files__button" onClick={() => store.getState().undo()}>
            Отменить
          </button>
          <button type="button" className="files__button" onClick={() => store.getState().redo()}>
            Вернуть
          </button>
        </div>
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
            // The saved plan becomes the new "before".
            setCompareBase(document);
          }}
        />
      </header>

      {lastError === null ? null : (
        <p className="shell__error" role="alert">
          Правка отклонена: {lastError}
        </p>
      )}

      <div className="shell__body">
        <aside className="shell__side">
          <LibraryPanel catalog={document.catalog} onTool={setTool} />
          <LayersPanel
            document={document}
            session={session}
            onCommand={dispatch}
            onSelect={select}
          />
        </aside>

        <main className="shell__canvas">
          <EditorCanvas
            key={documentEpoch}
            document={document}
            session={session}
            onPointer={(event) => {
              planTool.handlePointer(event);
              equipmentTool.handlePointer(event);
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
              onCommand={dispatch}
              onSelect={select}
              preview={preview}
            />
            <InformationLayer document={document} session={session} />
            {/* Подсветка идёт от выделения, не от фокуса: клик по объекту на холсте
                тоже показывает его находки, а Escape гасит подсветку вместе с выбором. */}
            <IssueLayer issues={issues} focus={selection} viewport={viewport} />
          </EditorCanvas>
          {view === '3d' ? <View3D document={document} selection={selection} /> : null}
        </main>

        <aside className="shell__side shell__side--wide">
          <PropertiesPanel document={document} session={session} onCommand={dispatch} />
          <AssistantPanel
            document={document}
            revision={revision}
            response={advice}
            state={adviceState}
            onPreview={setPreview}
            onFocus={focusOn}
            onAsk={askAssistant}
          />
          <MetricsPanel document={document} metrics={metrics} onFocus={focusOn} />
          <ValidationPanel issues={issues} document={document} onFocus={focusOn} />
          <InventoryPanel inventory={inventory} document={document} onFocus={focusOn} />
          <CatalogPanel document={document} onCommand={dispatch} />
        </aside>
      </div>
    </div>
  );
}
