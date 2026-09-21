/**
 * A clear, persistent entry point to the operational assistant.
 *
 * The assistant's form/chat stays in the right column. This small launcher
 * only opens that existing section, so it does not create a second request
 * flow or own any advice state.
 */

import avatarUrl from '../../assets/assistant-avatar.png';

type AssistantLauncherProps = {
  onOpen: () => void;
};

export function AssistantLauncher({ onOpen }: AssistantLauncherProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="assistant-launcher"
      aria-label="Открыть ассистента"
      title="Открыть ассистента"
      onClick={onOpen}
    >
      <img className="assistant-launcher__avatar" src={avatarUrl} alt="" />
      <span className="assistant-launcher__copy">
        <b>Ассистент</b>
        <small>Подсказки по плану</small>
      </span>
    </button>
  );
}
