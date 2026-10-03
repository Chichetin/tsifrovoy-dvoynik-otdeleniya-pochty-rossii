# src/features/files

Загрузка файла, подготовка скачивания, подтверждение замены dirty-документа.

**Владелец:** поток 3. **Пакеты:** IO03.

## Граница модуля

Потребляет contracts и persistence. replaceDocument/markExported получает callback; не сериализует сцену холста.
