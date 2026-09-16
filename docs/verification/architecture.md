# Проверка архитектурного плана — 16.09.2026

Проверяется документация, не готовность приложения. Код приложения, npm scripts и
браузерный сценарий продукта отсутствуют; выполнить продуктовые тесты сейчас нельзя.
Статусы реализации в матрице требований не повышались.

## Команды и фактические результаты

- `git diff --check`: exit 0, замечаний нет.
- `bash .claude/hooks/test-hooks.sh`: 26 строк `ok`, ни одного отказа.
- `bash .claude/hooks/check-upstream.sh`: «Новых коммитов в origin/main нет».
- `bash .claude/hooks/check-secrets.sh`: exit 0, вывод пустой.
- `bash .claude/hooks/check-tests.sh`: exit 0, вывод пустой; это пропуск из-за
  отсутствия тестового проекта, **не** успешное тестирование продукта.
- Проверка документов ниже: ссылки существуют, fences парные, 34 уникальных пакета,
  зависимости без циклов, все 50 обязательных строк матрицы распределены. С6 —
  необязательное видео, в обязательные 50 не входит.
- Сумма `area_sqm` из `example_plan.json`: `[56.25, 21.75, 10.0, 8.75]` → `96.75`.
  Исправлена только опечатка в CLAUDE.md; пример не изменялся.

Повторить структурную проверку из корня worktree:

```bash
python3 - <<'PY'
from pathlib import Path
import re
files = [Path(p) for p in (
    'docs/architecture.md', 'docs/contracts-v1.md',
    'docs/plans/2026-09-16-parallel-plan.md',
    'docs/research/deep-research-brief.md')]
for path in files:
    text = path.read_text()
    assert text.count('```') % 2 == 0, path
    for link in re.findall(r'\]\(([^)]+)\)', text):
        if not link.startswith(('http:', 'https:', '#')):
            assert (path.parent / link.split('#')[0]).exists(), (path, link)
plan = files[2].read_text()
ids = re.findall(r'^### ([A-Z]+\d+) —', plan, re.M)
assert len(ids) == len(set(ids)) == 34
rows = {}
for line in plan.splitlines():
    cells = [value.strip() for value in line.strip('|').split('|')]
    if len(cells) == 5 and cells[0] in ids:
        rows[cells[0]] = set(re.findall(r'\b[A-Z]+\d+\b', ' '.join(cells[3:])))
assert set(rows) == set(ids)
for key, deps in rows.items():
    assert deps <= set(ids), (key, deps - set(ids))
done = set()
while len(done) < len(rows):
    ready = {key for key, deps in rows.items() if key not in done and deps <= done}
    assert ready, ('cycle', set(rows) - done)
    done |= ready
matrix = Path('docs/tz-compliance.md').read_text()
required = set(re.findall(r'^\| ((?:Р|М|П|А|Т|С|3Д)\d+) \|', matrix, re.M)) - {'С6'}
covered = set(re.findall(r'\b(?:Р|М|П|А|Т|С|3Д)\d+\b', plan))
assert required <= covered, required - covered
print(f'PASS: links, fences, {len(ids)} packages, acyclic dependencies, {len(required)} requirements')
PY
```

## Независимое ревью

Свежий агент прочитал только артефакты и правила, без переписки автора. Замечания:

| Замечание | Исправление |
|---|---|
| UI-пакетам не хватает общего протокола инструмента/указателя/focus/preview | Типы Tool, WorldPointer, FocusRequest, EditorSession, ToolController и callbacks в contracts-v1; U03/U04 экспортируют контроллеры pointer-событий; владелец общего контракта F02 |
| Свободные reasonCodes не дают независимости расчёта и шаблонов | Закрытый словарь MetricCode/ReasonCode, фазы и единицы фактов, таблица допустимости, общий корпус fixtures |
| Не определён direct/inclusive и правило терминала у входа | Два конкретных вида Rule с явной областью подсчёта и расстоянием; источник правила хранится в данных |
| Ошибочный полигон может блокировать следующую команду | Политика промежуточного документа: связи null, первичная диагностика, исправление восстанавливает связи; обязательный тест S01 |
| Скрытая зависимость UI-приёмки от app-интегратора | Отдельные browser harness каждого пакета, явные U01a–d для интеграции, итоговый Q01 на реальном приложении |
| Нет протокола сброса dirty | markExported, baseline, режимы file/new/draft и семантика undo; скачивание не выдаётся за подтверждённую запись на диск |

Повторное ревью подтвердило закрытие пяти замечаний; оставшийся явный вход pointer-событий в инструменты добавлен как ToolController с реализациями U03/U04.

Этот отчёт не заменяет будущий jury готового продукта. Первое доказательство
продуктовой готовности — реальный сквозной сценарий в Q01, а не наличие схемы Mermaid.
