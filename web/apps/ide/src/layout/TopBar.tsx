// Top bar: small logo on the left and a centered command/model search box.
// Height is twice the status bar (--status-h * 2).

import { Cpu } from 'lucide-react';

export function TopBar() {
  return (
    <div className="top-bar">
      <div className="top-logo" title="LogicPilot">
        <Cpu size={18} />
      </div>
      <input
        className="search-box"
        type="search"
        placeholder="Search models, blocks, commands…"
        spellCheck={false}
        aria-label="Search"
      />
    </div>
  );
}
