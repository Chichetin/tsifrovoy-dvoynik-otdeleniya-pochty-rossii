import { formatLength } from '../../domain/number-format';
import { boundingBox } from '../../domain/geometry';
import type { Polygon } from '../../contracts/model';
export function InternalRoomControls({ draft, ready, valid, message, onApply, onCancel }: {
  draft: Polygon | null; ready: boolean; valid: boolean; message: string | null;
  onApply(): void; onCancel(): void;
}): React.JSX.Element {
  const box = draft === null ? null : boundingBox(draft);
  return <div className="drawing-controls" role="region" aria-label="Создание комнаты">
    <strong>{ready ? 'Проверьте комнату и примените' : draft === null ? 'Нажмите первый угол комнаты' : 'Нажмите противоположный угол'}</strong>
    <span className="toolbar__note">Два угла задают прямоугольник. У существующих стен работает привязка; Alt её отключает. Старые стены и внешний контур сохраняются.</span>
    {box === null || draft?.length !== 4 ? null : <span>Размер: {formatLength(box.maxX - box.minX)} × {formatLength(box.maxY - box.minY)}</span>}
    {message === null ? null : <span role="status" className="toolbar__note is-notice">{message}</span>}
    <div className="drawing-controls__actions">
      <button type="button" className="files__button" disabled={!ready || !valid} onClick={onApply}>Создать комнату</button>
      <button type="button" className="files__button" onClick={onCancel}>{ready ? 'Нарисовать заново' : 'Отменить рисование'}</button>
    </div>
    <span className="toolbar__note">Добавятся только новые перегородки и именованная зона. Дверь добавляется инструментом «Проём». Одно действие — одна отмена.</span>
  </div>;
}
