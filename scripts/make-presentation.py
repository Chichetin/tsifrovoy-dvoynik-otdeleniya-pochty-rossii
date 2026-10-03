"""Create the one-file PDF presentation from verified E01 screenshots and facts.

Run capture-presentation.ts against the local built service first. This script
requires reportlab and Pillow; it writes only output/pdf/*.pdf.
"""

import os
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "build" / "presentation"
OUT = ROOT / "output" / "pdf" / "posttech-digital-twin-2026-09-18.pdf"
W, H = 960, 540
NAVY = colors.HexColor("#10253D")
BLUE = colors.HexColor("#1769BE")
LIGHT = colors.HexColor("#F3F7FB")
PALE = colors.HexColor("#E7F1FC")
MUTED = colors.HexColor("#53677E")
ORANGE = colors.HexColor("#F2A423")
GREEN = colors.HexColor("#1D9E7B")
RED = colors.HexColor("#C34B4B")

def font_path(env_name, candidates):
    paths = ([Path(os.environ[env_name])] if os.environ.get(env_name) else []) + [Path(p) for p in candidates]
    for path in paths:
        if path.is_file():
            return str(path)
    raise SystemExit(f"Cyrillic font not found; set {env_name}")


pdfmetrics.registerFont(TTFont("Arial", font_path("PRESENTATION_FONT_REGULAR", [
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
])))
pdfmetrics.registerFont(TTFont("ArialBold", font_path("PRESENTATION_FONT_BOLD", [
    r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
])))
pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="ArialBold")


def text(c, value, x, top, width, size=18, color=NAVY, bold=False, leading=None):
    style = ParagraphStyle(
        "slide",
        fontName="ArialBold" if bold else "Arial",
        fontSize=size,
        leading=leading or size * 1.25,
        textColor=color,
        spaceBefore=0,
        spaceAfter=0,
    )
    p = Paragraph(value, style)
    _, height = p.wrap(width, H)
    p.drawOn(c, x, top - height)
    return top - height


def header(c, number, title, subtitle=""):
    c.setFillColor(colors.white)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.rect(0, H - 9, W, 9, fill=1, stroke=0)
    text(c, title, 44, 505, 872, 29, NAVY, True)
    if subtitle:
        text(c, subtitle, 44, 465, 872, 12, MUTED)
    c.setStrokeColor(colors.HexColor("#DCE6F1"))
    c.line(44, 38, W - 44, 38)
    text(c, "Почтатех • Цифровой двойник ОПС • 18.09.2026", 44, 32, 750, 9, MUTED)
    text(c, f"{number} / 6", 872, 32, 45, 9, MUTED)


def card(c, x, y, width, height, title, body, fill=LIGHT, title_color=NAVY):
    c.setFillColor(fill)
    c.roundRect(x, y, width, height, 12, fill=1, stroke=0)
    text(c, title, x + 18, y + height - 17, width - 36, 17, title_color, True)
    text(c, body, x + 18, y + height - 50, width - 36, 12, NAVY)


def framed_image(c, path, box, crop=None):
    x, y, width, height = box
    image = Image.open(path).convert("RGB")
    if crop:
        image = image.crop(crop)
    iw, ih = image.size
    scale = min(width / iw, height / ih)
    draw_w, draw_h = iw * scale, ih * scale
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#D7E1EC"))
    c.roundRect(x - 5, y - 5, width + 10, height + 10, 9, fill=1, stroke=1)
    c.drawImage(ImageReader(image), x + (width - draw_w) / 2, y + (height - draw_h) / 2,
                width=draw_w, height=draw_h, mask="auto")


def pill(c, x, y, width, value, fill=PALE, color=BLUE):
    c.setFillColor(fill)
    c.roundRect(x, y, width, 31, 15, fill=1, stroke=0)
    text(c, value, x + 12, y + 23, width - 24, 12, color, True)


for name in ("before.png", "after.png", "advice.png", "view3d.png"):
    if not (SHOTS / name).exists():
        raise SystemExit(f"Missing screenshot {name}; run scripts/capture-presentation.ts")
