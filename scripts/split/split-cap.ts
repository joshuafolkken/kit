// The fallback split guide and its cap, with no imports so a `lane:stats` reader can apply the cap
// without the cycle `split-assess` → `lane-implement-rate` → `lane-size-stats` (joshuafolkken/kit#7579).

interface SplitCap {
	files: number
	lines: number
}

// The guide's single source: `split-assessment.md` states these once and a test pins the two equal.
// Strictly greater than: "more than" puts the bar above the number, not at it. Lowered from 10 / 400
// once a lane estimated at 6 files / 250 lines merged at about 23 files / 390 lines (joshuafolkken/kit#5384).
const FILE_GUIDE = 8
const LINE_GUIDE = 200
// The cap, one and a half times the guide: past it a declared reason no longer keeps an Issue as one. A
// lane declared past it with a reason overran both its time budget and its declared files by far
// (joshuafolkken/kit#5502). Lowered from 3 once the projected implement time became the main bar — the
// cap is the backstop where no rate is measured (joshuafolkken/kit#6066).
const CAP_FACTOR = 1.5
const FILE_CAP = FILE_GUIDE * CAP_FACTOR
const LINE_CAP = LINE_GUIDE * CAP_FACTOR
const DEFAULT_CAP: SplitCap = { files: FILE_CAP, lines: LINE_CAP }

// Strictly greater than, as the guide is: the cap itself still runs as one Issue.
function is_over(files: number, lines: number, cap: SplitCap = DEFAULT_CAP): boolean {
	return files > cap.files || lines > cap.lines
}

const split_cap = { CAP_FACTOR, DEFAULT_CAP, FILE_CAP, FILE_GUIDE, LINE_CAP, LINE_GUIDE, is_over }

export { split_cap }
export type { SplitCap }
