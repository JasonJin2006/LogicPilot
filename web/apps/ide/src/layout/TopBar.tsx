// Top bar: small logo on the left and a centered command/model search box.
// Height is 2/3 of the original top bar (--status-h * 4 / 3).

export function TopBar() {
  return (
    <div className="top-bar">
      <img className="top-logo" src="/logo.svg" alt="LogicPilot" />
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
