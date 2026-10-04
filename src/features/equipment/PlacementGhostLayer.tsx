import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type Konva from 'konva';
import { Label, Line, Tag, Text } from 'react-konva';
import type { Viewport } from '../../contracts/model';
import { footprint, modelToScreen } from '../../domain/geometry';
import { placementGhost } from './placement-ghost';

const ACCEPTED = '#2F9E44';
const REFUSED = '#E03131';
const WARNED = '#E67700';
const LABEL_WIDTH_PX = 240;
const EDGE_PX = 8;

/**
 * Silhouette of the armed type under the pointer: green where the click would
 * place it, red with the store's reason where it would be refused, amber where
 * it is taken but the check will find a violation at once (#26, #91).
 */
export function PlacementGhostLayer({ active, viewport }: { active: boolean; viewport: Viewport }): React.JSX.Element | null {
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
