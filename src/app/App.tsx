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
import { createPlanStore } from '../state/plan-store';
import { createEmptyPlan } from './default-plan';
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
  // «Было» для сценария сравнения: план в момент открытия файла, «Нового» или
  // последнего сохранения. Store держит такой же снимок для флага dirty, но в
  // замыкании; вести его здесь дешевле, чем расширять контракт store ради
  // одного читателя. Обновляется в тех же трёх местах, что и baseline store.
  const [compareBase, setCompareBase] = useState<PlanDocument>(() => store.getState().document);
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

  const focusOn = useCallback(
    (ref: Ref) => {
      focusSequence.current += 1;
      setFocus({ ref, sequence: focusSequence.current });
      select(ref);
    },
    [select],
  );

  const planTool = usePlanToolController({ document, session, onCommand: dispatch });
  const equipmentTool = useEquipmentToolController({ document, session, onCommand: dispatch });

  const inventory = useMemo(() => buildInventory(document), [document]);
  const issues = useMemo(() => validatePlan(document), [document]);
  const metrics = useMemo(() => measurePlan(document), [document]);

  const askAssistant = useCallback(
    (request: AdviceRequest, query?: string) => {
      setAdviceState({ status: 'loading' });
      // Ответ привязан к ревизии запроса: панель сама скажет, что он устарел,
      // если план успели поправить, пока сервер считал.
      // Панель не знает истории документа и в сценарии сравнения присылает
      // «было» = текущий план; настоящее «было» знает только приложение.
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

  const replaceDocument = useCallback(
    (plan: PlanDocument, origin: DocumentOrigin) => {
      // 'file' — план пришёл из файла и считается сохранённым состоянием;
      // 'draft' — восстановленный черновик, он никуда ещё не выгружен.
      store.getState().replaceDocument(plan, origin);
      setCompareBase(plan);
      setLastError(null);
    },
    [store],
  );

  const startNewPlan = useCallback(() => {
    const fresh = createPlanStore(createEmptyPlan(), 'new');
    setStore(fresh);
    setCompareBase(fresh.getState().document);
    setTool({ kind: 'select' });
    setLastError(null);
  }, []);

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
          read={readPlanFile}
          encode={encodePlan}
          onReplace={replaceDocument}
          onNew={startNewPlan}
          onExported={() => {
            store.getState().markExported(revision);
            // Сохранённый план становится новой точкой отсчёта «было».
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
        </aside>
      </div>
    </div>
  );
}
