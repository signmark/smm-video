import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'image-gen-usage.json');

interface UsageEntry {
  count: number;
  month: string; // YYYY-MM
}

interface UsageData {
  [userId: string]: UsageEntry;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadData(): UsageData {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveData(data: UsageData): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[image-gen-tracker] Failed to save usage data:', e);
  }
}

export function getUsage(userId: string): { count: number; month: string } {
  const data = loadData();
  const currentMonth = getCurrentMonth();
  const entry = data[userId];
  if (!entry || entry.month !== currentMonth) {
    return { count: 0, month: currentMonth };
  }
  return { count: entry.count, month: currentMonth };
}

export function incrementUsage(userId: string): number {
  const data = loadData();
  const currentMonth = getCurrentMonth();
  const entry = data[userId];
  if (!entry || entry.month !== currentMonth) {
    data[userId] = { count: 1, month: currentMonth };
  } else {
    data[userId].count += 1;
  }
  saveData(data);
  return data[userId].count;
}

export function canGenerate(userId: string, limit: number): boolean {
  const { count } = getUsage(userId);
  return count < limit;
}
