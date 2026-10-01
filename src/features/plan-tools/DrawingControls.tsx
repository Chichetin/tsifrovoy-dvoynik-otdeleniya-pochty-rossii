import type { Point } from '../../contracts/model';
import { useNotice } from './notice';

export function DrawingControls({ name, draft, onFinish, onRemoveLast, onCancel, shapeLabel, roomBoundary = false, pendingRoom = false, onConfirmRoom }: {
  name: string;
  roomBoundary?: boolean;
  pendingRoom?: boolean;
  onConfirmRoom?(): void;
  shapeLabel?: string;
  draft: Point[] | null;
  onFinish(): void;
  onRemoveLast(): void;
  onCancel(): void;
}): React.JSX.Element {
  const notice = useNotice();
  const count = draft?.length ?? 0;
  return (
    <div className="drawing-controls" role="region" aria-label="Рисование контура">
      {roomBoundary ? <span className="toolbar__note">Это внешний контур всего отделения. Для внутренних стен используйте «Перегородка», для функционального участка — «Зона».</span> : null}
      {pendingRoom ? <div role="status">Новый контур готов. Применение пересоберёт наружные стены; проёмы могут переместиться или исчезнуть. Объекты и зоны сохранятся — проверьте, что они внутри. Изменение можно отменить кнопкой «Отменить» в шапке.</div> : null}
      <strong>{count === 0 ? 'Нажмите первый угол на плане' : `Углов: ${count} — ставьте следующие по порядку`}</strong>
      {shapeLabel === undefined ? null : <span className="toolbar__note" data-testid="shape-draw-hint">Своя фигура «{shapeLabel}»</span>}
      <span className="toolbar__note">
        {count < 3 ? 'Для контура нужны минимум 3 угла.' : 'Замкните контур кнопкой ниже или нажмите угол 1.'}
      </span>
      <div className="drawing-controls__actions">
        {pendingRoom ? <button type="button" className="files__button" onClick={onConfirmRoom}>Применить внешний контур</button> : <button type="button" className="files__button" disabled={count < 3} onClick={onFinish}>Завершить {name}</button>}
        <button type="button" className="files__button" disabled={count === 0} onClick={onRemoveLast}>Убрать последний угол</button>
        <button type="button" className="files__button" onClick={onCancel}>Отменить рисование</button>
      </div>
      <span className="toolbar__note">Enter — завершить · Backspace — убрать угол · Esc — отменить</span>
      {notice === null ? null : <span className="toolbar__note is-notice" role="status" data-testid="plan-tools-notice">{notice}</span>}
    </div>
  );
}
