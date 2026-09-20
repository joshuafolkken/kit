import { review_level } from './review-level'

// Whether a review finding reaches a runtime path — the half of the three-way disposition a machine
// can answer (joshuafolkken/kit#2181). `prompts/review.md` → "Three-way disposition after the cap"
// routes a non-High finding to branch 2 (file it) only when it is a **confirmed defect that reaches a
// runtime code path**. "Reaches" is read exactly as the review-level rubric reads it — a runtime code
// path, a distributed artifact a consumer reads, or the verification guarding either — which is the
// same question `review-level.ts`'s inert set answers by its complement.
//
// **The classifier is shared, not copied.** `is_inert` is the single source of "cannot escape this
// repository", and this reuses it rather than re-listing the paths — a distinct answer from
// `test-declared-logic.ts`'s `EXEMPT_*`, which asks whether an automated test could have caught the
// defect and so keeps documentation exempt. Disposition asks whether the finding escapes, and a
// distributed document does; that is why it shares the inert set and not the exempt one
// (decision recorded on the issue, 2026-09-21).

type Disposition = 'runtime' | 'non-runtime'

const RUNTIME: Disposition = 'runtime'
const NON_RUNTIME: Disposition = 'non-runtime'

// A finding reaches a runtime path when any path it touches is non-inert. Every path inert means the
// finding cannot escape — `non-runtime`. No path at all takes `runtime`, the file-eligible answer, for
// the same reason `level_for` gives an empty diff the default level: a caller that failed to read the
// finding's paths must not be handed the drop-eligible verdict as though it had.
function disposition_for(paths: ReadonlyArray<string>): Disposition {
	const named = paths.map((path) => path.trim()).filter((path) => path !== '')

	if (named.length === 0) return RUNTIME

	return named.every((path) => review_level.is_inert(path)) ? NON_RUNTIME : RUNTIME
}

// The non-inert paths that made the finding reach — so the answer can say why, mirroring
// `review_level.deciding_paths`.
function reaching_paths(paths: ReadonlyArray<string>): Array<string> {
	return paths
		.map((path) => path.trim())
		.filter((path) => path !== '' && !review_level.is_inert(path))
}

const disposition = { NON_RUNTIME, RUNTIME, disposition_for, reaching_paths }

export type { Disposition }
export { disposition }
