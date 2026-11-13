// How many blob lines the live code panel shows.
export const SAMPLE_LINES = 36

// Chooses which blobs the live code panel shows at each readback.
// - While the active count is still growing: the newest SAMPLE_LINES blobs, so blobs added by growth
//   show up as new lines.
// - Once all `target` blobs are active: an evenly spaced sample that stays the same, so the lines
//   change in place as the fit refines those blobs.
export function createBlobPicker(target: number) {
  return (active: number): number[] => {
    const lines = Math.min(SAMPLE_LINES, active)
    if (active < target) return Array.from({length: lines}, (_, k) => active - lines + k)
    return Array.from({length: lines}, (_, k) => Math.floor(((k + 0.5) * active) / lines))
  }
}
