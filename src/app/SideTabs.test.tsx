// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { SideTabs } from './SideTabs';
import { RIGHT_TABS, type RightTab } from './side-tabs';

afterEach(() => {
  cleanup();
});

function Harness({ start = 'assistant' as RightTab }: { start?: RightTab }): React.JSX.Element {
  const [active, setActive] = useState<RightTab>(start);
  return (
    <SideTabs
      label="Панели справа"
      idPrefix="right"
      tabs={RIGHT_TABS}
      active={active}
      onSelect={setActive}
      badges={{ validation: { text: '3', tone: 'error' } }}
      panels={{
        assistant: <p>панель ассистента</p>,
        metrics: <p>панель площадей</p>,
        validation: <p>панель проверки</p>,
        inventory: <p>панель инвентаризации</p>,
        catalog: <p>панель справочника</p>,
      }}
    />
  );
}

test('shows only the active panel; the others stay mounted but hidden', () => {
  render(<Harness />);
  expect(screen.getByRole('tablist', { name: 'Панели справа' })).toBeTruthy();
  const tab = screen.getByRole('tab', { name: 'Ассистент' });
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(tab.getAttribute('tabindex')).toBe('0');
  expect(screen.getByText('панель ассистента').closest('[hidden]')).toBeNull();
  expect(screen.getByText('панель проверки').closest('[hidden]')).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'Площади' }).getAttribute('tabindex')).toBe('-1');
});

test('a click switches the panel', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: /Проверка/ }));
  expect(screen.getByRole('tab', { name: /Проверка/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Ассистент' }).getAttribute('aria-selected')).toBe('false');
  expect(screen.getByText('панель проверки').closest('[hidden]')).toBeNull();
  expect(screen.getByText('панель ассистента').closest('[hidden]')).not.toBeNull();
});

test('arrow keys move selection and focus together', () => {
  render(<Harness />);
  const first = screen.getByRole('tab', { name: 'Ассистент' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowLeft' });
  const last = screen.getByRole('tab', { name: 'Справочник' });
  expect(last.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'ArrowRight' });
  expect(first.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(first);
});

test('the badge is part of the tab name and carries the error tone', () => {
  render(<Harness />);
  const tab = screen.getByRole('tab', { name: 'Проверка 3' });
  expect(tab.querySelector('.side-tabs__badge.is-error')?.textContent).toBe('3');
  expect(tab.getAttribute('aria-controls')).toBe('right-panel-validation');
});
