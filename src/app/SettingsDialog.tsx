/**
 * D-350: «Настройки» — what is set up once per plan and then left alone:
 * the plan's name and ceiling height, the equipment and zone types and the
 * kit rules. They used to be spread over the room card and the «Справочник»
 * tab; the side columns now keep only what is used while working.
 *
 * Every edit is a command applied at once, as in the card: the plan behind
 * updates, nothing waits for an «OK». Ctrl+Z does not reach the history while
 * the window is open (the keys stay inside); each edit undoes after closing.
 *
 * Modal to the keyboard the same way as `HotkeysMapDialog`: a capture-phase
 * listener on `window` runs before the editor's bubble-phase listeners and
 * stops the event, so Delete or R typed here never reaches the plan behind;
 * Tab cycles inside. `onClose` must be a stable reference for the same
 * reason as there.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Command } from '../contracts/commands';
import type { PlanDocument } from '../contracts/model';
import type { CommandSink, EditorSession, SelectSink } from '../contracts/ui';
import { CatalogPanel, type CatalogSection } from '../features/catalog-editor/CatalogPanel';
import { LayersPanel } from '../features/layers/LayersPanel';

type SettingsSection = 'plan' | CatalogSection | 'layers';

const SECTIONS: readonly { id: SettingsSection; title: string; note: string }[] = [
  { id: 'plan', title: 'План', note: 'Название и высота потолка помещения.' },
  { id: 'objects', title: 'Оборудование', note: 'Типы оборудования и их атрибуты — справочник в файле плана, меняется без правки кода.' },
  { id: 'zones', title: 'Зоны', note: 'Типы зон и их атрибуты — справочник в файле плана, меняется без правки кода.' },
  { id: 'rules', title: 'Правила', note: 'Сколько оборудования должно быть в зоне. Правила — допущения команды, не нормативы Почты.' },
  { id: 'layers', title: 'Слои', note: 'Какие слои есть в плане и в каком порядке. Показать, скрыть и запереть слой — во вкладке «Слои».' },
];

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  document: PlanDocument;
  onCommand: CommandSink;
  session: EditorSession;
  onSelect: SelectSink;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Collapsed list rows keep their buttons in the DOM under `hidden`: those are not in the Tab order. */
function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.closest('[hidden]') === null);
}

function parseNumber(input: string): number | null {
  if (input.trim() === '') return null;
  const value = Number(input.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

type PlanField = 'name' | 'ceiling';

/** The fields that were in the room card, with its discipline: a refused value stays with its reason. */
function PlanSection({ document: plan, onCommand }: { document: PlanDocument; onCommand: CommandSink }): React.JSX.Element {
  const [draft, setDraft] = useState<Partial<Record<PlanField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<PlanField, string>>>({});

  const commit = (field: PlanField, command: Command | null, raw: string): void => {
    setDraft((current) => ({ ...current, [field]: raw }));
    if (command === null) {
      setErrors((current) => ({ ...current, [field]: 'Нужно число.' }));
      return;
    }
    const result = onCommand(command);
    if (result.ok) {
      setDraft((current) => ({ ...current, [field]: undefined }));
      setErrors((current) => ({ ...current, [field]: undefined }));
      return;
    }
    setErrors((current) => ({ ...current, [field]: result.issues.map((issue) => issue.message).join(' ') }));
  };

  const field = (name: PlanField, label: string, input: React.JSX.Element, hint: string): React.JSX.Element => (
    <label className="props__field">
      <span className="props__label">{label}</span>
      {input}
      <span className="props__hint">{hint}</span>
      {errors[name] === undefined ? null : (
        <span className="props__error" role="alert">
          {errors[name]}
        </span>
      )}
    </label>
  );

  return (
    <div className="settings__fields">
      {field(
        'name',
        'Название плана',
        <input
          type="text"
          aria-label="Название плана"
          value={draft.name ?? plan.name}
          onChange={(event) =>
            commit('name', { type: 'plan.rename', name: event.target.value }, event.target.value)
          }
        />,
        'так будет называться файл при сохранении; то же название — в шапке',
      )}
      {field(
        'ceiling',
        'Высота потолка, м',
        <input
          type="number"
          step={0.1}
          aria-label="Высота потолка, м"
          value={draft.ceiling ?? String(plan.room.ceilingHeight_m)}
          onChange={(event) => {
            const parsed = parseNumber(event.target.value);
            commit(
              'ceiling',
              parsed === null ? null : { type: 'room.setCeiling', ceilingHeight_m: parsed },
              event.target.value,
            );
          }}
        />,
        'наружные стены поднимаются вместе с потолком; перегородки — по своей карточке',
      )}
    </div>
  );
}

export function SettingsDialog({ open, onClose, document: plan, onCommand, session, onSelect }: SettingsDialogProps): React.JSX.Element | null {
  const [section, setSection] = useState<SettingsSection>('plan');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus moves into the dialog and comes back to whatever opened it.
  useEffect(() => {
    if (!open) return;
    const opener = window.document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.code === 'Escape' || event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const at = items.indexOf(window.document.activeElement as HTMLElement);
      const target = event.shiftKey
        ? at <= 0 ? items.at(-1)! : items[at - 1]!
        : at === -1 || at === items.length - 1 ? items[0]! : items[at + 1]!;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  const current = SECTIONS.find((item) => item.id === section)!;

  return (
    // A press that starts outside closes; a text selection dragged out of a field does not.
    <div
      className="settings"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="settings__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="settings__header">
          <h2 id={titleId} className="settings__title">
            Настройки
          </h2>
          <button type="button" className="settings__close" aria-label="Закрыть настройки" title="Закрыть (Esc)" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="settings__body">
          <nav className="settings__nav" aria-label="Разделы настроек">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="settings__section"
                aria-current={item.id === section}
                onClick={() => setSection(item.id)}
              >
                {item.title}
              </button>
            ))}
          </nav>
          <div className="settings__content">
            <h3 className="settings__heading">{current.title}</h3>
            <p className="panel__note">{current.note}</p>
            {section === 'plan' ? (
              <PlanSection document={plan} onCommand={onCommand} />
            ) : section === 'layers' ? (
              <LayersPanel document={plan} session={session} onCommand={onCommand} onSelect={onSelect} mode="setup" />
            ) : (
              <CatalogPanel key={section} document={plan} onCommand={onCommand} section={section} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
