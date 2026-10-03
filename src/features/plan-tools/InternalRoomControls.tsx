import { formatLength } from '../../domain/number-format';
import { boundingBox } from '../../domain/geometry';
import type { Polygon, ZoneType } from '../../contracts/model';
export function InternalRoomControls({ draft, ready, valid, message, name, typeId, types, onName, onType, onApply, onCancel, onRemoveLast }: {
  draft: Polygon | null; ready: boolean; valid: boolean; message: string | null;
  name: string; typeId: string; types: ZoneType[]; onName(name: string): void; onType(typeId: string): void;
  onApply(): void; onCancel(): void; onRemoveLast(): void;
}): React.JSX.Element {
  const box = draft === null ? null : boundingBox(draft);
  return <div className="drawing-controls" role="region" aria-label="Создание комнаты" data-room-controls>
    <strong>{ready ? 'Проверьте комнату и примените' : draft === null ? 'Нажмите первый угол комнаты' : 'Нажмите противоположный угол'}</strong>
    <span className="toolbar__note">Два угла задают прямоугольник. У существующих стен работает привязка; Alt её отключает. Старые стены и внешний контур сохраняются.</span>
    <label>Название комнаты<input type="text" value={name} onChange={event => onName(event.target.value)} /></label>
    <label>Назначение комнаты<select value={typeId} onChange={event => onType(event.target.value)}>
      {types.some(type => type.id === typeId) ? null : <option value={typeId}>Выберите назначение</option>}
      {types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
    </select></label>
    {box === null || draft?.length !== 4 ? null : <span>Размер: {formatLength(box.maxX - box.minX)} × {formatLength(box.maxY - box.minY)}</span>}
    {message === null ? null : <span role="status" className="toolbar__note is-notice">{message}</span>}
    <div className="drawing-controls__actions">
      <button type="button" className="files__button" disabled={!ready || !valid} onClick={onApply}>Создать комнату</button>
      <button type="button" className="files__button" disabled={draft === null} onClick={onRemoveLast}>Убрать последний угол</button>
      <button type="button" className="files__button" onClick={onCancel}>{ready ? 'Нарисовать заново' : 'Отменить рисование'}</button>
    </div>
    <span className="toolbar__note">Ошиблись углом — «Убрать последний угол» или Ctrl+Z. Esc отменяет рисунок. После создания Ctrl+Z отменяет всю комнату. Дверь добавляется инструментом «Проём».</span>
  </div>;
}
