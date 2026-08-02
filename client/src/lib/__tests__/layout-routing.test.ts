import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Regression: AI-54. Layout должен жить НАД <Switch>, а не оборачивать каждый route через wrapWithLayout.
// До фикса каждый переход между защищёнными страницами размонтировал Layout, что сбрасывало
// состояние (Sidebar collapse, аккордеоны, кеш форм) и перезапрашивало API.
// Этот тест читает исходник App.tsx и проверяет структуру — без подъёма DOM/React-инфраструктуры.

const APP_TSX = path.resolve(__dirname, '../../App.tsx');

function readApp(): string {
  return fs.readFileSync(APP_TSX, 'utf-8');
}

function routerBlock(src: string): string {
  const start = src.indexOf('function Router()');
  const end = src.indexOf('function AppWithWebSocket');
  if (start < 0 || end < 0) return '';
  return stripComments(src.slice(start, end));
}

function stripComments(src: string): string {
  // Drop block comments (`/* ... */`) AND full-line `//` comments.
  // Approximation: good enough for our own source, where we don't put
  // `//` inside strings inside the slice we care about.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('//') ? '' : line;
    })
    .join('\n');
}

describe('AI-54: Layout lives above the protected Switch', () => {
  const rawSrc = readApp();
  const src = stripComments(rawSrc);

  it('не использует устаревшие обёртки wrapWithLayout/WithLayout', () => {
    expect(src).not.toMatch(/wrapWithLayout\b/);
    expect(src).not.toMatch(/const WithLayout\b/);
    // LayoutDashboard/LayoutCampaigns/etc. — артефакты старого per-route-оборачивания.
    expect(src).not.toMatch(/const Layout[A-Z]\w*\s*=/);
  });

  it('внешний <Switch> один, с protected routes как fallback (нет sibling-конструкции)', () => {
    const rb = routerBlock(src);
    expect(rb.length).toBeGreaterThan(0);
    // Ровно один внешний <Switch> внутри Router; второй живёт внутри ProtectedRoutes.
    const outerSwitches = rb.match(/<Switch>(?!\/)/g) ?? [];
    expect(outerSwitches.length).toBe(1);
    // Защищённые роуты попадают внутрь <Layout> через ProtectedRoutes как fallback.
    expect(rb).toMatch(/<Route component=\{ProtectedRoutes\} \/>/);
    // Старая sibling-конструкция (fragment с PublicRoutes/ProtectedRoutes рядом) запрещена.
    expect(rb).not.toMatch(/<PublicRoutes\b/);
    // Отдельного компонента PublicRoutes быть не должно во всём файле.
    expect(src).not.toMatch(/const PublicRoutes\b/);
  });

  it('содержит стабильный <Layout> над protected Switch', () => {
    // <Layout> должен встречаться хотя бы один раз как JSX-тег (не как импорт).
    expect(src).toMatch(/<Layout>/);
    // Второй <Switch> живёт внутри ProtectedRoutes — итого ровно 2 по всему файлу.
    // Anchored regex, чтобы </Switch> не считался.
    const switches = src.match(/<Switch>(?!\/)/g) ?? [];
    expect(switches.length).toBe(2);
  });

  it('инлайнит публичные роуты прямо в Router, защищённые — только как fallback', () => {
    const rb = routerBlock(src);
    // Публичные страницы должны быть прямо в Router.
    expect(rb).toMatch(/component=\{Login\}/);
    expect(rb).toMatch(/component=\{YouTubeCallback\}/);
    expect(rb).toMatch(/component=\{PricingPage\}/);
    expect(rb).toMatch(/component=\{HelpPage\}/);
    // А защищённые страницы — НЕ в Router напрямую, только через ProtectedRoutes.
    expect(rb).not.toMatch(/component=\{Campaigns\}/);
    expect(rb).not.toMatch(/component=\{Content\}/);
  });

  it('корневой роут и dashboard указывают на Dashboard, а не LayoutDashboard', () => {
    expect(src).toMatch(/path="\/dashboard" component=\{Dashboard\}/);
    expect(src).toMatch(/path="\/" component=\{Dashboard\}/);
    expect(src).not.toMatch(/component=\{LayoutDashboard\}/);
  });
});