OUT.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
c.setTitle("Цифровой двойник отделения Почты России — презентация решения")
c.setAuthor("Команда хакатона Почтатех")
c.setSubject("Синтетический демо-проект, проверяемые рекомендации, ограничения")

# 1 — opener
c.setFillColor(NAVY)
c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(BLUE)
c.roundRect(44, 454, 176, 27, 13, fill=1, stroke=0)
text(c, "ХАКАТОН ПОЧТАТЕХ", 58, 473, 160, 11, colors.white, True)
text(c, "Цифровой двойник<br/>отделения Почты России", 44, 430, 820, 37, colors.white, True, 44)
text(c, "Редактор плана • проверка • инвентаризация • объяснимые рекомендации", 44, 321, 850, 16,
     colors.HexColor("#C9DCF2"))
framed_image(c, SHOTS / "before.png", (44, 56, 600, 215), (260, 80, 1260, 930))
card(c, 676, 57, 240, 215, "Демо своими руками", "8 зон, 53 объекта, один редактируемый JSON. План создан командой на синтетических данных.",
     colors.HexColor("#EAF2FB"), NAVY)
text(c, "Версия на базе main 13dac98 • локальный сервис • без публичного адреса", 44, 30, 840, 10,
     colors.HexColor("#AFC5DC"))
text(c, "1 / 6", 870, 30, 46, 10, colors.HexColor("#AFC5DC"))
c.showPage()

# 2 — workflow
header(c, 2, "Один план — несколько представлений", "Действия пользователя меняют PlanDocument; панели читают одно и то же состояние")
card(c, 44, 270, 265, 145, "2D-редактор", "Границы помещения, перегородки, проёмы, вложенные зоны и оборудование из библиотеки.")
card(c, 347, 270, 265, 145, "Проверка и учёт", "Уникальные id, атрибуты, инвентаризация, площади и ошибки геометрии.")
card(c, 650, 270, 265, 145, "3D и ассистент", "Условные объёмы и рекомендации строятся из текущего плана; правки остаются за человеком.")
for x in (326, 629):
    c.setStrokeColor(BLUE)
    c.setLineWidth(3)
    c.line(x - 8, 342, x + 8, 342)
    c.line(x + 3, 347, x + 8, 342)
    c.line(x + 3, 337, x + 8, 342)
card(c, 44, 95, 871, 132, "Портативный формат",
     "Файл JSON schemaVersion: 1 хранит геометрию, зоны, объекты, связи и снимок справочника. «Сохранить → открыть» сохраняет id и атрибуты; новый тип оборудования переносится вместе с планом.", PALE)
text(c, "Доказательства: src/contracts/model.ts · tests/e2e/round-trip.spec.ts · src/domain/catalog/catalog.test.ts",
     44, 69, 870, 9, MUTED)
c.showPage()

# 3 — before/after
header(c, 3, "Собственный демо-проект: до и после", "Синтетическое отделение, L-образный контур 132 м²; оба плана открываются и редактируются")
framed_image(c, SHOTS / "before.png", (44, 145, 416, 262), (260, 180, 1260, 920))
framed_image(c, SHOTS / "after.png", (500, 145, 416, 262), (260, 180, 1260, 920))
pill(c, 44, 414, 154, "ДО • 3 замечания", colors.HexColor("#FBE9E8"), RED)
pill(c, 500, 414, 178, "ПОСЛЕ • 0 замечаний", colors.HexColor("#E5F6EF"), GREEN)
text(c, "Добавили скамью ожидания · убрали лишнее табло · перенесли терминал очереди ближе ко входу",
     44, 124, 870, 15, NAVY, True)
text(c, "1 ошибка + 2 предупреждения → 0; расстояние терминала до входа 6,62 → 2,25 м.",
     44, 94, 870, 13, MUTED)
text(c, "Источник: demo/effect.md; проверки tests/demo.test.ts и tests/e2e/demo.spec.ts. Правила команды — не нормативы Почты России.",
     44, 65, 870, 9, MUTED)
c.showPage()

# 4 — assistant
header(c, 4, "Ассистент объясняет проверенный расчёт", "Три сценария: найти место, проверить комплектование, сравнить состояние «до → после»")
framed_image(c, SHOTS / "advice.png", (44, 75, 276, 348), (1260, 390, 1600, 960))
card(c, 350, 305, 565, 118, "Числа считает код",
     "Перебор кандидатов проверяет геометрию и правила. Ответ содержит id объекта и зоны, факты, источник правила и ограничения.")
