import { split_assess, type SplitVerdict } from '#scripts/split/split-assess'

// The filing-time counterpart to the split assessment (joshuafolkken/kit#2213).
//
// `split-assessment.md` → "The question" decides whether *one request* is really several
// deliverables; this decides whether *several findings filed from one session* fold into one Issue or
// stay apart. **Both read the same two questions** — are the pieces separable, and does the whole
// clearly exceed what one verification gate confirms in one pass — so the criterion is single-sourced,
// never restated: the size half is `split_assess`'s own verdict, and `separate` needs both halves in
// the same conjunction `split` does.
//
// **The default is `fold`.** Separability alone never separates — it is necessary, not sufficient —
// and a size that does not clear the split guide folds however separable the findings are. That is
// why an unmeasurable size is treated by the caller as under the guide: tipping the doubt toward
// `separate` would reproduce the every-finding-its-own-Issue behavior this exists to end.

type FoldVerdict = 'fold' | 'separate' | 'no-fold-needed'

const FOLD: FoldVerdict = 'fold'
const SEPARATE: FoldVerdict = 'separate'
const NO_FOLD_NEEDED: FoldVerdict = 'no-fold-needed'

// One finding is nothing to fold: the question only arises once a session holds two or more.
const MIN_CANDIDATES = 2

// The same two questions as the split assessment, in the same conjunction: `separate` only when the
// findings are separable **and** their combined size clears the split guide. Either half alone folds,
// and fewer than two candidates is not a fold question at all.
function fold_verdict(
	candidate_count: number,
	is_separable: boolean,
	size_verdict: SplitVerdict,
): FoldVerdict {
	if (candidate_count < MIN_CANDIDATES) return NO_FOLD_NEEDED

	return is_separable && size_verdict === split_assess.SPLIT_VERDICT ? SEPARATE : FOLD
}

const issue_fold = { FOLD, SEPARATE, NO_FOLD_NEEDED, MIN_CANDIDATES, fold_verdict }

export type { FoldVerdict }
export { issue_fold }
