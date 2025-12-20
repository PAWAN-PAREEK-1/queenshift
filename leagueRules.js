// leagueRules.js
export const LEAGUES = [
  // GOLD (lower league)
  { name: "gold", level: 1, min: 0, max: 49 },
  { name: "gold", level: 2, min: 50, max: 89 },
  { name: "gold", level: 3, min: 90, max: 179 },

  // DIAMOND (higher league)
  { name: "diamond", level: 1, min: 180, max: 249 },
  { name: "diamond", level: 2, min: 250, max: 349 },
  { name: "diamond", level: 3, min: 350, max: Infinity },
];
