/**
 * Каркас не должен размонтироваться при загрузке страницы (AI-77).
 *
 * Страницы лениво подгружаются через React.lazy. React ищет БЛИЖАЙШУЮ границу
 * Suspense вверх по дереву: если единственная граница стоит снаружи всего
 * приложения, то при первом заходе на раздел размонтируется всё, включая
 * Sidebar и Topbar, и пользователь видит спиннер на весь экран вместо смены
 * содержимого. Именно это владелец и увидел после AI-77: жёсткие перезагрузки
 * убрали, а каркас всё равно пересобирался.
 *
 * Проверяем структуру исходника, а не рендер: компонентного окружения в
 * проекте пока нет (это AI-59), а вопрос здесь чисто структурный — где стоит
 * граница относительно <Layout>.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = () => readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf-8');

describe('AI-77: граница загрузки внутри каркаса', () => {
  it('внутри <Layout> есть своя граница Suspense', () => {
    const src = appSource();
    const layoutOpen = src.indexOf('<Layout>');
    const layoutClose = src.indexOf('</Layout>', layoutOpen);

    expect(layoutOpen).toBeGreaterThan(0);
    expect(layoutClose).toBeGreaterThan(layoutOpen);

    const insideLayout = src.slice(layoutOpen, layoutClose);
    expect(insideLayout).toContain('<Suspense');
  });

  it('граница стоит до <Switch>, то есть покрывает все защищённые страницы', () => {
    const src = appSource();
    const layoutOpen = src.indexOf('<Layout>');
    const inner = src.slice(layoutOpen, src.indexOf('</Layout>', layoutOpen));

    const suspenseAt = inner.indexOf('<Suspense');
    const switchAt = inner.indexOf('<Switch>');

    expect(suspenseAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(suspenseAt);
  });

  it('фолбэк содержимого не растягивается на весь экран', () => {
    // min-h-screen внутри каркаса дал бы пустой экран под меню — визуально это
    // тот же самый дефект, только с сохранившимся Sidebar.
    const src = appSource();
    const start = src.indexOf('const ContentLoading');
    const end = src.indexOf('const ProtectedRoutes', start);

    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end)).not.toContain('min-h-screen');
  });
});
