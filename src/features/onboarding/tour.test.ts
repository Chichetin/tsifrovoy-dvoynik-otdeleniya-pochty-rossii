/**
 * UX №2: правила мини-обучения без DOM — какие шаги, когда показывать, куда
 * ставить карточку. Факт показа живёт только в localStorage, а хранилище в
 * браузере может отказать на любом вызове: обучение от этого не падает.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ONBOARDING_KEY,
  TOUR_STEPS,
  browserStorage,
  nextStep,
  placeCard,
  previousStep,
  rememberTour,
  shouldShowTour,
  type TourStorage,
} from './tour';

/** In-memory storage whose calls can be made to throw. */
function memoryStorage(fail: { get?: boolean; set?: boolean } = {}): TourStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      if (fail.get === true) throw new Error('SecurityError');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (fail.set === true) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('шаги обучения', () => {
  test('от трёх до четырёх шагов, у каждого заголовок, текст и хотя бы одна панель', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(4);
    for (const step of TOUR_STEPS) {
      expect(step.title.trim()).not.toBe('');
      expect(step.text.trim()).not.toBe('');
      expect(step.targets.length).toBeGreaterThan(0);
    }
  });

  test('идут по сценарию проверяющего: открыть → изменить → проверить → сохранить и открыть заново', () => {
    const [open, edit, check, save] = TOUR_STEPS;
    expect(open?.text).toContain('«Файл → Демо-планы»');
    expect(open?.text).toContain('«Файл → Создать новый»');
    expect(edit?.targets).toContain('tools');
    expect(check?.text).toContain('Ассистент');
    expect(save?.text).toContain('«Сохранить план»');
    expect(save?.text).toContain('Файл → Открыть существующий');
    expect(save?.targets).toEqual(['files']);
  });

  test('последний шаг говорит, как пройти обучение снова', () => {
    expect(TOUR_STEPS.at(-1)?.text).toContain('«Обучение»');
  });

  test('«Далее» и «Назад» не выходят за шаги', () => {
    expect(nextStep(0, 4)).toBe(1);
    expect(nextStep(3, 4)).toBe(3);
    expect(previousStep(1)).toBe(0);
    expect(previousStep(0)).toBe(0);
  });
});

describe('факт показа — только в localStorage', () => {
  test('ключ версионирован и с префиксом проекта', () => {
    expect(ONBOARDING_KEY).toBe('ops-twin.onboarding.v1');
  });

  test('первый вход показывает обучение, после завершения — больше нет', () => {
    const storage = memoryStorage();
    expect(shouldShowTour(storage)).toBe(true);
    expect(rememberTour(storage, 'done')).toBe(true);
    expect(storage.data.get(ONBOARDING_KEY)).toBe('done');
    expect(shouldShowTour(storage)).toBe(false);
  });

  test('«Пропустить» тоже запоминается', () => {
    const storage = memoryStorage();
    rememberTour(storage, 'skipped');
    expect(storage.data.get(ONBOARDING_KEY)).toBe('skipped');
    expect(shouldShowTour(storage)).toBe(false);
  });

  test('отметка другой версии обучения не считается: новое обучение показывается', () => {
    const storage = memoryStorage();
    storage.setItem('ops-twin.onboarding.v0', 'done');
    expect(shouldShowTour(storage)).toBe(true);
  });

  test('хранилища нет — обучение показывается, запись просто не удаётся', () => {
    expect(shouldShowTour(null)).toBe(true);
    expect(rememberTour(null, 'done')).toBe(false);
  });

  test('чтение бросает — обучение показывается, исключение не выходит наружу', () => {
    expect(shouldShowTour(memoryStorage({ get: true }))).toBe(true);
  });

  test('запись бросает — rememberTour возвращает false, а не падает', () => {
    expect(rememberTour(memoryStorage({ set: true }), 'skipped')).toBe(false);
  });

  test('browserStorage: доступ к window.localStorage бросает (приватный режим) — null', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(browserStorage()).toBeNull();
  });

  test('browserStorage: хранилище есть — оно и возвращается', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(browserStorage()).toBe(storage);
  });
});

describe('где стоит карточка', () => {
  const screen = { width: 1440, height: 900 };
  const card = { width: 360, height: 200 };

  test('без подсветки — по центру экрана', () => {
    expect(placeCard([], card, screen)).toEqual({ left: 540, top: 350 });
  });

  test('под узкой панелью шапки, если снизу есть место', () => {
    const files = { left: 1000, top: 8, width: 300, height: 30 };
    expect(placeCard([files], card, screen)).toEqual({ left: 1000, top: 8 + 30 + 12 });
  });

  test('над панелью, если снизу места нет', () => {
    const low = { left: 100, top: 800, width: 300, height: 60 };
    expect(placeCard([low], card, screen)).toEqual({ left: 100, top: 800 - 12 - 200 });
  });

  test('справа от высокой левой панели', () => {
    const left = { left: 0, top: 80, width: 260, height: 820 };
    expect(placeCard([left], card, screen)).toEqual({ left: 260 + 12, top: 80 });
  });

  test('слева от высокой правой панели', () => {
    const right = { left: 1100, top: 80, width: 340, height: 820 };
    expect(placeCard([right], card, screen)).toEqual({ left: 1100 - 12 - 360, top: 80 });
  });

  test('среди нескольких панелей карточка встаёт у высокой: полоса инструментов не толкает её на боковую панель', () => {
    const tools = { left: 208, top: 8, width: 490, height: 30 };
    const left = { left: 0, top: 130, width: 262, height: 770 };
    expect(placeCard([tools, left], card, screen)).toEqual({ left: 262 + 12, top: 130 });
  });

  test('не вылезает за правый край экрана', () => {
    const edge = { left: 1300, top: 8, width: 130, height: 30 };
    expect(placeCard([edge], card, screen).left).toBe(1440 - 12 - 360);
  });

  test('на экране меньше карточки прижимается к левому верхнему углу, а не уходит в минус', () => {
    expect(placeCard([], card, { width: 300, height: 150 })).toEqual({ left: 12, top: 12 });
  });
});
