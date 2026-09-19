/**
 * UX №2: the first-run tour — a few steps over the real panels.
 *
 * The component knows only the steps and the `data-tour` marks the app puts on
 * its panels; it imports no other module. Whether to open it is the app's call
 * (`shouldShowTour`), and how it ended goes back through `onClose`.
 *
 * While open the tour is modal (D-191): the shade takes the mouse, and the
 * keyboard belongs to the card — Escape skips, Tab walks its buttons, Enter and
 * Space press them, and no key reaches the editor's window listeners, so F,
 * Delete or Ctrl+Z cannot change the plan behind the card.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { targetBoxes, type TargetBox } from './anchor';
import { TOUR_STEPS, nextStep, placeCard, previousStep, type Size, type TourOutcome, type TourStep } from './tour';

export type OnboardingProps = {
  open: boolean;
  onClose: (outcome: TourOutcome) => void;
  steps?: readonly TourStep[];
};

/** The ring stands this far outside the panel, px. */
const RING_PAD = 4;
const CARD_WIDTH = 360;
const MASK_ID = 'onboarding-mask';

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.disabled);
}

/** Closed renders nothing; every opening mounts the card afresh, from step one. */
export function Onboarding({ open, onClose, steps = TOUR_STEPS }: OnboardingProps): React.JSX.Element | null {
  return open ? <TourCard onClose={onClose} steps={steps} /> : null;
}

function TourCard({ onClose, steps }: Required<Omit<OnboardingProps, 'open'>>): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [boxes, setBoxes] = useState<TargetBox[]>([]);
  const [screen, setScreen] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [cardSize, setCardSize] = useState<Size>({ width: CARD_WIDTH, height: 0 });
  const dialog = useRef<HTMLDivElement>(null);
  const current = steps[Math.min(step, steps.length - 1)]!;
  const last = step >= steps.length - 1;

  const measure = useCallback(() => {
    setBoxes(targetBoxes(document, current.targets));
    setScreen({ width: window.innerWidth, height: window.innerHeight });
    const card = dialog.current;
    if (card !== null) setCardSize({ width: card.offsetWidth || CARD_WIDTH, height: card.offsetHeight });
  }, [current]);

  // Measured on the next frame, when the panels of the same first render are
  // laid out, and again on every resize of the window.
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // Focus goes to the card on opening and comes back where it was on closing.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  useEffect(() => {
    dialog.current?.focus();
  }, [step]);

  // Capture phase on window runs ahead of every editor listener but the ones
  // registered earlier in the same phase (EditorCanvas' Escape — it only drops
  // the selection); stopping here keeps the rest of the editor deaf. Default
  // actions stay, so Enter and Space still press the focused button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose('skipped');
        return;
      }
      const card = dialog.current;
      if (event.key !== 'Tab' || card === null) return;
      const items = focusables(card);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const target = event.shiftKey
        ? at <= 0 ? items.at(-1)! : items[at - 1]!
        : at === -1 || at === items.length - 1 ? items[0]! : items[at + 1]!;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const position = placeCard(boxes, cardSize, screen);
  const rings = boxes.map((box) => ({
    target: box.target,
    x: box.left - RING_PAD,
    y: box.top - RING_PAD,
    width: box.width + 2 * RING_PAD,
    height: box.height + 2 * RING_PAD,
  }));

  return (
    <div
      className="onboarding"
      data-testid="onboarding"
      // The shade is not a button: a stray click must not steal focus from the card.
      onMouseDown={(event) => {
        if (!dialog.current?.contains(event.target as Node)) event.preventDefault();
      }}
    >
      <svg className="onboarding__shade" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id={MASK_ID}>
            <rect width="100%" height="100%" fill="white" />
            {rings.map((ring) => (
              <rect key={ring.target} x={ring.x} y={ring.y} width={ring.width} height={ring.height} rx={6} fill="black" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" className="onboarding__dim" mask={`url(#${MASK_ID})`} />
        {rings.map((ring) => (
          <rect
            key={ring.target}
            data-testid="onboarding-ring"
            data-target={ring.target}
            className="onboarding__ring"
            x={ring.x}
            y={ring.y}
            width={ring.width}
            height={ring.height}
            rx={6}
          />
        ))}
      </svg>

      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Обучение"
        aria-describedby="onboarding-text"
        tabIndex={-1}
        className="onboarding__card"
        style={{ left: position.left, top: position.top, width: CARD_WIDTH }}
      >
        <p className="onboarding__count">
          Шаг {step + 1} из {steps.length}
        </p>
        <h2 className="onboarding__title">{current.title}</h2>
        <p id="onboarding-text" className="onboarding__text">
          {current.text}
        </p>
        <div className="onboarding__actions">
          <button type="button" className="files__button" onClick={() => onClose('skipped')}>
            Пропустить
          </button>
          <span className="onboarding__spacer" />
          <button
            type="button"
            className="files__button"
            disabled={step === 0}
            onClick={() => setStep(previousStep(step))}
          >
            Назад
          </button>
          {last ? (
            <button type="button" className="files__button is-primary" onClick={() => onClose('done')}>
              Готово
            </button>
          ) : (
            <button
              type="button"
              className="files__button is-primary"
              onClick={() => setStep(nextStep(step, steps.length))}
            >
              Далее
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
