// F01 stand: proves React 19 + react-konva render a stage in a real browser.
import { Layer, Rect, Stage } from 'react-konva';

export default function F01Stand() {
  return (
    <Stage width={200} height={100}>
      <Layer>
        <Rect x={20} y={20} width={60} height={40} fill="#0055a5" />
      </Layer>
    </Stage>
  );
}
