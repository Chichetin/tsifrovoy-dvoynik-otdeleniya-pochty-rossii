import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Arrow, Label, Line, Tag, Text } from 'react-konva';
import type { Viewport } from '../../contracts/model';
import { footprint, modelToScreen } from '../../domain/geometry';
import { placementGhost, suggestionGhost } from './placement-ghost';

const ACCEPTED = '#2F9E44';
const REFUSED = '#E03131';
const WARNED = '#E67700';
const LABEL_WIDTH_PX = 240;
const EDGE_PX = 8;
/** #179: the assistant's place — a colour no catalog type uses, on a white halo for any background. */
const SUGGESTED = '#0C8599';
const SUGGESTED_TEXT = '#0B7285';
const HALO = '#FFFFFF';

/**
 * #179: the option chosen in «Предложить место». A dashed outline where the
 * object would stand and a dashed arrow from where it stands now; the object
 * itself does not move until «Подтвердить».
 */
function SuggestionGhostShape({ viewport }: { viewport: Viewport }): React.JSX.Element | null {
  const ghost = useSyncExternalStore(suggestionGhost.subscribe, suggestionGhost.getSnapshot);
  const label = useRef<Konva.Label>(null);
  const ring = ghost === null ? [] : footprint(ghost.to).map((point) => modelToScreen(point, viewport));
  const lowest = ring.length === 0 ? 0 : Math.max(...ring.map(([, y]) => y));
  // The label names the option: it stays inside the canvas when the ghost is at
  // an edge, under the ghost when there is no room above it.
  useLayoutEffect(() => {
    const node = label.current;
    const stage = node?.getStage();
    if (node == null || stage == null) return;
    node.x(Math.max(EDGE_PX, Math.min(node.x(), stage.width() - node.width() - EDGE_PX)));
    if (node.y() < EDGE_PX) node.y(lowest + 6);
    node.getLayer()?.batchDraw();
  });
  if (ghost === null) return null;
  const [cx, cy] = modelToScreen(ghost.to.position, viewport);
  const from = ghost.from === null ? null : modelToScreen(ghost.from, viewport);
  const top = Math.min(...ring.map(([, y]) => y));
  const arrow = from === null ? null : [from[0], from[1], cx, cy];
  return (
    <>
      {arrow === null ? null : (
        <>
          <Arrow name="suggestion-ghost-arrow-halo" points={arrow} stroke={HALO} fill={HALO} strokeWidth={5} pointerLength={11} pointerWidth={11} opacity={0.9} listening={false} />
          <Arrow name="suggestion-ghost-arrow" points={arrow} stroke={SUGGESTED} fill={SUGGESTED} strokeWidth={2} dash={[7, 4]} pointerLength={10} pointerWidth={10} listening={false} />
        </>
      )}
      <Line points={ring.flat()} closed stroke={HALO} strokeWidth={6} opacity={0.9} listening={false} />
      {/* A light tint inside, a strong dashed edge: the plan under it stays readable. */}
      <Line
        name="suggestion-ghost"
        points={ring.flat()}
        closed
        fill="rgba(12, 133, 153, 0.16)"
        stroke={SUGGESTED}
        strokeWidth={2.5}
        dash={[8, 5]}
        listening={false}
      />
      {ghost.label === '' ? null : (
        <Label ref={label} name="suggestion-ghost-label" x={cx - LABEL_WIDTH_PX / 2} y={top - 26} listening={false}>
          <Tag fill={HALO} stroke={SUGGESTED} cornerRadius={3} opacity={0.95} />
          <Text text={ghost.label} width={LABEL_WIDTH_PX} fontSize={12} fontStyle="bold" fill={SUGGESTED_TEXT} padding={4} align="center" />
        </Label>
      )}
    </>
  );
}

/** The assistant's chosen place (#179) and the silhouette of the armed type (#26). */
export function PlacementGhostLayer({ active, viewport }: { active: boolean; viewport: Viewport }): React.JSX.Element {
  return (
    <>
      <SuggestionGhostShape viewport={viewport} />
      <ArmedGhost active={active} viewport={viewport} />
    </>
  );
}

/**
 * Silhouette of the armed type under the pointer: green where the click would
 * place it, red with the store's reason where it would be refused, amber where
 * it is taken but the check will find a violation at once (#26, #91).
 */
function ArmedGhost({ active, viewport }: { active: boolean; viewport: Viewport }): React.JSX.Element | null {
  const ghost = useSyncExternalStore(placementGhost.subscribe, placementGhost.getSnapshot);
  const label = useRef<Konva.Label>(null);
  const shown = active && ghost !== null;
  const top = shown ? Math.min(...footprint(ghost.object).map((point) => modelToScreen(point, viewport)[1])) : 0;
  // The reason is the point of a red or amber silhouette: it stays inside the
  // canvas when the silhouette is at an edge, above it at the bottom edge.
  useLayoutEffect(() => {
    const node = label.current;
    const stage = node?.getStage();
    if (node == null || stage == null) return;
    node.x(Math.max(EDGE_PX, Math.min(node.x(), stage.width() - node.width() - EDGE_PX)));
    if (node.y() + node.height() > stage.height() - EDGE_PX) node.y(Math.max(EDGE_PX, top - node.height() - 6));
    node.getLayer()?.batchDraw();
  });
  if (!shown) return null;
  // Red — the store refuses; amber — it takes the object but «Проверка» will find
  // a violation at once; green — a clean place.
  const color = ghost.refusal !== null ? REFUSED : ghost.warning !== null ? WARNED : ACCEPTED;
  const reason = ghost.refusal ?? (ghost.warning === null ? null : `Будет находка: ${ghost.warning}`);
  const ring = footprint(ghost.object).map((point) => modelToScreen(point, viewport));
  const lowest = Math.max(...ring.map(([, y]) => y));
  const centre = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  return (
    <>
      <Line
        name="placement-ghost"
        points={ring.flat()}
        closed
        fill={color}
        opacity={0.45}
        stroke={color}
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
      />
      {reason === null ? null : (
        <Label ref={label} name="placement-ghost-reason" x={centre - LABEL_WIDTH_PX / 2} y={lowest + 6} listening={false}>
          <Tag fill="#FFFFFF" stroke={color} cornerRadius={3} opacity={0.95} />
          <Text text={reason} width={LABEL_WIDTH_PX} fontSize={12} fill={color} padding={4} align="center" />
        </Label>
      )}
    </>
  );
}
