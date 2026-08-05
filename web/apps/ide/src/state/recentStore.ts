// Recently saved/opened models (File > Open Recent), persisted to
// localStorage as { name, bundle, at } entries. `bundle` is the serialized
// `*.lpproj` project (source + canvas); legacy entries may carry raw `dsl`.

export interface RecentModel {
  name: string;
  at: number;
  /** Serialized `*.lpproj` project bundle. */
  bundle?: string;
  /** Legacy: raw DSL text saved before project bundles existed. */
  dsl?: string;
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

export function removeRecent(name: string): void {
  try {
    const list = loadRecent().filter((entry) => entry.name !== name);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}
