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
 * function tested on its own in `scene.test.ts`.
 */

import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { View3DProps } from '../../contracts/ui';
import { buildScene } from './scene';
import { hasWebgl } from './webgl';

const View3DCanvas = lazy(() => import('./View3DCanvas'));

export function View3D({ document, selection, onSelect }: View3DProps): React.JSX.Element {
  const scene = useMemo(() => buildScene(document), [document]);
  // Probed once per session, not per mount: every probe costs a GPU context.
  const [webgl] = useState(hasWebgl);

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
          <LoadFailure>
            <Suspense
              fallback={
                <p className="view3d__status" role="status">
                  Загружается 3D-модуль…
                </p>
              }
            >
              <View3DCanvas scene={scene} selection={selection} onSelect={onSelect} />
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
class LoadFailure extends Component<{ children: ReactNode }, FailureState> {
  state: FailureState = { message: null };

  static getDerivedStateFromError(error: unknown): FailureState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <p className="view3d__status" role="alert" data-testid="view3d-error">
          Не удалось показать 3D: {this.state.message}. 2D-редактор работает как обычно.
        </p>
      );
    }
    return this.props.children;
  }
}
