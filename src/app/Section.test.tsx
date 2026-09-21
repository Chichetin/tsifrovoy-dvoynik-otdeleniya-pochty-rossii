// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Section } from './Section';

afterEach(() => {
  cleanup();
});

test('open section: header announces expanded, content is in the DOM without `hidden`', () => {
  render(
    <Section id="validation" title="Проверка" summary="3 находки" collapsed={false} onToggle={() => {}}>
      <p>содержимое проверки</p>
    </Section>,
  );
  const header = screen.getByRole('button', { name: /Проверка.*3 находки/ });
  expect(header.getAttribute('aria-expanded')).toBe('true');
  const content = screen.getByText('содержимое проверки');
  expect(content.closest('[hidden]')).toBeNull();
});

test('collapsed section: header announces collapsed, content stays in the DOM but hidden', () => {
  render(
    <Section id="validation" title="Проверка" summary="3 находки" collapsed onToggle={() => {}}>
      <p>содержимое проверки</p>
    </Section>,
  );
  const header = screen.getByRole('button', { name: /Проверка.*3 находки/ });
  expect(header.getAttribute('aria-expanded')).toBe('false');
  // In the DOM, not unmounted — `getByText` would throw if it were gone.
  const content = screen.getByText('содержимое проверки');
  expect(content.closest('[hidden]')).not.toBeNull();
});

test('the header is a real button: click and Enter/Space call onToggle', () => {
  const onToggle = vi.fn();
  render(
    <Section id="validation" title="Проверка" summary="3 находки" collapsed={false} onToggle={onToggle}>
      <p>содержимое</p>
    </Section>,
  );
  const header = screen.getByRole('button', { name: /Проверка/ });
  fireEvent.click(header);
  expect(onToggle).toHaveBeenCalledTimes(1);

  // A native <button> fires a click on Enter/Space itself in a real browser;
  // jsdom does not simulate that, so the keyboard path is proven in
  // tests/e2e/right-column.spec.ts instead. Here we only prove it is a
  // <button>, which is what makes that native behaviour available at all.
  expect(header.tagName).toBe('BUTTON');
});

test('summaryTone="error" marks the summary; omitted keeps the neutral class (D-226)', () => {
  const { rerender } = render(
    <Section id="validation" title="Проверка" summary="2 находки" collapsed={false} onToggle={() => {}}>
      <p>содержимое</p>
    </Section>,
  );
  const summary = () => screen.getByText('2 находки');
  expect(summary().className).toBe('section__summary');

  rerender(
    <Section id="validation" title="Проверка" summary="2 находки" summaryTone="error" collapsed={false} onToggle={() => {}}>
      <p>содержимое</p>
    </Section>,
  );
  expect(summary().className).toBe('section__summary is-error');
});

test('aria-controls points at the content element that carries the same id', () => {
  render(
    <Section id="inventory" title="Инвентаризация" summary="53 объекта" collapsed={false} onToggle={() => {}}>
      <p>перечень</p>
    </Section>,
  );
  const header = screen.getByRole('button', { name: /Инвентаризация/ });
  const controls = header.getAttribute('aria-controls');
  expect(controls).not.toBeNull();
  const content = document.getElementById(controls!);
  expect(content).not.toBeNull();
  expect(content!.contains(screen.getByText('перечень'))).toBe(true);
});
