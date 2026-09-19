// @vitest-environment jsdom
/**
 * UX №2: что видит и может сделать человек в окне обучения.
 *
 * Подсвеченные панели здесь — обычные элементы с `data-tour`, как их помечает
 * приложение; их размеры подставлены, потому что jsdom ничего не раскладывает.
 * Расположение в настоящем браузере проверяет `tests/e2e/onboarding.spec.ts`.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Onboarding } from './Onboarding';
import { TOUR_STEPS, type TourOutcome } from './tour';

function box(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

/** Panels as the app marks them; `files` is a display:contents wrapper, like in App.tsx. */
function markPanels(): void {
  document.body.innerHTML = `
    <div data-tour="files" style="display: contents"><div id="files-group"></div><div id="files-messages"></div></div>
    <div data-tour="tools" id="tools"></div>
    <aside data-tour="side-left" id="left"></aside>
    <aside data-tour="side-right" id="right"></aside>`;
  box(document.getElementById('files-group')!, 1000, 8, 300, 30);
  box(document.getElementById('files-messages')!, 0, 40, 1440, 20);
  box(document.getElementById('tools')!, 200, 8, 500, 30);
  box(document.getElementById('left')!, 0, 80, 260, 820);
  box(document.getElementById('right')!, 1100, 80, 340, 820);
}

function renderTour(onClose: (outcome: TourOutcome) => void = () => {}) {
  const host = document.createElement('div');
  document.body.append(host);
  return render(<Onboarding open onClose={onClose} />, { container: host });
}

/** The tour measures panels on the next animation frame, after layout. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

function rings(): { target: string | null; x: number; width: number }[] {
  return screen.queryAllByTestId('onboarding-ring').map((ring) => ({
    target: ring.getAttribute('data-target'),
    x: Number(ring.getAttribute('x')),
    width: Number(ring.getAttribute('width')),
  }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('окно обучения', () => {
  test('закрытое ничего не рисует', () => {
    render(<Onboarding open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('диалог с подписью, фокус на нём, первый шаг из четырёх', () => {
    renderTour();
    const dialog = screen.getByRole('dialog', { name: 'Обучение' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(dialog.textContent).toContain(`Шаг 1 из ${TOUR_STEPS.length}`);
    expect(dialog.textContent).toContain(TOUR_STEPS[0]!.title);
  });

  test('«Пропустить» есть на каждом шаге, «Готово» — только на последнем', () => {
    renderTour();
    for (let index = 0; index < TOUR_STEPS.length; index += 1) {
      expect(screen.getByRole('button', { name: 'Пропустить' })).toBeTruthy();
      const last = index === TOUR_STEPS.length - 1;
      expect(screen.queryByRole('button', { name: 'Готово' }) !== null).toBe(last);
      expect(screen.queryByRole('button', { name: 'Далее' }) !== null).toBe(!last);
      if (!last) fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    }
    expect(screen.getByRole('dialog').textContent).toContain(TOUR_STEPS.at(-1)!.title);
  });

  test('«Назад» возвращает на прошлый шаг и недоступна на первом', () => {
    renderTour();
    const back = (): HTMLButtonElement => screen.getByRole('button', { name: 'Назад' });
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByRole('dialog').textContent).toContain(TOUR_STEPS[1]!.title);
    expect(back().disabled).toBe(false);
    fireEvent.click(back());
    expect(screen.getByRole('dialog').textContent).toContain(TOUR_STEPS[0]!.title);
  });

  test('«Готово» закрывает с итогом done, «Пропустить» — skipped', () => {
    const onClose = vi.fn();
    renderTour(onClose);
    for (let index = 1; index < TOUR_STEPS.length; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onClose).toHaveBeenCalledWith('done');

    cleanup();
    const onSkip = vi.fn();
    renderTour(onSkip);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
    expect(onSkip).toHaveBeenCalledWith('skipped');
  });

  test('Escape — то же, что «Пропустить», откуда бы ни пришло нажатие', () => {
    const onClose = vi.fn();
    renderTour(onClose);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('skipped');
  });

  test('пока окно открыто, клавиши редактора до него не доходят; после закрытия — снова доходят', () => {
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    try {
      const view = renderTour();
      fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'z', code: 'KeyZ', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 'f', code: 'KeyF' });
      expect(editor).not.toHaveBeenCalled();

      view.rerender(<Onboarding open={false} onClose={() => {}} />);
      fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' });
      expect(editor).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', editor);
    }
  });

  test('Tab ходит по кнопкам внутри окна и не уходит на план', () => {
    renderTour();
    const skip = screen.getByRole('button', { name: 'Пропустить' });
    const next = screen.getByRole('button', { name: 'Далее' });
    // «Назад» на первом шаге выключена и в обход не входит.
    next.focus();
    fireEvent.keyDown(next, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(skip, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(next);
  });

  test('закрытие возвращает фокус туда, где он был', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<Onboarding open onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    view.rerender(<Onboarding open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(opener);
  });

  test('повторное открытие начинается с первого шага', () => {
    const view = render(<Onboarding open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    view.rerender(<Onboarding open={false} onClose={() => {}} />);
    view.rerender(<Onboarding open onClose={() => {}} />);
    expect(screen.getByRole('dialog').textContent).toContain('Шаг 1 из');
  });
});

describe('подсветка панели', async () => {
  test('каждый шаг обводит свои панели', async () => {
    markPanels();
    renderTour();
    await nextFrame();
    expect(rings().map((ring) => ring.target)).toEqual(['files']);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await nextFrame();
    expect(rings().map((ring) => ring.target)).toEqual(['tools', 'side-left']);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    await nextFrame();
    expect(rings().map((ring) => ring.target)).toEqual(['side-right']);
  });

  test('обёртка display: contents обводится по первому видимому элементу, а не по всей строке сообщений', async () => {
    markPanels();
    renderTour();
    await nextFrame();
    const [files] = rings();
    // Кольцо на 4 px шире самой группы с каждой стороны.
    expect(files).toEqual({ target: 'files', x: 996, width: 308 });
  });

  test('окно ресайзнули — кольцо пересчитано', async () => {
    markPanels();
    renderTour();
    await nextFrame();
    box(document.getElementById('files-group')!, 900, 8, 300, 30);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(rings()[0]?.x).toBe(896);
  });

  test('панели нет на экране — шаг показывается без подсветки и не падает', async () => {
    renderTour();
    await nextFrame();
    expect(rings()).toEqual([]);
    expect(screen.getByRole('dialog').textContent).toContain(TOUR_STEPS[0]!.title);
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByRole('dialog').textContent).toContain(TOUR_STEPS[1]!.title);
  });

  test('панель нулевого размера (скрыта) не подсвечивается', async () => {
    markPanels();
    box(document.getElementById('files-group')!, 0, 0, 0, 0);
    box(document.getElementById('files-messages')!, 0, 0, 0, 0);
    renderTour();
    await nextFrame();
    expect(rings()).toEqual([]);
  });
});
