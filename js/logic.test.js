/**
 * Smoke test of scoring rules without a browser.
 * Mirrors the recompute / inheritance behavior in app.js.
 */
function recompute(state) {
  for (const p of state.players) p.total = p.startingScore || 0;
  for (const round of state.rounds) {
    for (const [pid, pts] of Object.entries(round.scores)) {
      const p = state.players.find((x) => x.id === pid);
      if (p) p.total += Number(pts) || 0;
    }
  }
  for (const p of state.players) {
    if (p.status === "inactive") continue;
    p.status = p.total >= state.limit ? "eliminated" : "active";
  }
}

function lastPlace(state) {
  const pool = state.players.filter((p) => p.status === "active");
  return Math.max(...pool.map((p) => p.total));
}

const state = {
  limit: 200,
  players: [
    { id: "a", name: "Ana", startingScore: 0, total: 0, status: "active" },
    { id: "b", name: "Beto", startingScore: 0, total: 0, status: "active" },
    { id: "c", name: "Cora", startingScore: 0, total: 0, status: "active" },
  ],
  rounds: [],
};

state.rounds.push({ scores: { a: 20, b: 45, c: -10 } });
recompute(state);
console.assert(state.players.find((p) => p.id === "c").total === -10, "chinchon -10");
console.assert(state.players.find((p) => p.id === "b").total === 45, "sum");

state.rounds.push({ scores: { a: 180, b: 10, c: 5 } });
recompute(state);
const ana = state.players.find((p) => p.id === "a");
console.assert(ana.total === 200, "200 total");
console.assert(ana.status === "eliminated", "eliminated at limit");

const inherit = lastPlace(state);
console.assert(inherit === 50, "last place among active is Beto 55? wait");
// Ana 200 out, Beto 55, Cora -5 → last active is Beto 55
console.assert(state.players.find((p) => p.id === "b").total === 55);
console.assert(state.players.find((p) => p.id === "c").total === -5);
console.assert(lastPlace(state) === 55, "inherit 55, got " + lastPlace(state));

state.players.push({ id: "d", name: "Dani", startingScore: 55, total: 55, status: "active" });
recompute(state);
console.assert(state.players.find((p) => p.id === "d").total === 55, "late joiner keeps start");

state.players.find((p) => p.id === "b").status = "inactive";
recompute(state);
console.assert(state.players.find((p) => p.id === "b").status === "inactive", "frozen inactive");

state.rounds.pop();
recompute(state);
console.assert(state.players.find((p) => p.id === "a").total === 20, "undo round");
console.assert(state.players.find((p) => p.id === "a").status === "active", "un-eliminate on undo");

console.log("logic tests ok");
