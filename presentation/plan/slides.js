/* Variant G «План»: slide content for the defense deck, written from the plan (PRESENTATION_PLAN, 06.10.2026).
   14 main slides (s1–s14: s10 architecture and s14 demo come from ../shared/slides.js) and 7 backup slides (b1–b7, key Q or ↓). Backup facts come from ../shared/slides.js.
   Screenshots that exist in ../assets/shots are used. A missing one is a framed slot with its file name:
   capture it on the demo plan at the defense SHA, put the .webp into ../assets/shots and add the name to SHOTS.
   Hooks for motion are described at the top of ../shared/motion-core.js. */
(() => {
  const ln = (text) => `<span class="ln"><span>${text}</span></span>`;
  const note = (text) => `<aside class="speaker-note" hidden>${text}</aside>`;
  const title = (a, b) => `<h2 class="title">${ln(a)}${ln(b)}</h2>`;
  const team = [
    ['Александр Чичерин', 'тим-лид'],
    ['Иван Резников', 'капитан'],
    ['Максим Седов', 'разработчик'],
    ['Иван Пушкин', 'разработчик'],
    ['Александр Лесницкий', 'разработчик'],
  ];

  // slot name -> file in ../assets/shots. Names from the plan that have no file yet stay slots.
  // Shots from 06.10: demo plan and the 3D showroom, local main, viewport 1600×900.
  const SHOTS = {
    'plan-2d': 'plan-check',
    'plan-check': 'plan-check',
    'editor-offsets': 'editor-drag',
    'view-3d': 'view-3d',
    'layers-cameras': 'layers-cameras',
    'layers-heat': 'layers-heat',
    'layers-state': 'layers-state',
    silhouette: 'silhouette',
    'silhouette-red': 'silhouette-red',
    'context-menu': 'context-menu',
    'why-card': 'why-card',
    'apply-fix': 'apply-fix',
    inventory: 'inventory',
    checklist: 'checklist',
    catalog: 'catalog',
    'shape-edit': 'shape-edit',
    assistant: 'assistant',
    'assistant-journal': 'assistant-journal',
    'voice-input': 'voice-input',
    showroom: 'showroom',
    'print-sheet': 'print-sheet',
    versions: 'versions',
    'walk-3d': 'walk-3d',
    'smart-place': 'smart-place',
    'tour-card': 'tour-card',
    'csv-export': 'csv-export',
    hotkeys: 'hotkeys',
  };
  const frame = (name, alt, cls = '') => (SHOTS[name]
    ? `<figure class="view ${cls}"><img src="../assets/shots/${SHOTS[name]}.webp" alt="${alt}"></figure>`
    : `<figure class="view ph ${cls}" role="img" aria-label="${alt}"><span>Снимок</span><b>${name}</b></figure>`);

  const tiles = [
    ['Голосовой вопрос', 'Спросите ассистента голосом', 'voice-input'],
    ['Шоурум 3D', '28 моделей; 3 добавлены только данными', 'showroom'],
    ['Печать в масштабе', 'A4/A3, 1:50 или 1:100, легенда и штамп', 'print-sheet'],
    ['Версии плана', '«До перепланировки» откроется позже', 'versions'],
    ['Ходьба в 3D', 'Пройдите по залу от первого лица', 'walk-3d'],
    ['Умная постановка', 'Монитор берёт высоту стола, щит разворачивается в зал', 'smart-place'],
    ['Обучение', 'Короткий тур при первом входе', 'tour-card'],
    ['Выгрузка CSV', 'Инвентаризация — в таблицу одним кликом', 'csv-export'],
    ['Горячие клавиши', 'Карта по «?», поворот на 1°', 'hotkeys'],
  ];

  // s10: what reads the document and what it is built with. None keeps a copy of the plan.
  const reads = [
    ['r1', '2D и 3D', 'React + Konva · Three.js'],
    ['r2', 'Инвентаризация', 'TypeScript · выгрузка CSV'],
    ['r3', 'Площади', 'polyclip-ts · объединение'],
    ['r4', 'Проверка', 'TypeScript · тесты Vitest'],
    ['r5', 'Ассистент', 'DeepSeek · Yandex AI Studio'],
  ];

  const checks = ['пересечения', 'выход за помещение', 'стена', 'загороженная дверь', 'техника без стола', 'повтор инвентарного номера', 'комплектование'];
  const layers = ['Камеры и зоны обзора', 'Тепловая нагрузка', 'Сотрудники по зонам', 'Очередь по зонам', 'Состояние оборудования'];

  const html = `
<!-- s1 ТИТУЛ + КОМАНДА -->
<section class="slide s-title" id="s1" data-kind="main" data-title="Титул" aria-label="Титул">
  <p class="eyebrow in">PostCode Challenge от Почтатеха</p>
  <h1 class="title big">${ln('ИИ-бланки')}${ln('Цифровой двойник ОПС')}</h1>
  <p class="lead in">Один план отделения — редактор, инвентаризация, проверка, ассистент и 3D</p>
  <ul class="team-strip in" aria-label="Команда «ИИ-бланки»">
    ${team.map(([name, role]) => `<li><b>${name}</b><span>${role}</span></li>`).join('')}
  </ul>
  <img class="cat-title" src="../assets/brand/cat-laptop.webp" alt="">
  ${note('Здравствуйте. Мы — команда «ИИ-бланки». Мы сделали цифровой двойник отделения Почты России. Покажем, что он умеет и почему ему можно верить.')}
</section>


<!-- s2 ОСНОВНЫЕ ФУНКЦИИ -->
<section class="slide s-func" id="s2" data-kind="main" data-title="Основные функции" aria-label="Основные функции">
  <header class="p-head">
    <p class="eyebrow in">Для кого</p>
    ${title('Основные функции', 'сервиса')}
  </header>
  <ul class="chips roles in"><li>руководитель отделения</li><li>проектировщик перепланировки</li><li>специалист по инвентаризации</li></ul>
  <div class="steps" style="left:96px;top:420px;width:720px">
    <article class="pill" data-step="1"><h3>2D-редактор</h3><p>Форма помещения, зоны, оборудование и слои. Правка мышью и числом.</p></article>
    <article class="pill" data-step="2"><h3>Сохранение</h3><p>План — один JSON-файл. Открывается снова без потерь. Два входа: новый план или готовый размеченный.</p></article>
    <article class="pill" data-step="3"><h3>ИИ-ассистент</h3><p>Подскажет место, найдёт недостающее и лишнее, покажет эффект правки.</p></article>
  </div>
  <div class="stack shotbox" style="left:880px;top:420px;width:944px;height:531px">
    ${frame('plan-2d', 'Редактор плана отделения: библиотека слева, план в центре, проверка справа')}
    <svg class="marks" viewBox="0 0 100 56.25" aria-hidden="true">
      <g data-step="1"><ellipse class="ring keep" cx="47.5" cy="26.5" rx="20" ry="11.5"/><ellipse class="ring" data-ping cx="47.5" cy="26.5" rx="20" ry="11.5"/></g>
      <g data-step="2"><circle class="ring keep" cx="95.6" cy="1.7" r="3"/><circle class="ring" data-ping cx="95.6" cy="1.7" r="3"/></g>
      <g data-step="3"><ellipse class="ring keep" cx="83.4" cy="4.7" rx="5.6" ry="2.6"/><ellipse class="ring" data-ping cx="83.4" cy="4.7" rx="5.6" ry="2.6"/></g>
    </svg>
  </div>
  ${note('Наш пользователь — внутренний заказчик: руководитель отделения, проектировщик и специалист по инвентаризации. Сервис закрывает три задачи: нарисовать план, сохранить его и спросить ассистента.')}
</section>


<!-- s3 2D-РЕДАКТОР -->
<section class="slide s-editor" id="s3" data-kind="main" data-title="2D-редактор" aria-label="2D-редактор">
  <header class="p-head">
    <p class="eyebrow in">2D-редактор</p>
    ${title('Редактор,', 'который не даст ошибиться')}
  </header>
  <div class="stack shotbox" style="left:96px;top:330px;width:1000px;height:562px">
    ${frame('plan-2d', 'Редактор: шесть инструментов в верхней панели')}
    <div data-step="2">${frame('silhouette', 'Силуэт при постановке: зелёный, жёлтый, красный', 'fill')}</div>
    <div data-step="3">${frame('editor-offsets', 'Перенос терминала: отступы до стен и соседей', 'fill')}</div>
    <div data-step="4">${frame('context-menu', 'Меню по правому щелчку и выравнивание группы', 'fill')}</div>
  </div>
  <div class="steps" style="left:1160px;top:330px;width:664px">
    <article class="pill" data-step="1"><h3>Шесть инструментов</h3><p>Выбор, Комната, Зона, Перегородка, Проём, Линейка.</p></article>
    <article class="pill" data-step="2"><h3>Силуэт при постановке</h3><p><b class="g">Зелёный</b> — встанет. <b class="y">Жёлтый</b> — встанет, но проверка найдёт нарушение. <b class="r">Красный</b> — правка отклонена, причина рядом.</p></article>
    <article class="pill" data-step="3"><h3>Отступы и привязка</h3><p>При переносе видны отступы до стен. Объект притягивается к соседям, стенам и сетке 0,5 м.</p></article>
    <article class="pill" data-step="4"><h3>Меню и группы</h3><p>Правый щелчок: повернуть, дублировать, спросить ассистента. Группу выравнивают в одно действие.</p></article>
  </div>
  <p class="foot-note in" style="left:96px;top:924px">Любая правка отменяется: Ctrl+Z</p>
  ${note('Редактор — главный инструмент. Он не просто рисует, а сразу подсказывает. Тип из библиотеки показывает силуэт: зелёный, жёлтый или красный. При переносе видны отступы до стен. Меню по правому щелчку и выравнивание группы экономят время.')}
</section>


<!-- s4 3D И СЛОИ -->
<section class="slide s-3d" id="s4" data-kind="main" data-title="3D и слои" aria-label="3D и слои данных">
  <header class="p-head">
    <p class="eyebrow in">3D и слои</p>
    ${title('3D и слои', 'из того же плана')}
  </header>
  <div style="position:absolute;left:96px;top:330px;width:1000px">
    ${frame('view-3d', 'Тот же план в 3D', 'solo')}
    <p class="cap">3D строится из плана. Своего состояния не хранит. Все 25 типов — узнаваемые модели.</p>
  </div>
  <div class="stack shotbox" style="left:1160px;top:330px;width:664px;height:373px">
    ${frame('layers-cameras', 'Слой камер с зонами обзора')}
    <div data-step="2">${frame('layers-heat', 'Слой тепловой нагрузки', 'fill')}</div>
    <div data-step="3">${frame('layers-state', 'Слой состояния оборудования', 'fill')}</div>
  </div>
  <ul class="chips layer-list" style="left:1160px;top:740px;width:664px">
    ${layers.map((name, i) => `<li data-step="${i + 1}">${name}</li>`).join('')}
  </ul>
  ${note('3D строится из текущего плана: правка в 2D сразу видна в 3D. Информационные слои рисуют расчёт поверх плана: обзор камер, нагрузку зон, сотрудников, очередь и состояние оборудования.')}
</section>


<!-- s5 ФИШКИ 3×3 -->
<section class="slide s-tiles" id="s5" data-kind="main" data-title="Приятные мелочи" aria-label="Девять приятных мелочей">
  <header class="p-head">
    <p class="eyebrow in">Можно пролистнуть</p>
    ${title('Ещё девять', 'приятных мелочей')}
  </header>
  <!-- Steps 1–9 enlarge one photo each; step 10 returns the plain grid. Markers are hidden, only their .cur class matters. -->
  <div class="tiles">
    ${tiles.map(([name, line, shotName], i) => `<article class="tile in" style="--i:${i};--ox:${['left', 'center', 'right'][i % 3]};--oy:${['top', 'center', 'bottom'][Math.floor(i / 3)]}">
      ${frame(shotName, name)}
      <div><h3>${name}</h3><p>${line}</p></div>
      <i class="zoom-at" data-step="${i + 1}" aria-hidden="true"></i>
    </article>`).join('')}
    <i class="zoom-at" data-step="${tiles.length + 1}" aria-hidden="true"></i>
  </div>
  ${note('Коротко о мелочах, которые экономят время. Можно спросить голосом, напечатать план в масштабе, сохранить версию и пройти по залу от первого лица.')}
</section>


<!-- s6 ПУТЬ ОШИБКИ -->
<section class="slide s-path" id="s6" data-kind="main" data-title="Путь ошибки" aria-label="Путь ошибки">
  <header class="p-head">
    <p class="eyebrow in">Проверка</p>
    ${title('Ошибку', 'не пропустить')}
  </header>
  <div class="track" data-links="t1>t2; t2>t3; t3>t4">
    <div class="pill" data-node="t1" data-step="1"><span class="n">1</span><h3>Не дать сделать</h3></div>
    <div class="pill" data-node="t2" data-step="2" data-packet><span class="n">2</span><h3>Найти</h3></div>
    <div class="pill" data-node="t3" data-step="3" data-packet><span class="n">3</span><h3>Объяснить</h3></div>
    <div class="pill" data-node="t4" data-step="4" data-packet><span class="n">4</span><h3>Исправить</h3></div>
  </div>
  <div class="desc-box" style="left:96px;top:480px;width:720px">
    <div class="desc" data-step="1"><p>Правка в стену или на проход отклоняется ещё во время жеста.</p><p class="big-fact"><b data-count="6" data-dur="700">6</b> правил физики плана, <b data-count="4" data-dur="700">4</b> останавливают жест.</p></div>
    <div class="desc" data-step="2"><p>Значок прямо на объекте. Проверка пересчитывается на каждую правку.</p><ul class="chips small">${checks.map((c) => `<li>${c}</li>`).join('')}</ul></div>
    <div class="desc" data-step="3"><p>Кнопка «Почему?»: правило, откуда число, источник.</p><p class="rule"><b class="r">Правило организаторов</b> — ошибка.<br><b class="y">Допущение команды</b> — предупреждение.</p></div>
    <div class="desc" data-step="4"><p>Ассистент рисует вариант. Человек нажимает «Применить».</p></div>
  </div>
  <div class="stack shotbox" style="left:880px;top:480px;width:944px;height:531px">
    <div>${frame('silhouette-red', 'Красный силуэт на занятом месте, причина отказа рядом', 'fill')}</div>
    <div data-step="2">${frame('plan-check', 'Проверка: значок находки прямо на объекте', 'fill')}
      <svg class="marks" viewBox="0 0 100 56.25" aria-hidden="true"><circle class="ring keep" cx="26" cy="29.4" r="2.6"/><circle class="ring" data-ping cx="26" cy="29.4" r="2.6"/></svg>
    </div>
    <div data-step="3">${frame('why-card', 'Раскрытая карточка «Почему?»', 'fill')}</div>
    <div data-step="4">${frame('apply-fix', 'Вариант исправления полупрозрачно на плане и кнопка «Подтвердить»', 'fill')}
      <p class="dim-line">до входа: <b data-count="2.25" data-from="6.62" data-dec="2" data-dur="1400">2,25</b> м <span>(было 6,62 · норма ≤ 3 м)</span></p>
      <p class="corner">План 87 → 100</p>
    </div>
  </div>
  ${note('С ошибкой мы работаем в четыре шага. Сначала не даём её сделать: правка в стену отклоняется сразу. Если ошибка есть, значок стоит на самом объекте. Кнопка «Почему?» объясняет правило и его источник. Исправление предлагает ассистент: на демо-плане терминал очереди был в 6,62 м от входа при норме 3 м, стал в 2,25 м.')}
</section>


<!-- s7 ИНВЕНТАРИЗАЦИЯ И СПРАВОЧНИКИ -->
<section class="slide s-inv" id="s7" data-kind="main" data-title="Инвентаризация и справочники" aria-label="Инвентаризация и справочники без кода">
  <header class="p-head" style="width:900px">
    <p class="eyebrow in">Без программиста</p>
    ${title('Инвентаризация', 'и справочники без кода')}
  </header>
  <ul class="counters in">
    <li><b data-count="25">25</b><span>типов оборудования</span></li>
    <li><b data-count="8">8</b><span>типов зон</span></li>
    <li><b data-count="6">6</b><span>правил комплектования</span></li>
  </ul>
  <article class="pill card" data-step="1" style="left:96px;top:330px;width:844px;height:430px">
    <h3>Инвентаризация из плана</h3>
    <p>Перечень с инвентарными номерами, типом, зоной и состоянием. Чек-лист комплектности: красная строка сразу спрашивает ассистента.</p>
    <div class="pair">${frame('inventory', 'Перечень оборудования с инвентарными номерами')}${frame('checklist', 'Чек-лист комплектности: красная строка «Зона ожидания: Скамья 1/≥2»')}</div>
  </article>
  <article class="pill card" data-step="2" style="left:980px;top:330px;width:844px;height:430px">
    <h3>Новый тип — это форма</h3>
    <p>Тип оборудования, зону или правило добавляют в «Настройках». Новый тип сразу получает инвентарный номер и состояние. Справочник едет в файле плана.</p>
    <div class="pair one">${frame('catalog', 'Настройки: форма нового типа оборудования')}</div>
  </article>
  <div class="strip" data-step="3" style="left:96px;top:790px;width:1728px;height:200px">
    ${frame('shape-edit', 'Редактор формы: Г-образный диван')}
    <p><b>Своя форма объекта</b>например, Г-образный диван</p>
  </div>
  ${note('Инвентаризация не хранится отдельно, она считается из плана. Чек-лист показывает, чего не хватает по правилам. Если завтра нужен новый тип оборудования, его добавляют формой, без программиста.')}
</section>


<!-- s8 ТРИ СЦЕНАРИЯ АССИСТЕНТА -->
<section class="slide s-qa" id="s8" data-kind="main" data-title="Три вопроса ассистенту" aria-label="Три сценария ассистента">
  <header class="p-head">
    <p class="eyebrow in">Ассистент</p>
    ${title('Три вопроса', 'ассистенту')}
  </header>
  <div class="steps" style="left:96px;top:330px;width:800px">
    <article class="pill" data-step="1"><h3>Где поставить?</h3><p class="ask">«Где поставить ещё одно кассовое окно ближе к входу?»</p><p>→ До трёх проверенных мест на плане и прогноз свободной площади.</p></article>
    <article class="pill" data-step="2"><h3>Чего не хватает?</h3><p class="ask">«Чего не хватает или что лишнее по оборудованию?»</p><p>→ Нарушенные правила по зонам: есть и нужно.</p></article>
    <article class="pill" data-step="3"><h3>Что изменится?</h3><p class="ask">«Как мои изменения повлияли на свободную площадь?»</p><p>→ Было → стало по площади и перечню.</p></article>
  </div>
  <div class="stack shotbox" style="left:960px;top:330px;width:864px;height:560px">
    ${frame('assistant', 'Ответ ассистента: кликабельные id и кнопка «Применить»')}
  </div>
  <p class="foot-note in" style="left:960px;top:920px;width:864px">Можно спросить и своими словами — голосом или текстом.</p>
  ${note('Ассистент отвечает на три вопроса из условий: куда поставить, чего не хватает и что изменилось. Каждый ответ называет конкретные зоны и объекты, и их можно показать на плане.')}
</section>


<!-- s9 КАК РАБОТАЕТ АССИСТЕНТ -->
<section class="slide s-ai" id="s9" data-kind="main" data-title="Как работает ассистент" aria-label="Как работает ассистент">
  <header class="p-head">
    <p class="eyebrow in">Пайплайн</p>
    ${title('Модель объясняет,', 'код считает')}
  </header>
  <div class="pipe" data-links="n1>n2; n2>n3; n3>n4; n4>n5; n5>n6 n7">
    <span class="lane-label llm">Модель</span><span class="lane-label code">Код</span>
    <div class="node llm" data-node="n1" style="--c:1;--r:1"><p class="tag">1 · браузер</p><h3>Вопрос и план</h3><p>React → HTTP на сервер Fastify</p></div>
    <div class="node llm" data-node="n2" data-step="1" data-packet style="--c:2;--r:1"><p class="tag">2 · DeepSeek</p><h3>Выбирает инструмент</h3><p>tool calling, 1 из 13</p></div>
    <div class="node calc" data-node="n3" data-step="2" data-packet style="--c:3;--r:2"><p class="tag">3 · TypeScript</p><h3>Считает</h3><p>место, правила, площадь; тесты Vitest</p></div>
    <div class="node llm" data-node="n4" data-step="3" data-packet style="--c:4;--r:1"><p class="tag">4 · JSON</p><h3>Объясняет</h3><p>id фактов и «почему»</p></div>
    <div class="node calc gate" data-node="n5" data-step="4" data-packet style="--c:5;--r:2"><p class="tag">5 · код</p><h3>Проверяет</h3><p>id из плана, каждое число — из фактов</p></div>
    <div class="node ok" data-node="n6" data-step="5" data-packet style="--c:6;--r:1"><p class="tag">6 · команда</p><h3>Вариант на плане</h3><p>«Применить», Ctrl+Z</p></div>
    <div class="node fb" data-node="n7" data-step="5" data-packet data-dashed style="--c:6;--r:2"><p class="tag">Если не совпало</p><h3>Расчёт «Без LLM»</h3><p>1 повтор, затем текст кода</p></div>
  </div>
  <div class="principles">
    <article class="pill" data-step="6"><h3>Числа считает код</h3><p>Площади, поиск места, правила — функции с тестами.</p>${frame('assistant-journal', 'Журнал шагов агента', 'thumb')}</article>
    <article class="pill" data-step="6"><h3>Модель сверяется с расчётом</h3><p><code>id</code> и числа проверяет код. Не совпало или нет API — ответ «Без LLM». После правки код сам говорит, что изменилось.</p></article>
    <article class="pill" data-step="6"><h3>Ничего не двигает сам</h3><p>Вариант полупрозрачный. Ставит только «Применить». Отмена — Ctrl+Z.</p></article>
  </div>
  ${note('Браузер отправляет вопрос и план на сервер Fastify. Модель DeepSeek через tool calling выбирает один из 13 инструментов: найти место, проверить комплектность, проверить план и другие. Инструмент — расчёт на TypeScript, покрытый тестами Vitest. Модель возвращает JSON: id выбранных фактов и короткое «почему». Код отклоняет текст, если в нём чужой id или число, которого нет в фактах. Отказ — одна просьба переписать, затем ответ кода с пометкой «Без LLM». На всё — не больше 6 вызовов модели. Вариант ставит только кнопка «Применить», отмена — Ctrl+Z.')}
</section>


<!-- s10 АРХИТЕКТУРА: content from ../shared/slides.js s9 -->
<section class="slide s-sys" id="s10" data-kind="main" data-title="Архитектура" aria-label="Архитектура">
  <header class="p-head">
    <p class="eyebrow in">Архитектура</p>
    ${title('Правка — командой,', 'остальное — расчёт')}
  </header>
  <div class="arch" data-links="w1>w2|v; w2>w3|v; w3>hub; hub>r1 r2 r3 r4 r5; r5>srv|v">
    <div class="node wr" data-node="w1" style="--y:0"><p class="tag">Вход · React</p><h3>Жест, карточка, файл</h3><p>и «Применить» ассистента</p></div>
    <div class="node wr" data-node="w2" data-step="1" data-packet style="--y:1"><p class="tag">Команда · Zustand</p><h3>16 типов и batch</h3><p>всё или ничего · одна запись undo</p></div>
    <div class="node wr" data-node="w3" data-step="1" data-packet style="--y:2"><p class="tag">Допуск · TypeScript</p><h3>6 правил физики</h3><p>новое нарушение — отказ</p></div>
    <div class="node hub" data-node="hub" data-step="1" data-packet>
      <p class="tag">Единое состояние</p>
      <h3>План в JSON</h3>
      <ul><li>схема Zod, версия 1</li><li>метры · центр · Y вверх</li><li>справочник внутри</li><li>store Zustand, undo</li></ul>
    </div>
    <div class="reads">
      ${reads.map(([id, name, fn]) => `<div class="node rd" data-node="${id}" data-step="2" data-packet><h3>${name}</h3><p>${fn}</p></div>`).join('')}
    </div>
    <div class="node srv" data-node="srv" data-step="3" data-packet><p class="tag">Сервер · Node.js</p><h3>Fastify повторяет расчёт</h3><p>Zod проверяет файл → тот же TypeScript-расчёт → модели только факты → код проверяет ответ</p></div>
  </div>
  ${note('Состояние одно — план в JSON, его проверяет схема Zod. В браузере план живёт в store Zustand. Меняют его только команды: жест на плане, карточка, файл и кнопка «Применить» ассистента. Группа правок — одна команда и одна запись undo. Перед записью — шесть правил физики: новое нарушение отклоняет правку. Остальное — расчёт из плана: 2D на React и Konva, 3D на Three.js, инвентаризация, площади, проверка и ассистент. Копий плана нет. Сервер на Fastify не верит браузеру: проверяет файл той же схемой и повторяет расчёт тем же кодом на TypeScript.')}
</section>


<!-- s11 КАК УСТРОЕНО И ЗАМЕРЫ -->
<section class="slide s-arch" id="s11" data-kind="main" data-title="Как устроено и замеры" aria-label="Как устроено и сколько выдерживает">
  <header class="p-head">
    <p class="eyebrow in">Одно состояние</p>
    ${title('Как устроено', 'и сколько выдерживает')}
  </header>
  <div class="hub-box" data-links="hub>a1 a2 a3 a4 a5" style="left:96px;top:330px;width:820px;height:520px">
    <div class="node hub" data-node="hub"><p class="tag">Файл</p><h3>plan.json</h3></div>
    ${['2D', 'Инвентаризация', 'Проверка', '3D', 'Ассистент'].map((name, i) => `<div class="node leaf" data-node="a${i + 1}" data-step="${i + 1}" data-packet style="--k:${i}"><h3>${name}</h3></div>`).join('')}
  </div>
  <p class="foot-note in" style="left:96px;top:880px">Одно состояние. Копий нет.</p>
  <div class="bench-box" style="left:1000px;top:330px;width:824px">
    <p class="tag in">Первое открытие, 50 зон</p>
    <p class="huge in"><span class="sm"><b data-count="1000" data-dur="900">1000</b> объектов —</span><span class="lg"><b data-count="0.54" data-dec="2" data-delay="500">0,54</b> с</span></p>
    <ul class="counters mini in">
      <li><b>38 мс</b><span>выбор объекта</span></li>
      <li><b>72 мс</b><span>шаг zoom</span></li>
      <li><b>1,29 с</b><span>сохранить → открыть</span></li>
    </ul>
    <ul class="chips col">
      <li>1588 unit + 228 e2e тестов — все зелёные</li>
      <li>Запуск — одна команда: <code>docker compose up --build -d</code></li>
      <li>Сервис в облаке: 158.160.157.55:8080, без логина</li>
    </ul>
  </div>
  <p class="fine">Замер 04.10.2026, Ryzen AI 9 365, Edge, production-сборка, медиана 5 прогонов. Команда — в README.</p>
  ${note('Внутри — одно состояние. Редактор, инвентаризация, проверка, 3D и ассистент читают один план. План на тысячу объектов открывается за полсекунды. Тесты зелёные, сервис уже работает в облаке.')}
</section>


<!-- s12 ПОЧЕМУ ЭТО РАБОТАЕТ -->
<section class="slide s-end" id="s12" data-kind="main" data-title="Итог" aria-label="Почему это работает">
  <header class="p-head">
    <p class="eyebrow in">Итог</p>
    ${title('Почему', 'это работает?')}
  </header>
  <div class="theses">
    <article class="thesis" data-step="1"><span class="n">1</span><h3>По плану сразу всё понятно</h3><p>Нарисовали — и видно всё: инвентаризация, проверка, 3D и слои.</p></article>
    <article class="thesis" data-step="2"><span class="n">2</span><h3>Ассистенту можно верить</h3><p>Числа считает код. Без человека ничего не меняется.</p></article>
    <article class="thesis" data-step="3"><span class="n">3</span><h3>Новое — без кода</h3><p>Тип, зону или правило добавляют в интерфейсе.</p></article>
  </div>
  ${note('Итог: по плану сразу всё видно, ассистенту можно верить, а новое добавляется без кода.')}
</section>


<!-- s13 НАША КОМАНДА + ВОПРОСЫ: portraits fly in spinning, land on wrong names, then swap to their own (motion.js) -->
<section class="slide s-team" id="s13" data-kind="main" data-title="Наша команда" aria-label="Наша команда, вопросы">
  <header class="p-head">
    <p class="eyebrow in">ИИ-бланки</p>
    <h2 class="title">${ln('Наша команда')}</h2>
  </header>
  <div class="team-arches">
    ${team.map(([name, role], i) => `<figure><div class="portrait"><img src="../assets/team/member-${i + 1}.png" alt="${name}"></div><figcaption><b>${name}</b><span>${role}</span></figcaption></figure>`).join('')}
  </div>
  <div class="qr in"><img src="../assets/brand/qr-service.svg" alt="QR-код: адрес сервиса"><p>158.160.157.55:8080</p><p class="ask">↓ Вопросы</p></div>
  <img class="cat-end in" src="../assets/brand/cat-glasses.webp" alt="">
  ${note('Наша команда. Сервис открыт по QR-коду, логин не нужен. Дальше — демо, потом вопросы.')}
</section>


<!-- s14 ДЕМО: the video fills the stage and plays when the slide opens (../shared/app.js) -->
<section class="slide s-demo" id="s14" data-kind="main" data-title="Демо" aria-label="Демо">
  <video class="demo" src="../assets/demo/demo.mp4" poster="../assets/demo/demo-poster.webp" muted playsinline preload="auto" aria-label="Демо: перетаскивание терминала в 2D, слой камер, облёт 3D и вид глазами посетителя"></video>
  ${note('Демо без звука, 44 секунды. 2D: тянем терминал очереди к входу — находка уходит, балл 87 → 97. Слой камер. 3D: облёт сбоку, затем глазами посетителя. После демо — вопросы: стрелка вниз.')}
</section>


<!-- b1 ГРАНИЦА И РОСТ -->
<section class="slide s-cards" id="b1" data-kind="backup" data-title="Границы и рост" aria-label="Границы и рост">
  <header class="p-head"><p class="eyebrow in">Вопросы · что доказано</p>${title('Граница ясна,', 'рост — данными')}</header>
  <div class="cards c3">
    <section class="pill" data-step="1"><h3>Проверено</h3><ul><li>Геометрия: помещение, зона, стены, проёмы, потолок, пересечения</li><li>Расстояние до входа — правило организаторов</li><li>Было → стало: площадь, состав, находки</li></ul></section>
    <section class="pill" data-step="2"><h3>Граница</h3><ul><li>Проходы, эргономику и маршруты не проверяем</li><li>Комплектование — допущение команды, не норматив Почты</li><li>«Не найдено» — не найдено на сетке 0,1 м за 60 000 проб</li></ul></section>
    <section class="pill" data-step="3"><h3>Рост</h3><ul><li>Другое отделение — другой JSON, код тот же</li><li>Новое правило — строка справочника, серьёзность — из источника</li><li>Другая модель — LLM_PROVIDER и LLM_MODEL в .env</li></ul></section>
  </div>
  ${note('Что доказано: геометрия размещения и расстояние до входа. Эффект правки — в числах. Чего не заявляем: ширину проходов, эргономику, маршруты. Правила комплектования — допущения команды, не норматив Почты. «Не найдено» значит «не найдено перебором», а не «места нет». Рост — данными: другое отделение — другой JSON, новое правило — строка справочника, другая модель — переменная окружения.')}
</section>


<!-- b2 ПОЧЕМУ ТАК -->
<section class="slide s-cards" id="b2" data-kind="backup" data-title="Почему так" aria-label="Риск и решение">
  <header class="p-head"><p class="eyebrow in">Вопросы · риск → решение</p>${title('Каждое решение', 'закрывает риск')}</header>
  <div class="cards c5">
    ${[
      ['2D и 3D расходятся в координатах', 'Метры, центр, Y вверх. Отражение Y — только в geometry'],
      ['Перечень расходится с планом', 'Инвентаризация — функция плана, своего состояния нет'],
      ['Модель ошибётся в числе', 'Модель выбирает из посчитанного. Лишнее поле — отказ'],
      ['Правила Почты известны не все', 'Серьёзность — от источника правила, а не от нас'],
      ['Завтра нужен новый тип оборудования', 'Справочник едет в файле плана. Свой тип не теряется'],
    ].map(([risk, fix], i) => `<article class="pill" data-step="${i + 1}"><p class="tag">Риск</p><p class="risk">${risk}</p><p class="tag">Решение</p><h3>${fix}</h3></article>`).join('')}
  </div>
  ${note('Каждое решение закрывает риск. Координаты — один контракт: метры, центр, ось Y вверх; отражение оси — только в модуле геометрии. Инвентаризация — функция плана, поэтому не расходится с ним. Модель выбирает из посчитанного, а лишнее поле отвергает весь ответ. Серьёзность находки задаёт источник правила. Справочник едет внутри файла плана, поэтому свой тип не теряется при передаче.')}
</section>


<!-- b3 КАК АССИСТЕНТ ИЩЕТ МЕСТО -->
<section class="slide s-search" id="b3" data-kind="backup" data-title="Поиск места" aria-label="Как ассистент ищет место">
  <header class="p-head"><p class="eyebrow in">Вопросы</p>${title('Как ассистент', 'ищет место')}</header>
  <div class="steps" style="left:96px;top:330px;width:760px">
    <article class="pill" data-step="1"><h3>Якорь</h3><p>точка пользователя или центр зоны нужного типа</p></article>
    <article class="pill" data-step="2"><h3>Кольца</h3><p>сетка 0,1 м, углы 0° и 90°; правило ≤ 3 м сужает перебор</p></article>
    <article class="pill" data-step="3"><h3>Проверка</h3><p>кандидат в копии плана проходит validatePlan</p></article>
    <article class="pill" data-step="4"><h3>Стоп</h3><p>24 подтверждённых места или 60 000 проб</p></article>
  </div>
  <svg class="rings" viewBox="0 0 520 520" aria-hidden="true">
    ${[60, 120, 180, 240].map((r, i) => `<circle class="r" data-draw pathLength="1" data-delay="${i * 140}" cx="260" cy="260" r="${r}"/>`).join('')}
    <circle class="anchor" cx="260" cy="260" r="10"/>
    ${[[318, 214], [196, 300], [372, 330], [150, 172], [262, 78], [420, 224]].map(([x, y]) => `<rect class="cand" data-step="3" x="${x - 9}" y="${y - 9}" width="18" height="18" rx="5"/>`).join('')}
  </svg>
  ${note('Перебор идёт кольцами от якоря. Шаг сетки 0,1 метра, углы 0 и 90 градусов. Правило расстояния до входа с серьёзностью «ошибка» сужает сам перебор, а не отсекает результат в конце. Кандидат подставляется в копию плана и проходит тот же validatePlan. Остановка — 24 подтверждённых места или 60 тысяч проб.')}
</section>


<!-- b4 ЗАМЕРЫ -->
<section class="slide s-bench" id="b4" data-kind="backup" data-title="Замеры" aria-label="Замеры скорости">
  <header class="p-head"><p class="eyebrow in">Вопросы</p>${title('Скорость', 'на 100, 500 и 1000 объектов')}</header>
  <table class="bench-table in">
    <thead><tr><th>Объекты / зоны</th><th>Открытие</th><th>Выбор</th><th>Zoom</th><th>Сохранить → открыть</th></tr></thead>
    <tbody>
      <tr><td>100 / 10</td><td>0,21 с</td><td>22 мс</td><td>13 мс</td><td>0,35 с</td></tr>
      <tr><td>500 / 30</td><td>0,34 с</td><td>31 мс</td><td>40 мс</td><td>0,52 с</td></tr>
      <tr class="hit"><td>1000 / 50</td><td>0,54 с</td><td>38 мс</td><td>72 мс</td><td>1,29 с</td></tr>
    </tbody>
  </table>
  <ul class="counters mini" data-step="1" style="left:96px;top:700px">
    <li><b>1,53 с</b><span>расчёт ассистента: поиск места, 1000 объектов</span></li>
    <li><b>1,87 с</b><span>3D: 1000 объектов моделями</span></li>
    <li><b>0,57 с</b><span>перенос объекта: 30 шагов мыши</span></li>
  </ul>
  ${note('Пороги: выбор меньше 400 миллисекунд, zoom меньше 300 — соблюдены.')}
</section>


<!-- b5 ФОРМАТ ФАЙЛА -->
<section class="slide s-format" id="b5" data-kind="backup" data-title="Формат файла" aria-label="Формат файла плана">
  <header class="p-head" style="width:640px"><p class="eyebrow in">Вопросы</p>${title('Формат файла', 'плана')}<p class="lead in">Метры · X вправо · Y вверх · поворот по часовой стрелке</p></header>
  <ul class="steps" data-step="1" style="left:96px;top:600px;width:640px">
    <li class="pill"><h3>Отказ</h3><p>битая ссылка, повтор id, версия новее — открытый план цел</p></li>
    <li class="pill"><h3>Открыть</h3><p>нарушенная геометрия — план открыт с находками</p></li>
    <li class="pill"><h3>Назвать</h3><p>поле вне формата названо; своё — в extensions</p></li>
  </ul>
  <pre class="fmt in"><b>PlanDocument</b>  schemaVersion: 1
├ room       boundary · ceilingHeight_m
├ walls · openings
├ layers     typeId → справочник слоёв
├ zones      id · typeId · parentId (вложенность)
├ objects    id · typeId · position (центр, м)
│            size_m · rotation_deg · zoneId
├ catalog    objectTypes · zoneTypes · layerTypes · rules
└ extensions данные импорта, которых нет в схеме</pre>
  ${note('Формат — версионированный JSON. Справочники едут внутри файла, поэтому свои типы переживают передачу. Структурная ошибка отклоняет файл, и открытый план остаётся. Геометрическая — нет: план открывается с находками, человек его исправляет. Импорт чужой файл молча не исправляет.')}
</section>


<!-- b6 СТЕК -->
<section class="slide s-cards" id="b6" data-kind="backup" data-title="Стек и зависимости" aria-label="Стек и зависимости">
  <header class="p-head"><p class="eyebrow in">Вопросы</p>${title('Стек и', 'зависимости')}</header>
  <div class="cards c4">
    <section class="pill" data-step="1"><h3>Браузер</h3><p>React 19 · Vite 8<br>react-konva — холст 2D<br>Three.js — 3D из плана<br>Zustand — store и undo</p></section>
    <section class="pill" data-step="2"><h3>Общий расчёт</h3><p>src/domain — без UI<br>Zod — одна схема для файла и сервера<br>polyclip-ts — объединение следов</p></section>
    <section class="pill" data-step="3"><h3>Модель</h3><p>DeepSeek V4 Flash через Yandex AI Studio<br>Провайдер и модель — из .env<br>Без API — «Без LLM»</p></section>
    <section class="pill" data-step="4"><h3>Запуск</h3><p>npm ci → npm run dev<br><span class="nw">docker compose up --build -d</span><br>Сервер — Fastify<br>Файл плана до 5 МиБ</p></section>
  </div>
  ${note('Стек из package.json. Расчёт — чистая логика без UI, общая для браузера и сервера. Одна Zod-схема проверяет файл в браузере и план на сервере. Модель подключается по OpenAI-совместимому адресу из .env; допустимы Qwen, DeepSeek, GigaChat, YandexGPT.')}
</section>


<!-- b7 СЦЕНАРИЙ ПРОВЕРЯЮЩЕГО -->
<section class="slide s-cards" id="b7" data-kind="backup" data-title="Сценарий проверяющего" aria-label="Сценарий проверяющего">
  <header class="p-head"><p class="eyebrow in">Вопросы</p>${title('Сценарий', 'проверяющего')}</header>
  <div class="cards c5">
    <article class="pill"><span class="n">1</span><h3>Открыть</h3><p>редактор по адресу сервиса, логин не нужен</p></article>
    <article class="pill" data-step="1"><span class="n">2</span><h3>Загрузить демо</h3><p>before.json: схема, затем проверка — 2 находки</p></article>
    <article class="pill" data-step="2"><span class="n">3</span><h3>Изменить</h3><p>перенести терминал: отпустил — одна команда</p></article>
    <article class="pill" data-step="3"><span class="n">4</span><h3>Сохранить</h3><p>JSON со справочником внутри</p></article>
    <article class="pill" data-step="4"><span class="n">5</span><h3>Открыть заново</h3><p>правка на месте, ошибки до входа нет</p></article>
  </div>
  ${note('Сценарий проверяющего: открыть, загрузить демо, изменить, сохранить, открыть заново. Оба плана из ZIP открываются в редакторе с зонами, оборудованием, id и атрибутами. После переноса терминала ошибка расстояния до входа уходит; предупреждение о скамье остаётся, пока не добавлена вторая.')}
</section>`;

  document.querySelector('.chrome').insertAdjacentHTML('afterend', html);
})();
