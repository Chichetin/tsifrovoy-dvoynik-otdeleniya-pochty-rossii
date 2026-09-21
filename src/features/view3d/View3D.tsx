/**
 * D01: the 3D view of the current plan. It owns nothing but the camera and
 * GPU resources — the scene is rebuilt from `document` on every change, so
 * whatever the 2D editor did is what 3D shows.
 *
 * Three.js is loaded lazily and only when WebGL is there: a browser without
 * it gets a message and keeps the 2D editor, not a blank panel. The list of
 * prisms next to the canvas is the textual form of the same scene — that is
 * what a test reads, pixels are not an interface.
 */

import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { View3DProps } from '../../contracts/ui';
import { buildScene, isSelected, type ScenePrism } from './scene';
import { hasWebgl } from './webgl';

const View3DCanvas = lazy(() => import('./View3DCanvas'));

/** Prism kinds listed next to the canvas; walls and the floor are counted only. */
const LISTED_KINDS: ReadonlySet<ScenePrism['kind']> = new Set(['zone', 'object']);

const KIND_LABELS: Record<ScenePrism['kind'], string> = {
  floor: 'помещение',
  zone: 'зона',
  wall: 'стена',
  opening: 'проём',
  object: 'объект',
};

export function View3D({ document, selection, onSelect }: View3DProps): React.JSX.Element {
  const scene = useMemo(() => buildScene(document), [document]);
  // Probed once per session, not per mount: every probe costs a GPU context.
  const [webgl] = useState(hasWebgl);

  const listed = scene.prisms.filter((prism) => LISTED_KINDS.has(prism.kind));
  const walls = new Set(scene.prisms.filter((p) => p.kind === 'wall').map((p) => p.ref.id)).size;
  // Счётчики берутся из сцены, а не из документа: со скрытым слоем список и
  // подпись обязаны говорить одно и то же.
  const zonesShown = scene.prisms.filter((prism) => prism.kind === 'zone').length;
  const objectsShown = scene.prisms.filter((prism) => prism.kind === 'object').length;
  const hiddenCount =
    document.zones.length - zonesShown + (document.objects.length - objectsShown);
  const selectedPrism = listed.find((prism) => isSelected(prism, selection));

  return (
    <section className="view3d" aria-label="3D-вид" data-testid="view3d">
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

      <aside className="view3d__side">
        <p className="view3d__hint" role="status">
          Кликните по объекту в сцене или в списке: он выделится, а его свойства откроются справа.
          Перетаскиванием вращайте вид, колёсиком приближайте.
        </p>
        {selectedPrism ? (
          <p className="view3d__selection" data-testid="view3d-selection">
            Выбрано: <strong>{selectedPrism.label}</strong>. Свойства можно изменить в панели справа.
          </p>
        ) : null}
        <p className="view3d__caption">
          Условные объёмы из текущего плана: коробки по размеру и высоте объекта, зоны —
          цветом пола, стены с проёмами. Без своего состояния: изменили план в 2D — 3D
          соответствует. Зон: {zonesShown}, объектов: {objectsShown},
          стен: {walls}, потолок {document.room.ceilingHeight_m} м.
          {hiddenCount > 0 ? ` Скрытые слои не показаны: элементов вне вида — ${hiddenCount}.` : ''}
        </p>
        <ol className="view3d__list" aria-label="Примитивы 3D-сцены" data-testid="view3d-primitives">
          {listed.map((prism) => (
            <li
              key={`${prism.ref.kind}:${prism.ref.id}`}
              className={isSelected(prism, selection) ? 'view3d__item view3d__item--selected' : 'view3d__item'}
              data-kind={prism.ref.kind}
              data-id={prism.ref.id}
              data-selected={isSelected(prism, selection) ? 'true' : undefined}
            >
              <button
                type="button"
                className="view3d__pick"
                aria-pressed={isSelected(prism, selection)}
                onClick={() => onSelect(prism.ref)}
              >
                <span className="view3d__swatch" style={{ background: prism.color }} aria-hidden="true" />
                <span className="view3d__kind">{KIND_LABELS[prism.kind]}</span>{' '}
                <span className="view3d__label">{prism.label}</span>
                {prism.kind === 'object' ? (
                  <span className="view3d__dims">
                    {' '}
                    {prism.base_m > 0 ? `${prism.base_m}–${round(prism.base_m + prism.height_m)} м` : `h ${prism.height_m} м`}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
