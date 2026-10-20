// Hand-written elevation keys: [centerline point index, metres above the lowest point].
// Point spacing is ~5 m, so index * 5 is roughly the distance from the start line.
export default {
  // Steep climb from the start line up to Turn 1 (~120), then rolling down through the esses.
  cota: [[0, 0], [118, 38], [165, 30], [230, 12], [330, 6], [400, 4], [526, 5], [750, 5], [800, 3], [900, 0], [1000, 4], [1101, 0]],
  // Bottom of Eau Rouge (~207), steep Raidillon climb, Kemmel to the high point at Les Combes (~470),
  // then descending through the middle sector (Rivage, Pouhon).
  spa: [[0, 30], [78, 35], [207, 0], [250, 30], [470, 100], [530, 92], [614, 55], [790, 32], [990, 55], [1200, 60], [1357, 42], [1400, 30]],
};
