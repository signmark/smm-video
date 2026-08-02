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

describe('AI-54: Layout lives above the protected Switch', () => {
  const src = readApp();

  it('не использует устаревшие обёртки wrapWithLayout/WithLayout', () => {
    expect(src).not.toMatch(/wrapWithLayout\b/);
    expect(src).not.toMatch(/const WithLayout\b/);
    // LayoutDashboard/LayoutCampaigns/etc. — артефакты старого per-route-оборачивания.
    expect(src).not.toMatch(/const Layout[A-Z]\w*\s*=/);
  });

  it('содержит стабильный <Layout> над protected Switch', () => {
    // <Layout> должен встречаться хотя бы один раз как JSX-тег (не как импорт).
    expect(src).toMatch(/<Layout>/);
    // Switch должен быть ровно два раза (Public + Protected).
    const switches = src.match(/<Switch>/g) ?? [];
    expect(switches.length).toBe(2);
  });

  it('отделяет публичные роуты (login/callbacks/help) от защищённых', () => {
    const publicIdx = src.indexOf('const PublicRoutes');
    const protectedIdx = src.indexOf('const ProtectedRoutes');
    expect(publicIdx).toBeGreaterThan(0);
    expect(protectedIdx).toBeGreaterThan(0);

    // Защищённые роуты не должны упоминаться в PublicRoutes.
    const publicBlock = src.slice(publicIdx, protectedIdx);
    // Strip comments to avoid matching "<Layout>" in documentation text.

    expect(publicBlock).not.toMatch(/component=\{Campaigns\}/);
    expect(publicBlock).not.toMatch(/component=\{Content\}/);

    // Публичные OAuth callback'и присутствуют в PublicRoutes; ProtectedRoutes — нет.
    expect(publicBlock).toMatch(/YouTubeCallback|InstagramCallback/);
  });

  it('корневой роут и dashboard указывают на Dashboard, а не LayoutDashboard', () => {
    expect(src).toMatch(/path="\/dashboard" component=\{Dashboard\}/);
    expect(src).toMatch(/path="\/" component=\{Dashboard\}/);
    expect(src).not.toMatch(/component=\{LayoutDashboard\}/);
  });
});
