import { useMemo, useState, type PointerEvent } from 'react';
import type { PlanDocument, Viewport } from '../../contracts/model';
import { boundingBox, modelToScreen, screenToModel } from '../../domain/geometry';
import { panBy, visibleExtent, type CanvasSize } from './viewport';

const WIDTH = 180;
const HEIGHT = 100;

export function PlanMinimap({ document: plan, viewport, size, onViewport }: {
  document: PlanDocument; viewport: Viewport; size: CanvasSize; onViewport: (viewport: Viewport) => void;
}): React.JSX.Element {
  const [visible, setVisible] = useState(true);
  const mini = useMemo(() => {
    const box = boundingBox(plan.room.boundary);
    const scale = Math.min((WIDTH-16)/Math.max(1, box.maxX-box.minX), (HEIGHT-16)/Math.max(1, box.maxY-box.minY));
    const projected = boundingBox(plan.room.boundary.map((point) => modelToScreen(point, { origin: [0,0], scale })));
    return { scale, origin: [8-projected.minX, 8-projected.minY] as [number, number] };
  }, [plan.room.boundary]);
  const points = (polygon: typeof plan.room.boundary): string =>
    polygon.map((point) => modelToScreen(point, mini).join(',')).join(' ');
  const moveTo = (event: PointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = screenToModel([(event.clientX-bounds.left)*WIDTH/bounds.width,
      (event.clientY-bounds.top)*HEIGHT/bounds.height], mini);
    const screen = modelToScreen(point, viewport);
    onViewport(panBy(viewport, [size.width/2-screen[0], size.height/2-screen[1]]));
  };
  return <div style={{ position: 'absolute', left: 12, bottom: 48, zIndex: 2 }}>
    <button type="button" aria-expanded={visible} aria-controls="plan-minimap" onClick={() => setVisible(!visible)}
      style={{ background: '#FFF', border: '1px solid #ADB5BD', borderRadius: 4, padding: '4px 8px' }}>
      {visible ? 'Скрыть мини-карту' : 'Мини-карта'}
    </button>
    {visible ? <svg id="plan-minimap" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT}
      role="application" aria-label="Мини-карта плана. Клик или перетаскивание — перейти; стрелки — двигать вид" tabIndex={0}
      style={{ display: 'block', background: '#FFF', border: '1px solid #ADB5BD', borderRadius: 4, touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); moveTo(event);
      }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onKeyDown={(event) => {
        const delta = ({ ArrowLeft: [80,0], ArrowRight: [-80,0], ArrowUp: [0,80], ArrowDown: [0,-80] } as const)[event.key as 'ArrowLeft'];
        if (delta === undefined) return;
        event.preventDefault(); event.stopPropagation(); onViewport(panBy(viewport, [delta[0], delta[1]]));
      }}>
      <polygon points={points(plan.room.boundary)} fill="#F1F3F5" stroke="#495057" strokeWidth={1} />
      {plan.zones.filter((zone) => plan.layers.some((layer) => layer.id === zone.layerId && layer.visible)).map((zone) =>
        <polygon key={zone.id} points={points(zone.polygon)} fill="#DCE8F3" stroke="#AAB7C4" strokeWidth={0.5} />)}
      <polygon points={points(visibleExtent(viewport, size))} fill="#1971C220" stroke="#1971C2" strokeWidth={1.5} />
    </svg> : null}
  </div>;
}
