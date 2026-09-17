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
import type { Command } from '../contracts/commands';
import type { PlanDocument, Ref, Result, Viewport } from '../contracts/model';
import type { EditorSession, Tool } from '../contracts/ui';
import { buildInventory } from '../domain/inventory';
import { measurePlan } from '../domain/metrics';
import { validatePlan } from '../domain/validation';
import { EditorCanvas } from '../features/editor/EditorCanvas';
import { EquipmentLayer } from '../features/equipment/EquipmentLayer';
import { useEquipmentToolController } from '../features/equipment/use-equipment-tool-controller';
import { FileControls } from '../features/files/FileControls';
import { InventoryPanel } from '../features/inventory/InventoryPanel';
import { MetricsPanel } from '../features/inventory/MetricsPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { PlanGeometryLayer } from '../features/plan-tools/PlanGeometryLayer';
import { PlanTools } from '../features/plan-tools/PlanTools';
import { usePlanToolController } from '../features/plan-tools/use-plan-tool-controller';
import { ValidationPanel } from '../features/validation/ValidationPanel';
import { decodePlan, encodePlan } from '../persistence/codec';
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
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const [lastError, setLastError] = useState<string | null>(null);
  const focusSequence = useRef(0);
  const [focus, setFocus] = useState<EditorSession['focus']>(null);

  const session: EditorSession = useMemo(
    () => ({ tool, viewport, selection, preview: null, focus }),
    [tool, viewport, selection, focus],
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

  const replaceDocument = useCallback(
    (plan: PlanDocument) => {
      // 'file' — план пришёл из файла и считается сохранённым состоянием.
      store.getState().replaceDocument(plan, 'file');
      setLastError(null);
    },
    [store],
  );

  const startNewPlan = useCallback(() => {
    setStore(createPlanStore(createEmptyPlan(), 'new'));
    setTool({ kind: 'select' });
    setLastError(null);
  }, []);

  return (
    <div className="shell">
      <header className="shell__bar">
        <h1 className="shell__title">Цифровой двойник ОПС</h1>
        <PlanTools document={document} session={session} onTool={setTool} onCommand={dispatch} />
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
          decode={decodePlan}
          encode={encodePlan}
          onReplace={replaceDocument}
          onNew={startNewPlan}
          onExported={() => store.getState().markExported(revision)}
        />
      </header>

      {lastError === null ? null : (
        <p className="shell__error" role="alert">
          Правка отклонена: {lastError}
        </p>
      )}

      <div className="shell__body">
        <aside className="shell__side">
          <LibraryPanel catalog={catalog} onTool={setTool} />
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
              preview={null}
            />
          </EditorCanvas>
        </main>

        <aside className="shell__side shell__side--wide">
          <MetricsPanel document={document} metrics={metrics} onFocus={focusOn} />
          <ValidationPanel issues={issues} onFocus={focusOn} />
          <InventoryPanel inventory={inventory} onFocus={focusOn} />
        </aside>
      </div>
    </div>
  );
}
