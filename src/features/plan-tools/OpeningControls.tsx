import type { OpeningKind } from '../../contracts/model';
export function OpeningControls({ready,valid,message,kind,width,onKind,onWidth,onApply,onCancel}: {
  ready:boolean;valid:boolean;message:string|null;kind:OpeningKind;width:string;
  onKind(kind:OpeningKind):void;onWidth(width:string):void;onApply():void;onCancel():void;
}) {
  return <section className="drawing-controls" aria-label="Создание проёма">
    <strong>{ready?'Проверьте и установите проём':'Наведите курсор на стену'}</strong>
    <span className="toolbar__note">Нажмите на стену, чтобы подготовить проём. Стена изменится только после установки. Другой клик меняет место.</span>
    <label>Вид проёма<select value={kind} onChange={e=>onKind(e.target.value as OpeningKind)}><option value="door">Дверь</option><option value="entrance">Вход</option><option value="window">Окно</option></select></label>
    <label>Ширина проёма, м<input type="text" inputMode="decimal" value={width} onChange={e=>onWidth(e.target.value)} /></label>
    {message===null?null:<span role="status" className="toolbar__note is-notice">{message}</span>}
    <div className="drawing-controls__actions"><button type="button" className="files__button" disabled={!ready||!valid} onClick={onApply}>Установить проём</button><button type="button" className="files__button" onClick={onCancel}>Отменить проём</button></div>
    <span className="toolbar__note">После установки: центр двигает, края меняют ширину. Esc отменяет черновик.</span>
  </section>;
}
