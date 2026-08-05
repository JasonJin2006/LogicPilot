// Recently saved/opened models (File > Open Recent), persisted to
// localStorage as { name, dsl, at } entries.

export interface RecentModel {
  name: string;
  dsl: string;
  at: number;
}

const KEY = 'logicpilot.recent';
const MAX_RECENT = 8;

export function loadRecent(): RecentModel[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as RecentModel[]) : [];
  } catch {
    return [];
  }
}

export function addRecent(model: RecentModel): void {
  try {
    const list = [model, ...loadRecent().filter((entry) => entry.name !== model.name)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}
