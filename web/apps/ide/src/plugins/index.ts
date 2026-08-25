// Composition root for paradigm plugins (ADR-0068). This module is imported
// FIRST by App.tsx so every registry is populated before persisted layouts
// validate against the panel table and before file routing resolves.
//
// Adding a paradigm: create src/<paradigm>/ with its contribution modules,
// write a plugin file here performing the imports, add one line below.
// Removing a paradigm: delete the line and the directory.

import type { LogicPilotPlugin } from './types';
import { desPlugin } from './des';
import { sysmlPlugin } from './sysml';

import './des';
import './sysml';

/** Registry metadata of the bundled plugins (order = activation order). */
export const BUNDLED_PLUGINS: readonly LogicPilotPlugin[] = [desPlugin, sysmlPlugin];
