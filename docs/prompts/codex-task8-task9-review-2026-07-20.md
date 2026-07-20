# Codex review: Tasks 8/9 (`af92e05`, `506b6a9`) — 2026-07-20

Исполнитель обоих коммитов: Claude (fallback по указанию владельца).  
Кросс-модельный верификатор: Codex.

## Вердикт

- **Task 9 (`506b6a9`) — принято**, блокирующих замечаний нет.
- **Task 8 (`af92e05`) — follow-up реализован в `0b78575`**: основной
  `<pre><code>`-фикс сохранён, потеря текста в inline triple-backtick span
  устранена. Ожидается вторая пара глаз Kimi.

## Resolution — `0b78575`

Codex разделил ветки до изоляции code blocks:

- многострочный fence требует перевода строки после optional language;
- ` ```js``` ` без перевода становится `<code>js</code>`.

Добавлен точный регрессионный тест из finding. Проверки после исправления:

```text
telegram-html.test.ts: 42/42
full suite:             69/69 files, 715/715 tests
tsconfig.critical:      exit 0
```

Коммит содержит только:

- `server/utils/telegram-html.ts`;
- `server/__tests__/telegram-html.test.ts`.

## Проверки

```text
npx.cmd vitest run \
  server/__tests__/telegram-html.test.ts \
  server/__tests__/social-facade-imports.test.ts

Test Files  2 passed (2)
Tests      48 passed (48)
```

```text
npx.cmd vitest run

Test Files  69 passed (69)
Tests      714 passed (714)
```

```text
npx.cmd tsc -p tsconfig.critical.json --noEmit
exit 0
```

`git diff --check` для обоих коммитов — чисто.

## Resolved finding: Task 8 терял inline code с тройным delimiter

**Файл:** `server/utils/telegram-html.ts`, конвертация fences в
`toTelegramHtml`.

Regex

````ts
/```([\w+#-]*)[ \t]*\r?\n?([\s\S]*?)```/g
````

делает перевод строки после opening fence необязательным. Поэтому валидный
markdown code span с тройным backtick-delimiter принимается за fenced block:

````text
input:  text ```js``` tail
actual: text <pre><code class="language-js"></code></pre> tail
````

`js` ошибочно интерпретируется как имя языка, body получается пустым, и
пользовательский текст исчезает.

**Рекомендуемая правка:** различать fenced block и inline code span.
Fenced-ветка должна требовать перевод строки после optional language/info
string. Для однострочного ` ```js``` ` сохранить `js` как содержимое
`<code>`, а не как language пустого `<pre>`.

Обязательный регрессионный тест:

````ts
expect(toTelegramHtml('text ```js``` tail'))
  .toBe('text <code>js</code> tail');
````

Не откатывать корректную часть Task 8: нативное
`<pre><code class="language-…">` и защита HTML внутри настоящих многострочных
fences работают как задумано.

## Suggestions: Task 9 regression guard

Исправленный import `../social-platforms/youtube-shorts-service` существует и
резолвится верно. По всему `server/` нет потребителей
`telegram-proxy-service.ts`; его broken import `../../../shared/types`
подтверждён. Удаление файла остаётся отдельной задачей по решению владельца.

Новый guard полезен, но комментарий «каждый относительный спецификатор» шире
фактической проверки:

1. regex не ловит side-effect imports вида `import './module'`;
2. `resolvesToFile` считает `existsSync(base)` успехом даже для каталога без
   резолвимого `index.*`;
3. не рассматриваются `require(...)` и non-literal dynamic imports.

Это не блокирует Task 9: текущая регрессия покрыта, а в проверяемой директории
side-effect/require импортов сейчас нет. В будущем либо сузить формулировку
комментария, либо усилить guard (AST/реальный resolver и проверка `stat.isFile`).

## Документные follow-ups (писателям файлов)

- `docs/prompts/README.md` (писатель Mavis): Task 8 ошибочно приписан Kimi в
  краткой роли и таблице истории; commit `af92e05` выполнен Claude.
- `claude-roles-and-assignments-2026-07-20.md` (писатель Claude): таблица
  «Раздача на сейчас» в rev8 содержит устаревшие состояния — Task D уже
  `82a1251`, Task 6 уже `2f8d581` и принят Codex, Task 8 уже `af92e05`.

Codex эти чужие single-writer файлы не редактировал.

## Собственные файлы Codex в этом проходе

- `docs/prompts/codex-task8-task9-review-2026-07-20.md`

Ранее созданный и всё ещё untracked:

- `docs/prompts/codex-task6-review-2026-07-20.md`
