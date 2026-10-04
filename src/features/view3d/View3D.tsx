/**
 * D01: the 3D view of the current plan. It owns nothing but the camera and
 * GPU resources — the scene is rebuilt from `document` on every change, so
 * whatever the 2D editor did is what 3D shows.
 *
 * Three.js is loaded lazily and only when WebGL is there: a browser without
 * it gets a message and keeps the 2D editor, not a blank panel. There is no
 * sidebar list next to the canvas: the panel is only the stage, and picking
 * an object is a click on its volume (`View3DCanvas` → `onSelect`), same as
 * everywhere else in the app. The section itself still carries the scene
 * composition as data attributes (`data-zones-count`, `data-objects-count`,
 * `data-walls-count`) — a machine-readable proof that 3D matches the plan,
 * without a visible list; the mapping from document to prisms is a pure
 * function in `scene.ts`.
 */

import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { View3DProps } from '../../contracts/ui';
import { buildScene } from './scene';
import { hasWebgl } from './webgl';
import { canvasRecoveryUrl } from './module-recovery';
import { planFileName } from '../../persistence/plan-svg';

let failedCanvasUrl: string | null = null;
let loadedCanvas: typeof import('./View3DCanvas') | null = null;
let recoveryAttempt = 0;
const newCanvas = (retry = false) => lazy(async () => {
  if (loadedCanvas !== null) return loadedCanvas;
  try {
    if (retry && failedCanvasUrl !== null) {
      const url = new URL(failedCanvasUrl);
      // Module fetch failures are cached by the browser as well as React.lazy.
      url.searchParams.set('retry3d', String(++recoveryAttempt));
      loadedCanvas = await import(/* @vite-ignore */ url.href) as typeof import('./View3DCanvas');
    } else {
      loadedCanvas = await import('./View3DCanvas');
    }
    return loadedCanvas;
  } catch (error) {
    failedCanvasUrl = canvasRecoveryUrl(error, window.location.origin);
    throw error;
  }
});

export function View3D({ document, selection, onSelect }: View3DProps): React.JSX.Element {
  const scene = useMemo(() => buildScene(document), [document]);
  // Probed once per session, not per mount: every probe costs a GPU context.
  const [webgl] = useState(hasWebgl);
  const [{ Canvas, attempt }, setLoad] = useState(() => ({ Canvas: newCanvas(), attempt: 0 }));
  // Next to the plan's own PNG, not over it: both land in the same downloads folder.
  const pictureName = planFileName(document, 'png').replace(/\.png$/, '-3d.png');
  const retry = () => setLoad(previous => ({ Canvas: newCanvas(true), attempt: previous.attempt + 1 }));

  const zonesShown = scene.prisms.filter((prism) => prism.kind === 'zone').length;
  const objectsShown = scene.prisms.filter((prism) => prism.kind === 'object').length;
  const wallsShown = new Set(
    scene.prisms.filter((prism) => prism.kind === 'wall').map((prism) => prism.ref.id),
  ).size;

  return (
    <section
      className="view3d"
      aria-label="3D-вид"
      data-testid="view3d"
      data-zones-count={zonesShown}
      data-objects-count={objectsShown}
      data-walls-count={wallsShown}
    >
      <div className="view3d__stage">
        {webgl ? (
          <LoadFailure key={attempt} onRetry={retry}>
            <Suspense
              fallback={
                <p className="view3d__status" role="status">
                  Загружается 3D-модуль…
                </p>
              }
            >
              <Canvas scene={scene} selection={selection} onSelect={onSelect} fileName={pictureName} />
            </Suspense>
          </LoadFailure>
        ) : (
          <p className="view3d__status" role="status" data-testid="view3d-unavailable">
            WebGL в этом браузере недоступен, 3D-вид не построить. 2D-редактор работает
            как обычно — кнопка «2D» в шапке.
          </p>
        )}
      </div>
    </section>
  );
}

type FailureState = { message: string | null };

/** A failed chunk load or a renderer crash shows its reason instead of a blank stage. */
class LoadFailure extends Component<{ children: ReactNode; onRetry(): void }, FailureState> {
  state: FailureState = { message: null };

  static getDerivedStateFromError(error: unknown): FailureState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="view3d__status" role="alert" data-testid="view3d-error">
          <p>Не удалось открыть 3D. Текущий план и правки остаются в редакторе. Можно повторить загрузку или вернуться в 2D.</p>
          <button type="button" className="files__button" onClick={this.props.onRetry}>Повторить загрузку 3D</button>
          <details><summary>Технические подробности</summary>{this.state.message}</details>
        </div>
      );
    }
    return this.props.children;
  }
}
