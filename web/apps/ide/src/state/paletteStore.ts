// Palette library store: which library's components the palette shows, the
// recently-used kinds and imported custom libraries (persisted).
//
// Import format (JSON, .lplib/.json):
//   { "name": "MyLib", "blocks": [
//     { "kind": "myblock", "name": "My Block", "hint": "...", "in": true, "out": true }
//   ] }

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CustomBlockDef {
  kind: string;
  name: string;
  hint?: string;
  in?: boolean;
  out?: boolean;
}

export interface CustomLibrary {
  name: string;
  blocks: CustomBlockDef[];
}

const MAX_RECENT = 8;

interface PaletteState {
  /** 'all' | 'recent' | 'process' | a custom library name. */
  library: string;
  customLibraries: Record<string, CustomLibrary>;
  recentKinds: string[];
  setLibrary: (library: string) => void;
  recordUse: (kind: string) => void;
  importLibrary: (source: string, fileName: string) => { ok: boolean; error?: string };
}

export const usePaletteStore = create<PaletteState>()(
  persist(
    (set) => ({
      library: 'all',
      customLibraries: {},
      recentKinds: [],
      setLibrary: (library) => set({ library }),
      recordUse: (kind) =>
        set((state) => ({
          recentKinds: [kind, ...state.recentKinds.filter((entry) => entry !== kind)].slice(
            0,
            MAX_RECENT,
          ),
        })),
      importLibrary: (source, fileName) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(source);
        } catch {
          return { ok: false, error: `'${fileName}' is not valid library JSON` };
        }
        const record = parsed as Partial<CustomLibrary>;
        const name = (record?.name ?? '').trim() || fileName.replace(/\.[^.]+$/, '');
        const blocks = Array.isArray(record?.blocks)
          ? record.blocks
              .filter(
                (block): block is CustomBlockDef =>
                  !!block && typeof block.kind === 'string' && block.kind.trim() !== '',
              )
              .map((block) => ({
                kind: block.kind.trim(),
                name: block.name ?? block.kind.trim(),
                hint: typeof block.hint === 'string' ? block.hint : undefined,
                in: block.in === true,
                out: block.out === true,
              }))
          : [];
        if (blocks.length === 0) {
          return { ok: false, error: `'${fileName}' defines no blocks` };
        }
        const library: CustomLibrary = { name, blocks };
        set((state) => ({
          customLibraries: { ...state.customLibraries, [name]: library },
          library: name,
        }));
        return { ok: true };
      },
    }),
    {
      name: 'logicpilot.palette',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        library: state.library,
        customLibraries: state.customLibraries,
        recentKinds: state.recentKinds,
      }),
    },
  ),
);
