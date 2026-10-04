import { Group, Line } from 'react-konva';
import type { Opening, PlanDocument, Viewport } from '../../contracts/model';
import { modelToScreen, wallLength } from '../../domain/geometry';
export function OpeningPreviewLayer({opening,plan,viewport,valid}: {opening:Opening|null;plan:PlanDocument;viewport:Viewport;valid:boolean}) {
  const wall=plan.walls.find(w=>w.id===opening?.wallId);
  if(opening===null||wall===undefined)return null;
  const length=wallLength(wall);if(length===0)return null;
  const at=(offset:number)=>modelToScreen([wall.from[0]+(wall.to[0]-wall.from[0])*offset/length,wall.from[1]+(wall.to[1]-wall.from[1])*offset/length],viewport);
  return <Group listening={false}><Line name="opening-placement-preview" points={[...at(opening.offset_m),...at(opening.offset_m+opening.width_m)]} stroke={valid?'#1971C2':'#C92A2A'} strokeWidth={Math.max(8,wall.thickness_m*viewport.scale+4)} opacity={0.7} dash={[6,3]} /></Group>;
}
