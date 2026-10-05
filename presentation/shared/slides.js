/* Slide content, shared by every variant. Numbers come from README.md («Проверенный объём данных»),
   demo/effect.md and docs/decisions.md. Layout and look live in each variant's styles.css.
   Slide order: 10 main slides (s1–s10), then 5 backup slides for questions (b1–b5, key Q or ↓).
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

  const views = [
    ['v1', 'plan-2d', '2D-редактор', 'правка командами'],
    ['v2', 'inventory', 'Инвентаризация', 'считается из плана'],
    ['v3', 'findings', 'Проверка', 'находки на плане'],
    ['v4', 'view-3d', '3D', 'строится из плана'],
    ['v5', 'assistant', 'Ассистент', 'код считает, модель объясняет'],
  ];

  const decisions = [
    ['2D и 3D расходятся в координатах', 'Метры, центр объекта, ось Y вверх — один контракт'],
    ['Перечень расходится с планом', 'Инвентаризация и 3D считаются из плана, копий нет'],
    ['Модель ошибётся в числе', 'Числа считает код, ответ сверяется, сбой — «Без LLM»'],
    ['Правила Почты известны не все', 'Правило организаторов — ошибка, допущение команды — предупреждение'],
    ['Завтра нужен новый тип оборудования', 'Справочник — данные внутри файла плана'],
  ];

  const html = `
<!-- s1 ТИТУЛ -->
<section class="slide s-title" id="s1" data-kind="main" data-title="Титул" data-seam="1348" aria-label="Титул">
  <p class="eyebrow in">PostCode Challenge от Почтатеха</p>
  <h1 class="title">${ln('Цифровой')}${ln('двойник')}${ln('ОПС')}</h1>
  <p class="lead in">Один план — два вида: 2D и 3D из одного состояния</p>
  <ul class="team-strip in" aria-label="Команда «ИИ-бланки»">
    <li class="team-name">Команда «ИИ-бланки»</li>
    ${team.map(([name, role]) => `<li><b>${name}</b><span>${role}</span></li>`).join('')}
  </ul>
  <div class="twin" data-twin></div>
  <p class="seam-label in">x = 7,5 м</p>
  ${note('Здравствуйте. Мы — команда «ИИ-бланки». Наш проект — цифровой двойник отделения Почты России. Один план отделения — основа для 2D, 3D, проверки, инвентаризации и ассистента.')}
</section>

<!-- s2 ТРИ ВОПРОСА -->
<section class="slide s-qa" id="s2" data-kind="main" data-title="Три вопроса" data-seam="640" aria-label="Три вопроса">
  <header class="sl-head">
    <p class="eyebrow in">Для кого</p>
    <h2 class="title">${ln('Три вопроса —')}${ln('три ответа')}${ln('с числом')}</h2>
    <ul class="roles in"><li>руководитель отделения</li><li>проектировщик перепланировки</li><li>специалист по инвентаризации</li></ul>
  </header>
  <div class="sl-body qa">
    <article class="q" data-step="1"><p class="tag">Найти место</p><h3>Где поставить ещё одно кассовое окно ближе к входу?</h3><p>Варианты нарисованы на плане. Каждый прошёл ту же проверку, что и весь план.</p></article>
    <article class="q" data-step="2"><p class="tag">Комплектование</p><h3>Чего не хватает или что лишнее по оборудованию?</h3><p>Перечень по зонам против правил комплектования.</p></article>
    <article class="q" data-step="3"><p class="tag">Эффект правки</p><h3>Как мои изменения повлияли на свободную площадь?</h3><p>Свободная площадь и инвентаризация: было → стало.</p></article>
  </div>
  ${note('Пользователь — внутренний заказчик: руководитель отделения, проектировщик перепланировки, специалист по инвентаризации. У них три вопроса: куда поставить, чего не хватает, что изменится. Ответ на каждый — с числом и с местом на плане.')}
</section>

<!-- s3 АРХИТЕКТУРА -->
<section class="slide s-arch" id="s3" data-kind="main" data-title="Один план — все виды" data-seam="600" aria-label="Архитектура">
  <header class="sl-head">
    <p class="eyebrow in">Архитектура</p>
    <h2 class="title">${ln('Один план —')}${ln('все виды')}</h2>
    <p class="lead in">Состояние одно. Остальное считается из него.</p>
  </header>
  <div class="sl-body arch" data-links="in1>hub; in2>hub; hub>v1 v2 v3 v4 v5">
    <div class="inputs">
      <div class="node input in" data-node="in1"><p class="tag">Вход</p><h3>Новый план</h3><p>рисуем с нуля</p></div>
      <div class="node input in" data-node="in2"><p class="tag">Вход</p><h3>Готовый план</h3><p>JSON с зонами и объектами</p></div>
    </div>
    <div class="node hub in" data-node="hub">
      <p class="tag">Единое состояние</p>
      <h3>plan.json</h3>
      <ul><li>метры, центр объекта, Y вверх</li><li>справочники внутри файла</li><li>schemaVersion 1</li></ul>
    </div>
    <div class="views">
      ${views.map(([id, img, title, text]) => `<div class="node view" data-node="${id}" data-step="1" data-packet><img src="${shot(img)}" alt=""><div><h3>${title}</h3><p>${text}</p></div></div>`).join('')}
    </div>
    <p class="loop" data-step="2">Любая правка — команда в план. Все виды обновляются сами.</p>
  </div>
  ${note('Главное решение: состояние одно. План — один JSON в метрах, справочники внутри файла. Редактор меняет его командами. Инвентаризация, проверка, 3D и ассистент читают тот же план и своих копий не держат. Входов два, они равноправны: новый план и готовый размеченный.')}
</section>

<!-- s4 ПРОВЕРКА НА ПЛАНЕ -->
<section class="slide s-check" id="s4" data-kind="main" data-title="Проверка на плане" data-seam="700" aria-label="Проверка на плане">
  <header class="sl-head">
    <p class="eyebrow in">Проверка</p>
    <h2 class="title">${ln('Ошибка видна')}${ln('на самом плане')}</h2>
  </header>
  <div class="sl-body check">
    <div class="metric" data-step="2">
      <p class="big"><b data-count="6.62" data-dec="2">6,62</b><span> м</span></p>
      <p>терминал очереди — до главного входа</p>
      <p class="norm">Норма организаторов: не более 3 м</p>
    </div>
    <ul class="legend" data-step="3">
      <li class="err"><b>Ошибка</b><span>правило из материалов организаторов</span></li>
      <li class="warn"><b>Предупреждение</b><span>допущение команды, с пометкой</span></li>
    </ul>
    <figure class="shot" data-step="1">
      <img src="${shot('plan-check')}" alt="Демо-план: находки проверки на плане и в списке">
      <svg class="marks" viewBox="0 0 100 56.25" aria-hidden="true"><g data-step="2"><circle class="ring keep" cx="26.05" cy="29.35" r="2.6"/><circle class="ring keep" cx="38.35" cy="28.8" r="2.6"/><circle class="ring" data-ping data-delay="150" cx="26.05" cy="29.35" r="2.6"/><circle class="ring" data-ping data-delay="400" cx="38.35" cy="28.8" r="2.6"/></g></svg>
    </figure>
  </div>
  ${note('Это демо-план. Проверка нашла терминал очереди в 6,62 метра от входа при норме три метра. Это правило из материалов организаторов, поэтому находка — ошибка. Допущения команды дают предупреждение с пометкой. Находка видна на плане, не только в списке.')}
</section>

<!-- s5 АССИСТЕНТ -->
<section class="slide s-ai" id="s5" data-kind="main" data-title="Ассистент" data-seam="1512" aria-label="Ассистент">
  <header class="sl-head">
    <p class="eyebrow in">ИИ-ассистент</p>
    <h2 class="title">${ln('Модель объясняет,')}${ln('код считает')}${ln('и проверяет')}</h2>
  </header>
  <div class="sl-body pipe" data-links="q>a; a>b; b>c; c>d; d>ok; d>fb|v">
    <div class="lane llm"><span>Модель</span></div>
    <div class="lane code"><span>Код</span></div>
    <div class="node in" data-node="q" style="--c:1;--r:2"><p class="tag">Вопрос</p><h3>Обычная фраза</h3></div>
    <div class="node llm" data-node="a" data-step="1" data-packet style="--c:2;--r:1"><p class="tag">Модель</p><h3>Выбирает сценарий</h3><p>место · комплектование · эффект</p></div>
    <div class="node code" data-node="b" data-step="1" data-packet style="--c:3;--r:2"><p class="tag">Код</p><h3>Считает</h3><p>площади, перебор мест, правила</p></div>
    <div class="node llm" data-node="c" data-step="2" data-packet style="--c:4;--r:1"><p class="tag">Модель</p><h3>Объясняет</h3><p>причина и факты — только из допустимых</p></div>
    <div class="node code gate" data-node="d" data-step="3" data-packet style="--c:5;--r:2"><p class="tag">Код</p><h3>Проверяет</h3><p>id есть, числа совпали с расчётом</p></div>
    <div class="node ok" data-node="ok" data-step="3" data-packet style="--c:6;--r:2"><p class="tag">Результат</p><h3>Вариант на плане</h3></div>
    <div class="node fb" data-node="fb" data-step="4" data-dashed style="--c:5;--r:3"><p class="tag">Сбой или нет API</p><h3>Расчёт «Без LLM»</h3></div>
  </div>
  ${note('Ассистент — два пояса. Модель выбирает сценарий и объясняет. Код считает: площади, перебор мест с шагом 0,1 метра, правила. Потом код проверяет ответ модели: все id существуют, числа совпали с расчётом. Не совпало или API недоступен — показываем расчёт с пометкой «Без LLM».')}
</section>

<!-- s6 ЭФФЕКТ -->
<section class="slide s-effect" id="s6" data-kind="main" data-title="Было → стало" data-seam="620" aria-label="Эффект рекомендации">
  <header class="sl-head">
    <p class="eyebrow in">Результат на демо-плане</p>
    <h2 class="title">${ln('Рекомендация')}${ln('измерима')}</h2>
  </header>
  <div class="sl-body effect">
    <i class="trigger" data-step="2" aria-hidden="true"></i>
    <svg class="dimension" viewBox="0 0 1100 200" aria-label="Расстояние от терминала до входа">
      <rect class="norm-zone" data-step="1" x="610" y="70" width="450" height="90"/>
      <text class="cap" data-step="1" x="620" y="62">до 3 м — норма</text>
      <line class="axis" x1="40" y1="115" x2="1060" y2="115"/>
      <rect class="door" x="1056" y="85" width="10" height="60"/>
      <text class="cap" x="1000" y="185">вход</text>
      <g data-step="1"><line class="dim" x1="67" y1="115" x2="1060" y2="115"/></g>
      <g data-step="1"><g class="term"><rect x="45" y="93" width="44" height="44"/><text x="67" y="122">Т</text></g></g>
    </svg>
    <p class="row"><span class="was" data-step="1"><b data-count="6.62" data-dec="2">6,62</b> м</span><span class="arrow" data-step="2">→</span><span class="now" data-step="2"><b data-count="2.25" data-from="6.62" data-dec="2">2,25</b> м</span></p>
    <ul class="deltas" data-step="3">
      <li><b data-count="0" data-from="1">0</b><span>ошибок, было 1</span></li>
      <li><b data-count="0" data-from="1">0</b><span>предупреждений, было 1</span></li>
    </ul>
    <p class="tradeoff" data-step="4"><b>−0,80 м²</b> свободной площади — цена второй скамьи: 114,73 → 113,93 м², объектов 53 → 54</p>
  </div>
  ${note('Результат на демо-плане. Терминал очереди перенесён: до входа было 6,62 метра, стало 2,25. Ошибок было 1, стало 0. Предупреждений было 1, стало 0. Мы добавили вторую скамью, и цена — 0,80 квадратного метра свободной площади. Обмен виден в числах.')}
</section>

<!-- s7 МАСШТАБ И ДАННЫЕ -->
<section class="slide s-scale" id="s7" data-kind="main" data-title="Масштаб и данные" data-seam="960" aria-label="Масштаб и справочники">
  <header class="sl-head">
    <p class="eyebrow in">Масштаб</p>
    <h2 class="title">${ln('1000 объектов —')}${ln('0,54 с')}</h2>
  </header>
  <div class="sl-body scale">
    <figure class="chart">
      <svg viewBox="0 0 800 440" aria-label="Первое открытие плана: 100, 500 и 1000 объектов">
        <line class="axis" x1="80" y1="380" x2="780" y2="380"/>
        <path class="curve" data-draw pathLength="1" d="M162,268 L410,199 L720,92"/>
        ${[[162, 268, '0,21 с', '100 / 10'], [410, 199, '0,34 с', '500 / 30'], [720, 92, '0,54 с', '1000 / 50']].map(([x, y, t, label], i) => `<circle class="pt" data-step="0" cx="${x}" cy="${y}" r="9" style="--i:${i}"/><text class="val" x="${x}" y="${y - 24}">${t}</text><text class="cap" x="${x}" y="412">${label}</text>`).join('')}
        <text class="cap" x="80" y="30">первое открытие плана</text>
        <text class="cap lab-r" x="780" y="30">объекты / зоны</text>
      </svg>
    </figure>
    <ul class="stats" data-step="1">
      <li><b>38 мс</b><span>выбор объекта</span></li>
      <li><b>72 мс</b><span>шаг zoom</span></li>
      <li><b>1,29 с</b><span>сохранить → открыть</span></li>
    </ul>
    <p class="foot" data-step="1">1000 объектов, 50 зон · Ryzen AI 9 365, Edge, production-сборка · 04.10.2026 · медиана 5 прогонов · команда — в README</p>
    <div class="counters" data-step="2">
      <p><b data-count="25">25</b><span>типов оборудования</span></p>
      <p><b data-count="8">8</b><span>типов зон</span></p>
      <p><b data-count="6">6</b><span>правил комплектования</span></p>
      <p><b data-count="5">5</b><span>типов слоёв</span></p>
    </div>
    <figure class="catalog" data-step="3"><img src="${shot('catalog')}" alt="Настройки: новый тип оборудования без правки кода"><figcaption>Новый тип — форма. Справочник лежит в файле плана.</figcaption></figure>
  </div>
  ${note('Масштаб. План на 1000 объектов и 50 зон открывается за 0,54 секунды. Выбор объекта — 38 миллисекунд, шаг zoom — 72. Замер на Ryzen AI 9 365, production-сборка, команда в README. Справочники — данные: 25 типов оборудования, 8 типов зон, 6 правил, 5 типов слоёв. Новый тип добавляется формой, без правки кода.')}
</section>

<!-- s8 ЦЕПОЧКА РЕШЕНИЙ -->
<section class="slide s-chain" id="s8" data-kind="main" data-title="Почему так" data-seam="1824" aria-label="Цепочка решений">
  <header class="sl-head">
    <p class="eyebrow in">Решения</p>
    <h2 class="title">${ln('Каждое решение')}${ln('закрывает риск')}</h2>
  </header>
  <div class="sl-body chain">
    <svg class="rail-line" viewBox="0 0 1728 10" preserveAspectRatio="none" aria-hidden="true"><line data-draw pathLength="1" x1="0" y1="5" x2="1728" y2="5"/></svg>
    ${decisions.map(([risk, fix], i) => `<article class="link-card" data-step="${i + 1}"><p class="tag">Риск</p><p class="risk">${risk}</p><p class="tag">Решение</p><h3>${fix}</h3></article>`).join('')}
  </div>
  ${note('Каждое решение закрывает риск. Метры и центр объекта — чтобы 2D и 3D не разошлись. Инвентаризация считается из плана. Числа считает код. Правило организаторов — ошибка, допущение команды — предупреждение. Справочник лежит в файле плана.')}
</section>

<!-- s9 ГРАНИЦЫ И РОСТ -->
<section class="slide s-limits" id="s9" data-kind="main" data-title="Границы и рост" data-seam="1824" aria-label="Границы и рост">
  <header class="sl-head">
    <p class="eyebrow in">Что доказано</p>
    <h2 class="title">${ln('Граница ясна,')}${ln('рост — данными')}</h2>
  </header>
  <div class="sl-body limits">
    <section class="col proven" data-step="1"><h3>Проверено</h3><ul><li>Геометрия: объект внутри помещения и зоны, без пересечений</li><li>Расстояние до входа по правилу организаторов</li><li>Состав и свободная площадь: было → стало</li></ul></section>
    <section class="col edge" data-step="2"><h3>Граница</h3><ul><li>Ширину проходов, эргономику и маршруты не проверяем</li><li>Правила комплектования — допущения команды, не норматив Почты</li><li>3D условный: без материалов и света</li></ul></section>
    <section class="col grow" data-step="3"><h3>Рост</h3><ul><li>Другое отделение — другой JSON</li><li>Новое правило — строка справочника</li><li>Другая модель — переменная окружения: Qwen, DeepSeek, GigaChat, YandexGPT</li></ul></section>
  </div>
  ${note('Что доказано: геометрия размещения. Что не заявляем: ширину проходов, эргономику, маршруты. Правила комплектования — допущения команды, не норматив Почты. Расти просто: другое отделение — другой JSON, новое правило — строка справочника, другая модель — переменная окружения.')}
</section>

<!-- s10 КОМАНДА И ВОПРОСЫ -->
<section class="slide s-team" id="s10" data-kind="main" data-title="Команда и вопросы" data-seam="1824" aria-label="Наша команда">
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

<!-- b1 ФОРМАТ ПЛАНА -->
<section class="slide s-format" id="b1" data-kind="backup" data-title="Формат плана" data-seam="560" aria-label="Формат плана">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Формат файла')}${ln('плана')}</h2><p class="lead in">Метры · X вправо · Y вверх · поворот по часовой стрелке</p></header>
  <pre class="sl-body code in"><b>PlanDocument</b>  schemaVersion: 1
├ room       boundary · ceilingHeight_m
├ walls · openings
├ layers     typeId → справочник слоёв
├ zones      id · typeId · parentId (вложенность)
├ objects    id · typeId · position (центр, м)
│            size_m · rotation_deg · zoneId
├ catalog    objectTypes · zoneTypes · layerTypes · rules
└ extensions данные импорта, которых нет в схеме</pre>
  ${note('Формат — версионированный JSON. Справочники едут внутри файла, поэтому свои типы переживают передачу. Структурные ошибки отклоняют файл, геометрические — нет: план открывается с диагностикой.')}
</section>

<!-- b2 ПОИСК МЕСТА -->
<section class="slide s-search" id="b2" data-kind="backup" data-title="Поиск места" data-seam="640" aria-label="Поиск места">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Как ассистент')}${ln('ищет место')}</h2></header>
  <div class="sl-body search">
    <ul class="steps-list">
      <li data-step="1"><b>Якорь</b> — точка пользователя или центр целевой зоны</li>
      <li data-step="2"><b>Кольца</b> от якоря, сетка 0,1 м, углы 0° и 90°</li>
      <li data-step="3"><b>Проверка</b> каждого кандидата тем же validatePlan, что и весь план</li>
      <li data-step="4"><b>Стоп</b> на 24 подтверждённых местах или 60 000 проб; «не найдено» названо прямо</li>
    </ul>
    <svg class="rings" viewBox="0 0 520 520" aria-hidden="true">
      ${[60, 120, 180, 240].map((r, i) => `<circle class="r" data-draw pathLength="1" data-delay="${i * 140}" cx="260" cy="260" r="${r}"/>`).join('')}
      <circle class="anchor" cx="260" cy="260" r="10"/>
      ${[[318, 214], [196, 300], [372, 330], [150, 172], [262, 78], [420, 224]].map(([x, y], i) => `<rect class="cand" data-step="3" x="${x - 9}" y="${y - 9}" width="18" height="18" style="--i:${i}"/>`).join('')}
    </svg>
  </div>
  ${note('Перебор идёт кольцами от якоря. Шаг сетки 0,1 метра, углы 0 и 90 градусов. Каждый кандидат проходит тот же validatePlan, что и весь план. Правило расстояния до входа сужает сам перебор. Остановка — 24 подтверждённых места или 60 тысяч проб.')}
</section>

<!-- b3 ЗАМЕРЫ -->
<section class="slide s-bench" id="b3" data-kind="backup" data-title="Замеры" data-seam="1824" aria-label="Замеры">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Замеры')}</h2><p class="lead in">Ryzen AI 9 365 · Edge 153 · production-сборка · 04.10.2026 · медиана 5 прогонов</p></header>
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
      <li><b>0,57 с</b><span>перенос: 30 шагов мыши, худший кадр 17 мс</span></li>
    </ul>
    <p class="foot" data-step="1">Расчёт ассистента — до обращения к модели. Числа — с локальной машины, не с публичного сервера. Команды замеров — в README.</p>
  </div>
  ${note('Все числа из README с командами. Это локальная машина, не публичный сервер. На слабых машинах команды число больше: README называет 1,2 секунды на Ryzen 7 4800H и 12,6 на Pentium G3220.')}
</section>

<!-- b4 СТЕК -->
<section class="slide s-stack" id="b4" data-kind="backup" data-title="Стек и зависимости" data-seam="1824" aria-label="Стек и зависимости">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Стек и')}${ln('зависимости')}</h2></header>
  <div class="sl-body stack">
    <section class="col" data-step="1"><h3>Браузер</h3><p>TypeScript · React 19 · Vite 8<br>react-konva (холст) · Three.js (3D)<br>Zustand · Zod</p></section>
    <section class="col" data-step="2"><h3>Сервер</h3><p>Fastify · polyclip-ts (операции над полигонами)<br>Расчёт общий для сервера и браузера</p></section>
    <section class="col" data-step="3"><h3>Модель</h3><p>DeepSeek V4 Flash через Yandex AI Studio<br>Провайдер и модель — из .env<br>Без API — расчёт «Без LLM»</p></section>
    <section class="col" data-step="4"><h3>Запуск</h3><p>npm ci → npm run dev<br>docker compose up --build -d<br>Лимит файла плана 5 МиБ</p></section>
  </div>
  ${note('Стек из package.json. Расчёт — чистая логика, общая для браузера и сервера. Модель подключается по OpenAI-совместимому адресу из .env; допустимы Qwen, DeepSeek, GigaChat, YandexGPT.')}
</section>

<!-- b5 СЦЕНАРИЙ ПРОВЕРЯЮЩЕГО -->
<section class="slide s-flow" id="b5" data-kind="backup" data-title="Сценарий проверяющего" data-seam="1824" aria-label="Сценарий проверяющего">
  <header class="sl-head"><p class="eyebrow in">Вопросы</p><h2 class="title">${ln('Сценарий')}${ln('проверяющего')}</h2></header>
  <ol class="sl-body flow">
    <li data-step="1"><b>Открыть</b><span>редактор по адресу сервиса</span></li>
    <li data-step="2"><b>Загрузить демо</b><span>before.json из ZIP</span></li>
    <li data-step="3"><b>Изменить</b><span>перенести терминал очереди</span></li>
    <li data-step="4"><b>Сохранить</b><span>файл плана — JSON</span></li>
    <li data-step="5"><b>Открыть заново</b><span>правка на месте</span></li>
  </ol>
  ${note('Сценарий проверяющего: открыть, загрузить демо, изменить, сохранить, открыть заново. Оба плана из ZIP открываются в редакторе с зонами, оборудованием, id и атрибутами.')}
</section>`;

  document.querySelector('.chrome').insertAdjacentHTML('afterend', html);
})();
