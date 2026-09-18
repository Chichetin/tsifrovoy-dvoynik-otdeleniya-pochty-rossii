/**
 * D01: есть ли в этом браузере WebGL — вопрос, который задаётся один раз.
 *
 * Проба создаёт контекст на временном canvas, и это настоящий контекст GPU:
 * браузер держит их считанное число (обычно около 16) и, дойдя до предела,
 * отбирает самый старый — то есть как раз тот, на котором рисуется сцена.
 * Поэтому проба отдаёт взятое обратно через `WEBGL_lose_context`, а ответ
 * запоминается на сессию: WebGL не появляется и не исчезает, пока страница
 * открыта, а каждое переключение «2D / 3D» не должно стоить контекста.
 */

/** Ответ за сессию страницы; `null` — ещё не спрашивали. */
let known: boolean | null = null;

/** Спрашивает браузер и сразу отпускает контекст. Ничего не бросает. */
export function probeWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context === null) return false;
    // Контекст был нужен только ради ответа «да» — держать его незачем.
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Тот же ответ, но браузер спрашивается один раз за жизнь страницы. */
export function hasWebgl(): boolean {
  if (known === null) known = probeWebgl();
  return known;
}
