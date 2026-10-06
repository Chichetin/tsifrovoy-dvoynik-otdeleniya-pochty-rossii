import { useEffect, useRef, useState } from 'react';
import type { PlanDocument, Ref } from '../../contracts/model';
import { inventoryLinkTarget, resolveInventoryLink } from '../../domain/inventory';

/** The target waits for its file to be opened; it never chooses an object from another plan. */
export function InventoryLinkNotice({ document: plan, onFocus }: {
  document: PlanDocument; onFocus: (ref: Ref) => void;
}): React.JSX.Element | null {
  const [target] = useState(() => inventoryLinkTarget(window.location.search));
  const [dismissed, setDismissed] = useState(false);
  const focused = useRef(false);
  const resolution = target === null ? null : resolveInventoryLink(plan, target);
  const object = resolution?.status === 'found' ? resolution.object : null;

  useEffect(() => {
    if (dismissed || object === null || focused.current) return;
    focused.current = true;
    onFocus({ kind: 'object', id: object.id });
  }, [dismissed, object, onFocus]);

  if (target === null || dismissed) return null;
  return <section className="inventory-link-notice" aria-label="Переход к предмету">
    <p role="status">
      {object !== null ? `Предмет по ссылке: ${object.label}.` :
        resolution?.status === 'different-plan'
          ? 'Этот предмет относится к другому плану. Откройте нужный файл через «Файл → Открыть существующий»: затем предмет будет выбран.'
          : 'Предмет из ссылки не найден в этом плане. Возможно, его удалили или открыта другая версия файла.'}
    </p>
    {object !== null ? <button type="button" onClick={() => onFocus({ kind: 'object', id: object.id })}>
      Показать на плане
    </button> : <details><summary>Идентификаторы из ссылки</summary>
      <p>План: {target.planId}<br />Предмет: {target.objectId}</p>
    </details>}
    <button type="button" aria-label="Закрыть переход к предмету" onClick={() => setDismissed(true)}>Закрыть</button>
  </section>;
}
