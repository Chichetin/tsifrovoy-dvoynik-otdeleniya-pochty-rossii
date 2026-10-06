/* Slide content, shared by every variant. Facts come from the code and its documents: docs/architecture.md,
   docs/decisions.md, README.md («Проверенный объём данных», «Файл плана и методы расчёта»), demo/effect.md,
   src/domain/validation (index.ts, health.ts), data/catalog/*.json, eslint.config.js, package.json.
   Layout and look live in layout.css and each variant's styles.css.
   Slide order: 11 main slides (s1–s11), then 6 backup slides for questions (b1–b6, key Q or ↓).
   Hooks for motion are described at the top of motion-core.js. */
(() => {
  const ln = (text) => `<span class="ln"><span>${text}</span></span>`;
  const note = (text) => `<aside class="speaker-note" hidden>${text}</aside>`;
  const shot = (name) => `../assets/shots/${name}.webp`;
  const team = [
    ['Александр Чичерин', 'тим-лид'],
    ['Иван Резников', 'капитан'],
    ['Максим Седов', 'разработчик'],
    ['Иван Пушкин', 'разработчик'],
    ['Александр Лесницкий', 'разработчик'],
  ];

  // s9: what reads the document. Each one is a function of the plan, none keeps a copy.
  const reads = [
    ['r1', '2D и 3D', 'рисуют документ'],
    ['r2', 'Инвентаризация', 'buildInventory(plan)'],
    ['r3', 'Площади', 'measurePlan(plan)'],
    ['r4', 'Проверка', 'validatePlan(plan)'],
    ['r5', 'Ассистент', 'calculateAdvice(plan)'],
  ];

  // s4: everything the editor does, from README «Что умеет редактор».
  const feats = [
    ['Рисовать', ['6 инструментов: от комнаты до линейки', 'свой контур отделения и форма объекта', 'зоны вложены друг в друга', 'стены подписаны длиной']],
    ['Править', ['привязка к граням, стенам и сетке', 'группа: 6 выравниваний, равный шаг', 'меню по правому клику', 'Ctrl+Z и Ctrl+Y на всё']],
    ['Учитывать', ['справочник: 25 типов, 8 зон, 6 правил', 'новый тип — форма «Настройки»', 'инвентаризация, чек-лист, CSV', 'обход и акт расхождений']],
    ['Сохранять', ['JSON, PNG и SVG', 'печать A4 и A3 в масштабе 1:50', 'черновик в браузере', 'обучение и карта клавиш «?»']],
  ];

  // s6: what validatePlan looks at (src/domain/validation/index.ts, VALIDATION_ISSUE_CODES).
  const checks = [
    ['Геометрия', 'вне помещения или зоны · пересечение на своей высоте · стена · проём · потолок'],
    ['Зоны', 'вне помещения или родителя · наложение'],
    ['Инвентарь', 'номер повторён или пуст · срок ТО'],
    ['Правила', 'комплектование зон · расстояние до входа'],
  ];

  // s10: risk → decision (docs/decisions.md D-010, D-028, D-048, D-030, D-012).
  const decisions = [
    ['2D и 3D расходятся в координатах', 'Метры, центр, Y вверх. Отражение Y — только в geometry'],
    ['Перечень расходится с планом', 'Инвентаризация — функция плана, своего состояния нет'],
    ['Модель ошибётся в числе', 'Модель выбирает из посчитанного. Лишнее поле — отказ'],
    ['Правила Почты известны не все', 'Серьёзность — от источника правила, а не от нас'],
    ['Завтра нужен новый тип оборудования', 'Справочник едет в файле плана. Свой тип не теряется'],
  ];

  const html = `
<!-- s1 ТИТУЛ -->
<section class="slide s-title" id="s1" data-kind="main" data-title="Титул" data-seam="1348" aria-label="Титул">
  <p class="eyebrow in">PostCode Challenge · команда «ИИ-бланки»</p>
  <h1 class="title">${ln('Цифровой')}${ln('двойник')}${ln('ОПС')}</h1>
  <p class="lead in">Один документ плана: 2D, 3D, проверка и ассистент</p>
  <ul class="team-strip in" aria-label="Команда «ИИ-бланки»">
    ${team.map(([name, role]) => `<li><b>${name}</b><span>${role}</span></li>`).join('')}
  </ul>
  <div class="twin" data-twin></div>
  <p class="seam-label in">x = 7,5 м</p>
  ${note('Здравствуйте. Мы — команда «ИИ-бланки». Наш проект — цифровой двойник отделения Почты России. Один документ плана — основа для 2D, 3D, проверки, инвентаризации и ассистента. Дальше — как это устроено и почему так.')}
</section>


<!-- s2 ТРИ ВОПРОСА -->
<section class="slide s-qa" id="s2" data-kind="main" data-title="Три вопроса" data-seam="640" aria-label="Три вопроса">
  <header class="sl-head">
    <p class="eyebrow in">Для кого</p>
    <h2 class="title">${ln('Три вопроса —')}${ln('три расчёта')}${ln('на плане')}</h2>
    <ul class="roles in"><li>руководитель отделения</li><li>проектировщик перепланировки</li><li>специалист по инвентаризации</li></ul>
  </header>
  <div class="sl-body qa">
    <article class="q" data-step="1"><p class="tag">Место · проектировщик</p><h3>Где поставить ещё одно кассовое окно ближе к входу?</h3><p>Перебор по сетке 0,1 м. До трёх проверенных мест с расстоянием до входа.</p></article>
    <article class="q" data-step="2"><p class="tag">Комплектование · руководитель</p><h3>Чего не хватает или что лишнее по оборудованию?</h3><p>Правила справочника против состава каждой зоны.</p></article>
    <article class="q" data-step="3"><p class="tag">Эффект · инвентаризация</p><h3>Как мои изменения повлияли на свободную площадь?</h3><p>Площадь, состав и находки: было → стало, с id.</p></article>
  </div>
  ${note('Пользователь — внутренний заказчик: руководитель отделения, проектировщик перепланировки, специалист по инвентаризации. У них три вопроса. Куда поставить: код перебирает места по сетке десять сантиметров и отдаёт до трёх проверенных. Чего не хватает: правила справочника сверяются с инвентаризацией каждой зоны. Что изменилось: код сравнивает два снимка плана — площадь, состав и находки.')}
</section>


<!-- s3 РЕДАКТОР -->
<section class="slide s-editor" id="s3" data-kind="main" data-title="Редактор" data-seam="780" aria-label="Редактор плана">
  <header class="sl-head">
    <p class="eyebrow in">2D-редактор</p>
    <h2 class="title">${ln('Редактор')}${ln('подсказывает')}${ln('до ошибки')}</h2>
  </header>
  <ol class="sl-body hints">
    <li data-step="1"><b>Отступы</b>При переносе видны расстояния до стен и соседей. Привязка к граням и сетке 0,5 м.</li>
    <li data-step="2"><b>Силуэт</b>Зелёный — поставится. Жёлтый — проверка найдёт нарушение. Красный — отказ с причиной.</li>
    <li data-step="3"><b>Отрезок до входа</b>Проверка рисует на плане отрезок «до входа 6,62 м».</li>
    <li data-step="4"><b>Один жест — один Ctrl+Z</b>Меню по правому клику, группа, выравнивание.</li>
  </ol>
  <figure class="ui-shot">
    <img src="${shot('editor-drag')}" alt="Перенос терминала очереди: отступы до стен и отрезок до входа">
    <svg class="marks" viewBox="0 0 100 73.6" aria-hidden="true"><g data-step="1"><ellipse class="ring keep" cx="13" cy="34.2" rx="8.6" ry="3.4"/></g><g data-step="3"><ellipse class="ring keep" cx="32.2" cy="55.3" rx="9" ry="3.4"/><circle class="ring" data-ping cx="32.2" cy="55.3" r="3"/></g></svg>
  </figure>
  ${note('Главный критерий — удобство редактора. Он подсказывает до ошибки. При переносе видны расстояния до стен и соседей, объект притягивается к граням и сетке. Тип из библиотеки показывает силуэт: зелёный — поставится, жёлтый — проверка найдёт нарушение, красный — правка будет отклонена, причина рядом. Проверка рисует на плане отрезок до входа. Каждый жест — одна запись undo.')}
</section>

<!-- s4 ВСЁ, ЧТО УМЕЕТ -->
<section class="slide s-feats" id="s4" data-kind="main" data-title="Всё, что умеет" data-seam="1824" aria-label="Возможности редактора">
  <header class="sl-head">
    <p class="eyebrow in">Возможности</p>
    <h2 class="title">${ln('Всё, что умеет')}${ln('редактор')}</h2>
  </header>
  <div class="sl-body stack feats">
    ${feats.map(([title, items]) => `<section class="col in"><h3>${title}</h3><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul></section>`).join('')}
    <figure class="layers-shot in"><img src="${shot('layers')}" alt="Слои камер с зонами обзора и тепловой нагрузки"><figcaption>5 слоёв: обзор камер, тепло, сотрудники, очередь, состояние</figcaption></figure>
  </div>
  ${note('Коротко обо всём. Рисовать: шесть инструментов, свой контур отделения и своя форма объекта. Править: привязка, отступы, силуэт, групповое выравнивание. Учитывать: справочник из 25 типов, новый тип — формой, инвентаризация с обходом и актом расхождений. Видеть: пять информационных слоёв, например зоны обзора камер и тепловую нагрузку. Сохранять: JSON, картинка, печать в масштабе, черновик в браузере.')}
</section>

<!-- s5 3D -->
<section class="slide s-3d" id="s5" data-kind="main" data-title="3D" data-seam="1232" aria-label="3D-вид">
  <header class="sl-head">
    <p class="eyebrow in">3D</p>
    <h2 class="title">${ln('Тот же план —')}${ln('в объёме')}</h2>
  </header>
  <figure class="hero3d in"><img src="${shot('view-3d')}" alt="Демо-отделение в 3D: модели оборудования по зонам"></figure>
  <div class="facts3d">
    <section data-step="1"><p class="tag">Модели</p><p>Все 25 типов: касса, стеллаж с посылками, табло</p></section>
    <section data-step="1"><p class="tag">Подгонка</p><p>Модель тянется по размеру. Полки и сиденья повторяются</p></section>
    <section data-step="1"><p class="tag">Связь с 2D</p><p>Клик в 3D выбирает объект в 2D и в перечне</p></section>
  </div>
  <figure class="visitor3d" data-step="2"><img src="${shot('visitor-3d')}" alt="Вид глазами посетителя от входа"><figcaption><b>Глазами посетителя</b>глаза на 1,6 м у входа · WASD · стены не пускают</figcaption></figure>
  <p class="speed3d" data-step="3">1000 объектов моделями — за 1,87 с</p>
  <section class="doc3d" data-step="3"><p class="tag">Из документа</p><p>Сцена строится заново при каждой правке. Стена перед камерой прозрачна.</p></section>
  ${note('3D — тот же документ в объёме. Своей копии плана у сцены нет: она строится заново при каждой правке. У всех 25 типов справочника свои модели: касса, стеллаж с посылками, табло очереди. Модель тянется по размеру объекта, полки и сиденья повторяются. Клик в 3D выбирает объект в 2D и в перечне. Режим «Глазами посетителя» ставит камеру у входа на высоте глаз, ходить — WASD, стены не пускают. 1000 объектов моделями — меньше двух секунд.')}
</section>

<!-- s6 ПРОВЕРКА -->
<section class="slide s-check" id="s6" data-kind="main" data-title="Проверка" data-seam="840" aria-label="Проверка плана">
  <header class="sl-head">
    <p class="eyebrow in">Проверка</p>
    <h2 class="title">${ln('Каждая правка —')}${ln('новая проверка')}</h2>
  </header>
  <div class="sl-body check">
    <ul class="checks" data-step="1">
      ${checks.map(([what, list]) => `<li><b>${what}</b><span>${list}</span></li>`).join('')}
    </ul>
    <figure class="shot">
      <img src="${shot('plan-check')}" alt="Демо-план: находки проверки на плане и в списке">
      <svg class="marks" viewBox="0 0 100 56.25" aria-hidden="true"><g data-step="1"><circle class="ring keep" cx="26.05" cy="29.35" r="2.6"/><circle class="ring keep" cx="38.35" cy="28.8" r="2.6"/><circle class="ring" data-ping data-delay="150" cx="26.05" cy="29.35" r="2.6"/><circle class="ring" data-ping data-delay="400" cx="38.35" cy="28.8" r="2.6"/></g></svg>
      <figcaption>Находка несёт id и контур: план подсвечивает место</figcaption>
    </figure>
    <div class="node input sev" data-step="2">
      <p class="tag">Серьёзность — от источника</p>
      <p><b class="e">Ошибка</b>геометрия и правило организаторов</p>
      <p><b class="w">Предупреждение</b>допущение команды, с пометкой</p>
      <p class="ex">Пример: терминал в 6,62 м от входа, норма 3 м — ошибка</p>
    </div>
    <div class="node input score" data-step="3">
      <p class="tag">Балл плана</p>
      <p class="big"><b data-count="87">87</b><span>/ 100</span></p>
      <p>100 − 10 за ошибку − 3 за предупреждение</p>
    </div>
    <div class="node input self" data-step="4">
      <p class="tag">Проверяем себя</p>
      <p>Место от ассистента проходит тот же validatePlan. Добавило ошибку — места нет в ответе.</p>
    </div>
  </div>
  ${note('Проверка — функция плана. Она идёт после каждой правки. Что проверяем: геометрию — помещение, зону, пересечения на своей высоте, стены, проёмы, потолок; зоны — вложенность и наложение; инвентарные номера и срок ТО; правила комплектования и расстояние до входа. Серьёзность задаёт источник правила. Геометрия и правило организаторов — ошибка. Допущение команды — предупреждение с пометкой. Пример: терминал очереди в 6,62 метра от входа при норме три — ошибка. Балл: сто минус десять за ошибку и три за предупреждение. На демо-плане — 87. И мы проверяем себя: место от ассистента проходит тот же validatePlan.')}
</section>


<!-- s7 АССИСТЕНТ -->
<section class="slide s-ai" id="s7" data-kind="main" data-title="Ассистент" data-seam="1512" aria-label="Ассистент">
  <header class="sl-head">
    <p class="eyebrow in">ИИ-ассистент</p>
    <h2 class="title">${ln('Модель объясняет,')}${ln('код считает')}${ln('и проверяет')}</h2>
  </header>
  <div class="sl-body pipe" data-links="q>a; a>b; b>c; c>d; d>ok; d>fb|v">
    <div class="lane llm"><span>Модель</span></div>
    <div class="lane code"><span>Код</span></div>
    <div class="node in" data-node="q" style="--c:1;--r:2"><p class="tag">Вопрос</p><h3>Обычная фраза</h3><p>своими словами</p></div>
    <div class="node llm" data-node="a" data-step="1" data-packet style="--c:2;--r:1"><p class="tag">Модель</p><h3>Выбирает инструмент</h3><p>до 6 шагов</p></div>
    <div class="node code" data-node="b" data-step="1" data-packet style="--c:3;--r:2"><p class="tag">Код</p><h3>Считает</h3><p>места, правила, площади</p></div>
    <div class="node llm" data-node="c" data-step="2" data-packet style="--c:4;--r:1"><p class="tag">Модель</p><h3>Объясняет</h3><p>ссылки на id и факты</p></div>
    <div class="node code gate" data-node="d" data-step="3" data-packet style="--c:5;--r:2"><p class="tag">Код</p><h3>Проверяет</h3><p>чужой id или число — отказ целиком</p></div>
    <div class="node ok" data-node="ok" data-step="3" data-packet style="--c:6;--r:2"><p class="tag">Итог</p><h3>Вариант на плане</h3><p>«Применить» — команда</p></div>
    <div class="node fb" data-node="fb" data-step="4" data-dashed style="--c:5;--r:3"><p class="tag">Сбой</p><h3>Расчёт «Без LLM»</h3></div>
  </div>
  ${note('Ассистент — агент с инструментами. Модель выбирает инструмент: поиск места, комплектование, сравнение. До шести шагов на вопрос. Код считает: перебор мест, правила, площади. Модель объясняет и ссылается на id и факты расчёта. Код проверяет каждый id и каждое число. Лишнее поле, чужой id, другое число — ответ отвергнут целиком. Тогда, и при отказе API — нет ключа, таймаут, 429, — показываем расчёт с пометкой «Без LLM». «Применить» — обычная команда редактора: её отменяет Ctrl+Z.')}
</section>


<!-- s8 ЭФФЕКТ -->
<section class="slide s-effect" id="s8" data-kind="main" data-title="Было → стало" data-seam="620" aria-label="Эффект рекомендации">
  <header class="sl-head">
    <p class="eyebrow in">Результат на демо-плане</p>
    <h2 class="title">${ln('Та же проверка')}${ln('после правки')}</h2>
    <p class="lead in">Ассистент нашёл два места. Человек применил их в редакторе. Проверка прошла заново.</p>
  </header>
  <div class="sl-body effect">
    <div class="finds">
      <article class="node input find"><p class="tag">Ошибка · организаторы</p><h3>Терминал очереди в 6,62 м от входа, норма 3 м</h3><p class="fix" data-step="2">eq_1 перенесён → 2,25 м</p></article>
      <article class="node input find"><p class="tag">Предупреждение · команда</p><h3>В зоне ожидания 1 скамья, минимум 2</h3><p class="fix" data-step="2">добавлена eq_54 → 2 скамьи</p></article>
    </div>
    <i class="trigger" data-step="2" aria-hidden="true"></i>
    <svg class="dimension" data-step="1" viewBox="0 0 1100 200" aria-label="Расстояние от терминала до входа">
      <rect class="norm-zone" x="610" y="70" width="450" height="90"/>
      <text class="cap" x="620" y="58">до 3 м — норма</text>
      <line class="axis" x1="40" y1="115" x2="1060" y2="115"/>
      <rect class="door" x="1056" y="85" width="10" height="60"/>
      <text class="cap" x="990" y="192">вход</text>
      <line class="dim" x1="67" y1="115" x2="1060" y2="115"/>
      <g class="term"><rect x="45" y="93" width="44" height="44"/><text x="67" y="122">Т</text></g>
    </svg>
    <ul class="deltas" data-step="3">
      <li><b data-count="0" data-from="1">0</b><span>ошибок, было 1</span></li>
      <li><b data-count="0" data-from="1">0</b><span>предупреждений, было 1</span></li>
      <li><b data-count="100" data-from="87">100</b><span>балл, было 87</span></li>
    </ul>
    <p class="tradeoff" data-step="4"><b>−0,80 м²</b>цена второй скамьи: свободно 114,73 → 113,93 м², объектов 53 → 54</p>
  </div>
  ${note('Демо-план. До правки проверка нашла две находки. Ошибка: терминал очереди в 6,62 метра от входа, норма организаторов — три. Предупреждение: в зоне ожидания одна скамья, правило команды — минимум две. Ассистент нашёл место для терминала и для скамьи. Человек применил их в редакторе. Та же проверка прошла заново: ошибок ноль, предупреждений ноль, балл 87 → 100. Цена — 0,80 квадратного метра свободной площади.')}
</section>


<!-- s9 АРХИТЕКТУРА -->
<section class="slide s-arch" id="s9" data-kind="main" data-title="Архитектура" data-seam="600" aria-label="Архитектура">
  <header class="sl-head">
    <p class="eyebrow in">Архитектура</p>
    <h2 class="title">${ln('Правка — командой,')}${ln('остальное — расчёт')}</h2>
  </header>
  <div class="sl-body arch" data-links="w1>w2|v; w2>w3|v; w3>hub; hub>r1 r2 r3 r4 r5; r5>srv|v">
    <div class="node input wr" data-node="w1" style="--y:0"><p class="tag">Вход</p><h3>Жест, карточка, файл</h3><p>и «Применить» ассистента</p></div>
    <div class="node input wr" data-node="w2" data-step="1" data-packet style="--y:1"><p class="tag">Команда</p><h3>16 типов и batch</h3><p>всё или ничего · одна запись undo</p></div>
    <div class="node input wr" data-node="w3" data-step="1" data-packet style="--y:2"><p class="tag">Допуск</p><h3>6 правил физики</h3><p>новое нарушение — отказ</p></div>
    <div class="node hub" data-node="hub" data-step="1" data-packet>
      <p class="tag">Единое состояние</p>
      <h3>PlanDocument</h3>
      <ul><li>schemaVersion 1</li><li>метры · центр · Y вверх</li><li>справочник внутри</li><li>правка → revision + 1</li></ul>
    </div>
    <div class="reads">
      ${reads.map(([id, name, fn]) => `<div class="node view rd" data-node="${id}" data-step="2" data-packet><h3>${name}</h3><p>${fn}</p></div>`).join('')}
    </div>
    <div class="node input srv" data-node="srv" data-step="3" data-packet><p class="tag">Сервер</p><h3>Повторяет расчёт сам</h3><p>Zod-схема → тот же src/domain → модели только факты → проверка ответа</p></div>
    <div class="node input fence" data-step="4"><p class="tag">Граница · ESLint</p><p>src/domain не импортирует react, konva, three, zustand, store и server</p></div>
    <div class="node input fence" data-step="4"><p class="tag">revision</p><p>Ответ ассистента несёт revision. После правки он устарел</p></div>
  </div>
  ${note('Состояние одно — PlanDocument. Его меняют только команды. Жест на плане, карточка, файл и кнопка «Применить» ассистента дают команду. Группа — это batch: всё или ничего, одна запись undo. Перед записью — допуск: шесть правил физики. Новое нарушение — правка отклонена. Всё остальное — функции плана: инвентаризация, площади, проверка, 3D, расчёт ассистента. Копий плана нет. Сервер не верит браузеру: проверяет файл схемой и повторяет расчёт тем же кодом. Границы модулей держит ESLint. Ответ ассистента привязан к revision: после правки он помечен устаревшим.')}
</section>


<!-- s10 ЦЕПОЧКА РЕШЕНИЙ -->
<section class="slide s-chain" id="s10" data-kind="main" data-title="Почему так" data-seam="1824" aria-label="Цепочка решений">
  <header class="sl-head">
    <p class="eyebrow in">Решения</p>
    <h2 class="title">${ln('Каждое решение')}${ln('закрывает риск')}</h2>
  </header>
  <div class="sl-body chain">
    <svg class="rail-line" viewBox="0 0 1728 10" preserveAspectRatio="none" aria-hidden="true"><line data-draw pathLength="1" x1="0" y1="5" x2="1728" y2="5"/></svg>
    ${decisions.map(([risk, fix], i) => `<article class="link-card" data-step="${i}"><p class="tag">Риск</p><p class="risk">${risk}</p><p class="tag">Решение</p><h3>${fix}</h3></article>`).join('')}
  </div>
  ${note('Каждое решение закрывает риск. Координаты — один контракт: метры, центр, ось Y вверх; отражение оси — только в модуле геометрии. Инвентаризация — функция плана, поэтому не расходится с ним. Модель выбирает из посчитанного, а лишнее поле отвергает весь ответ. Серьёзность находки задаёт источник правила. Справочник едет внутри файла плана, поэтому свой тип не теряется при передаче.')}
</section>


<!-- s11 КОМАНДА И ВОПРОСЫ -->
<section class="slide s-team" id="s11" data-kind="main" data-title="Команда и вопросы" data-seam="1824" aria-label="Наша команда">
  <header class="sl-head">
    <p class="eyebrow in">ИИ-бланки</p>
    <h2 class="title">${ln('Наша команда')}</h2>
  </header>
  <div class="team-grid in">
    ${team.map(([name, role], i) => `<article class="team-card"><div class="portrait portrait-${i + 1}"><img src="../assets/team/member-${i + 1}.png" alt="${name}"></div><h3>${name}</h3><p>${role}</p></article>`).join('')}
  </div>
  <div class="team-ending in"><span>Цифровой двойник ОПС · 158.160.157.55:8080</span><span>↓ Вопросы</span></div>
  <img class="cat" src="../assets/brand/cat-glasses.webp" alt="">
  ${note('Спасибо. Сервис открыт по адресу на слайде, логин не нужен. Готовы ответить на вопросы. Запасные слайды — стрелка вниз.')}
</section>


<!-- b1 ГРАНИЦЫ И РОСТ -->
<section class="slide s-limits" id="b1" data-kind="backup" data-title="Границы и рост" data-seam="1824" aria-label="Границы и рост">
  <header class="sl-head">
    <p class="eyebrow in">Вопросы · что доказано</p>
    <h2 class="title">${ln('Граница ясна,')}${ln('рост — данными')}</h2>
  </header>
  <div class="sl-body limits">
    <section class="col proven" data-step="1"><h3>Проверено</h3><ul><li>Геометрия: помещение, зона, стены, проёмы, потолок, пересечения</li><li>Расстояние до входа — правило организаторов</li><li>Было → стало: площадь, состав, находки</li></ul></section>
    <section class="col edge" data-step="2"><h3>Граница</h3><ul><li>Проходы, эргономику и маршруты не проверяем</li><li>Комплектование — допущение команды, не норматив Почты</li><li>«Не найдено» — не найдено на сетке 0,1 м за 60 000 проб</li></ul></section>
    <section class="col grow" data-step="3"><h3>Рост</h3><ul><li>Другое отделение — другой JSON, код тот же</li><li>Новое правило — строка справочника, серьёзность — из источника</li><li>Другая модель — LLM_PROVIDER и LLM_MODEL в .env</li></ul></section>
  </div>
  ${note('Что доказано: геометрия размещения и расстояние до входа. Эффект правки — в числах. Чего не заявляем: ширину проходов, эргономику, маршруты. Правила комплектования — допущения команды, не норматив Почты. «Не найдено» значит «не найдено перебором», а не «места нет». Рост — данными: другое отделение — другой JSON, новое правило — строка справочника, другая модель — переменная окружения.')}
</section>


<!-- b2 ФОРМАТ ПЛАНА -->
<section class="slide s-format" id="b2" data-kind="backup" data-title="Формат плана" data-seam="560" aria-label="Формат плана">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Формат файла')}${ln('плана')}</h2><p class="lead in">Метры · X вправо · Y вверх · поворот по часовой стрелке</p></header>
  <ul class="open-rules" data-step="1">
    <li><b>Отказ</b>битая ссылка, повтор id, версия новее — открытый план цел</li>
    <li><b>Открыть</b>нарушенная геометрия — план открыт с находками</li>
    <li><b>Назвать</b>поле вне формата названо; своё — в extensions</li>
  </ul>
  <pre class="sl-body code in"><b>PlanDocument</b>  schemaVersion: 1
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


<!-- b3 ПОИСК МЕСТА -->
<section class="slide s-search" id="b3" data-kind="backup" data-title="Поиск места" data-seam="640" aria-label="Поиск места">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Как ассистент')}${ln('ищет место')}</h2></header>
  <div class="sl-body search">
    <ul class="steps-list">
      <li data-step="1"><b>Якорь</b>точка пользователя или центр зоны нужного типа</li>
      <li data-step="2"><b>Кольца</b>сетка 0,1 м, углы 0° и 90°; правило ≤ 3 м сужает перебор</li>
      <li data-step="3"><b>Проверка</b>кандидат в копии плана проходит validatePlan</li>
      <li data-step="4"><b>Стоп</b>24 подтверждённых места или 60 000 проб</li>
    </ul>
    <svg class="rings" viewBox="0 0 520 520" aria-hidden="true">
      ${[60, 120, 180, 240].map((r, i) => `<circle class="r" data-draw pathLength="1" data-delay="${i * 140}" cx="260" cy="260" r="${r}"/>`).join('')}
      <circle class="anchor" cx="260" cy="260" r="10"/>
      ${[[318, 214], [196, 300], [372, 330], [150, 172], [262, 78], [420, 224]].map(([x, y], i) => `<rect class="cand" data-step="3" x="${x - 9}" y="${y - 9}" width="18" height="18" style="--i:${i}"/>`).join('')}
    </svg>
  </div>
  ${note('Перебор идёт кольцами от якоря. Шаг сетки 0,1 метра, углы 0 и 90 градусов. Правило расстояния до входа с серьёзностью «ошибка» сужает сам перебор, а не отсекает результат в конце. Кандидат подставляется в копию плана и проходит тот же validatePlan. Остановка — 24 подтверждённых места или 60 тысяч проб.')}
</section>


<!-- b4 ЗАМЕРЫ -->
<section class="slide s-bench" id="b4" data-kind="backup" data-title="Скорость" data-seam="1824" aria-label="Скорость">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Скорость')}</h2><p class="lead in">План из 1000 объектов работает без задержек</p></header>
  <div class="sl-body bench">
    <table class="in">
      <thead><tr><th>Объекты / зоны</th><th>Открытие</th><th>Выбор</th><th>Zoom</th><th>Сохранить → открыть</th></tr></thead>
      <tbody>
        <tr><td>100 / 10</td><td>0,21 с</td><td>22 мс</td><td>13 мс</td><td>0,35 с</td></tr>
        <tr><td>500 / 30</td><td>0,34 с</td><td>31 мс</td><td>40 мс</td><td>0,52 с</td></tr>
        <tr class="hit"><td>1000 / 50</td><td>0,54 с</td><td>38 мс</td><td>72 мс</td><td>1,29 с</td></tr>
      </tbody>
    </table>
    <ul class="stats" data-step="1">
      <li><b>1,53 с</b><span>поиск места, 1000 объектов</span></li>
      <li><b>1,87 с</b><span>3D: 1000 объектов моделями</span></li>
      <li><b>0,57 с</b><span>перенос объекта: 30 шагов мыши</span></li>
    </ul>
  </div>
  ${note('Пороги: выбор меньше 400 миллисекунд, zoom меньше 300 — соблюдены.')}
</section>


<!-- b5 СТЕК -->
<section class="slide s-stack" id="b5" data-kind="backup" data-title="Стек и зависимости" data-seam="1824" aria-label="Стек и зависимости">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Стек и')}${ln('зависимости')}</h2></header>
  <div class="sl-body stack">
    <section class="col" data-step="1"><h3>Браузер</h3><p>React 19 · Vite 8<br>react-konva — холст 2D<br>Three.js — 3D из плана<br>Zustand — store и undo</p></section>
    <section class="col" data-step="2"><h3>Общий расчёт</h3><p>src/domain — без UI<br>Zod — одна схема для файла и сервера<br>polyclip-ts — объединение следов</p></section>
    <section class="col" data-step="3"><h3>Модель</h3><p>DeepSeek V4 Flash через Yandex AI Studio<br>Провайдер и модель — из .env<br>Без API — «Без LLM»</p></section>
    <section class="col" data-step="4"><h3>Запуск</h3><p>npm ci → npm run dev<br><span class="nw">docker compose up --build -d</span><br>Сервер — Fastify<br>Файл плана до 5 МиБ</p></section>
  </div>
  ${note('Стек из package.json. Расчёт — чистая логика без UI, общая для браузера и сервера. Одна Zod-схема проверяет файл в браузере и план на сервере. Модель подключается по OpenAI-совместимому адресу из .env; допустимы Qwen, DeepSeek, GigaChat, YandexGPT.')}
</section>


<!-- b6 СЦЕНАРИЙ ПРОВЕРЯЮЩЕГО -->
<section class="slide s-flow" id="b6" data-kind="backup" data-title="Сценарий проверяющего" data-seam="1824" aria-label="Сценарий проверяющего">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Сценарий')}${ln('проверяющего')}</h2></header>
  <ol class="sl-body flow">
    <li><b>Открыть</b><span>редактор по адресу сервиса, логин не нужен</span></li>
    <li data-step="1"><b>Загрузить демо</b><span>before.json: схема, затем проверка — 2 находки</span></li>
    <li data-step="2"><b>Изменить</b><span>перенести терминал: отпустил — одна команда</span></li>
    <li data-step="3"><b>Сохранить</b><span>JSON со справочником внутри</span></li>
    <li data-step="4"><b>Открыть заново</b><span>правка на месте, ошибки до входа нет</span></li>
  </ol>
  ${note('Сценарий проверяющего: открыть, загрузить демо, изменить, сохранить, открыть заново. Оба плана из ZIP открываются в редакторе с зонами, оборудованием, id и атрибутами. После переноса терминала ошибка расстояния до входа уходит; предупреждение о скамье остаётся, пока не добавлена вторая.')}
</section>`;

  document.querySelector('.chrome').insertAdjacentHTML('afterend', html);
})();
