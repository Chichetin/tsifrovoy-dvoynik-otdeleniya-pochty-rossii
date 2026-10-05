/**
 * Entry point to the assistant: a round avatar floating in the canvas corner.
 * It only switches the right column to the assistant tab; no advice state
 * lives here.
 */

import { useEffect, useState } from 'react';
import avatarUrl from '../../assets/assistant-avatar.png';

type AssistantLauncherProps = {
  onOpen: () => void;
  /** New hints to show on the avatar. 0 hides the badge and the bubble. */
  hints?: number;
};

const BUBBLE_MS = 6000;

export function AssistantLauncher({ onOpen, hints = 0 }: AssistantLauncherProps): React.JSX.Element {
  const [seen, setSeen] = useState(0);
  const bubble = hints > 0 && seen !== hints;
  useEffect(() => {
    if (!bubble) return undefined;
    const timer = window.setTimeout(() => setSeen(hints), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [bubble, hints]);

  return (
    <div className="assistant-launcher">
      {bubble ? (
        <span className="assistant-launcher__bubble" role="status">
          Есть новые подсказки: {hints}
        </span>
      ) : null}
      <button
        type="button"
        className="assistant-launcher__button"
        aria-label="Открыть ассистента"
        title="Ассистент: где поставить, чего не хватает, что изменилось"
        onClick={onOpen}
      >
        <img className="assistant-launcher__avatar" src={avatarUrl} alt="" width={96} height={96} />
        {hints > 0 ? <span className="assistant-launcher__badge" aria-hidden="true">{hints}</span> : null}
      </button>
    </div>
  );
}