card(c, 350, 166, 565, 118, "Модель только объясняет",
     "Внешний ответ проходит проверку допустимых id и фактов. Если ключа нет или ответ неверен, сервис показывает тот же расчёт с явной пометкой «Без LLM».", PALE)
text(c, "Живой вызов провайдера подтверждён 19.09: DeepSeek-V4-Flash через Yandex Cloud AI Studio, mode=llm (docs/verification/llm-live-2026-09-19.md).",
     350, 129, 565, 13, RED, True)
text(c, "Источник: demo/recommendation.json · src/domain/advice · server/advice-route.test.ts",
     350, 91, 565, 9, MUTED)
c.showPage()

# 5 — 3D and volume
header(c, 5, "3D следует текущему 2D-плану", "Условные объёмы: пол и зоны, стены с проёмами, оборудование по размерам и высоте")
framed_image(c, SHOTS / "view3d.png", (44, 91, 606, 336), (260, 86, 1260, 930))
card(c, 684, 288, 232, 139, "Одна модель", "3D не хранит свою копию плана. Скрытые слои не попадают в сцену; объект меняется в 2D — меняется и здесь.")
card(c, 684, 109, 232, 156, "Честное ограничение", "Это не фотореалистичная визуализация: нет расчёта маршрутов, доступности или эргономики. При недоступном WebGL редактор 2D остаётся доступным.", PALE)
text(c, "Источник: src/features/view3d/scene.ts", 44, 65, 600, 9, MUTED)
c.showPage()

# 6 — measured result and delivery status
header(c, 6, "Проверено — и что осталось до сдачи", "Измерения на синтетических планах; результаты не переносятся автоматически на реальное отделение")
text(c, "Объектов / зон", 56, 424, 180, 12, MUTED, True)
text(c, "Открытие p50", 327, 424, 180, 12, MUTED, True)
text(c, "Сохранить → открыть p50", 573, 424, 300, 12, MUTED, True)
for y, volume, opened, roundtrip, bar in [
    (378, "100 / 10", "0,28 с", "0,25 с", 25),
    (328, "500 / 30", "1,16 с", "1,70 с", 80),
    (278, "1000 / 50", "4,52 с", "6,20 с", 145),
]:
    c.setFillColor(LIGHT)
    c.roundRect(44, y - 13, 871, 42, 6, fill=1, stroke=0)
    text(c, volume, 58, y + 14, 180, 16, NAVY, True)
    c.setFillColor(BLUE)
    c.roundRect(327, y - 1, bar, 10, 5, fill=1, stroke=0)
    text(c, opened, 327 + bar + 10, y + 13, 90, 13, NAVY)
    text(c, roundtrip, 576, y + 14, 190, 14, NAVY, True)
text(c, "Пять прогонов на объём, Chrome 153, Ryzen AI 9 365; кандидат 17ad4dc. Подробнее: docs/verification/performance-rc.md.",
     44, 238, 870, 10, MUTED)
card(c, 44, 94, 416, 117, "Готово", "Исходный код и README в GitLab; демо-ZIP с двумя редактируемыми планами; локальные unit, Chrome e2e и Docker-сборка.", colors.HexColor("#E5F6EF"), GREEN)
card(c, 500, 94, 416, 117, "Открыто", "Публичный адрес ещё не выбран. Живой вызов LLM проверен локально (DeepSeek-V4-Flash, mode=llm); на публичном сервере нужен тот же ключ. Для сдачи нужны внешний прогон и прикрепление PDF.", colors.HexColor("#FFF0E7"), RED)
c.setFillColor(BLUE)
c.roundRect(44, 51, 872, 30, 7, fill=1, stroke=0)
text(c, "GitLab: git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/…", 57, 73, 840, 12, colors.white, True)
c.linkURL("https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii", (44, 51, 916, 81), relative=0)
c.showPage()
c.save()
print(f"{OUT} ({OUT.stat().st_size} bytes)")
