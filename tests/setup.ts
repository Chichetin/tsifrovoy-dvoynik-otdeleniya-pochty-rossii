/**
 * Окружение unit-тестов: jsdom не реализует ResizeObserver, а холст редактора
 * узнаёт свой размер только через него. Шим ничего не измеряет — он лишь даёт
 * компоненту смонтироваться; реальные размеры проверяются в браузере (e2e).
 */

class ResizeObserverShim implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverShim,
    writable: true,
  });
}
