/**
 * Entry point to the assistant, in two looks: a round avatar in the header and
 * a floating one in the canvas corner. Both only switch the right column to
 * the assistant tab; no advice state lives here.
 */

import { useEffect, useState } from 'react';
import avatarUrl from '../../assets/assistant-avatar.png';

type AssistantLauncherProps = {
  variant: 'header' | 'floating';
  onOpen: () => void;
  /** New hints to show on the avatar. 0 hides the badge and the bubble. */
  hints?: number;
};

const BUBBLE_MS = 6000;

export function AssistantLauncher({ variant, onOpen, hints = 0 }: AssistantLauncherProps): React.JSX.Element {
  const [seen, setSeen] = useState(0);
  const bubble = variant === 'floating' && hints > 0 && seen !== hints;
  useEffect(() => {
    if (!bubble) return undefined;
    const timer = window.setTimeout(() => setSeen(hints), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [bubble, hints]);

  const label = variant === 'header' ? 'Открыть ассистента' : 'Открыть ассистента (кнопка в углу плана)';
  return (
    <div className={`assistant-launcher assistant-launcher--${variant}`}>
      {bubble ? (
        <span className="assistant-launcher__bubble" role="status">
          Есть новые подсказки: {hints}
        </span>
      ) : null}
      <button
        type="button"
        className="assistant-launcher__button"
        aria-label={label}
        title="Ассистент: где поставить, чего не хватает, что изменилось"
        onClick={onOpen}
      >
        <img className="assistant-launcher__avatar" src={avatarUrl} alt="" width={96} height={96} />
        {hints > 0 ? <span className="assistant-launcher__badge" aria-hidden="true">{hints}</span> : null}
        {variant === 'header' ? <span className="assistant-launcher__name">Ассистент</span> : null}
      </button>
    </div>
  );
}
