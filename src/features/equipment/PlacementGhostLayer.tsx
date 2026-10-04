import { useSyncExternalStore } from 'react';
import { Label, Line, Tag, Text } from 'react-konva';
import type { Viewport } from '../../contracts/model';
import { footprint, modelToScreen } from '../../domain/geometry';
import { placementGhost } from './placement-ghost';

const ACCEPTED = '#2F9E44';
const REFUSED = '#E03131';
const LABEL_WIDTH_PX = 240;

/**
 * Silhouette of the armed type under the pointer: green where the click would
 * place it, red with the store's reason where it would be refused (#26).
 */
export function PlacementGhostLayer({ active, viewport }: { active: boolean; viewport: Viewport }): React.JSX.Element | null {
  const ghost = useSyncExternalStore(placementGhost.subscribe, placementGhost.getSnapshot);
  if (!active || ghost === null) return null;
  const color = ghost.refusal === null ? ACCEPTED : REFUSED;
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
      {ghost.refusal === null ? null : (
        <Label name="placement-ghost-reason" x={centre - LABEL_WIDTH_PX / 2} y={lowest + 6} listening={false}>
          <Tag fill="#FFFFFF" stroke={REFUSED} cornerRadius={3} opacity={0.95} />
          <Text text={ghost.refusal} width={LABEL_WIDTH_PX} fontSize={12} fill={REFUSED} padding={4} align="center" />
        </Label>
      )}
    </>
  );
}
