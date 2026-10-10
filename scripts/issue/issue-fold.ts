import { split_assess, type SplitVerdict } from '#scripts/split/split-assess'

// The filing-time counterpart to the split assessment.
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
// why an unmeasurable size never tips to `separate`: that would reproduce the every-finding-its-own-Issue
// behavior this exists to end.
//
// **Nor does an unmeasurable size fold**. The size half is read off the working
// tree's diff, and a filing made before any implementation — `kickoff new`, a split's children — has
// no diff that says anything about the findings' size. Reading that as `single` folded every such
// filing; it answers `undetermined` instead, which leaves the size to the whole request's estimate
// (`split-assessment.md` → "The question").

type FoldVerdict = 'fold' | 'separate' | 'no-fold-needed' | 'undetermined'

const FOLD: FoldVerdict = 'fold'
const SEPARATE: FoldVerdict = 'separate'
const NO_FOLD_NEEDED: FoldVerdict = 'no-fold-needed'
const UNDETERMINED: FoldVerdict = 'undetermined'

// One finding is nothing to fold: the question only arises once a session holds two or more.
const MIN_CANDIDATES = 2

// Separable findings: the size alone decides, and a size nobody measured decides nothing.
function separable_verdict(size_verdict: SplitVerdict | undefined): FoldVerdict {
	if (size_verdict === undefined) return UNDETERMINED

	return size_verdict === split_assess.SPLIT_VERDICT ? SEPARATE : FOLD
}

// The same two questions as the split assessment, in the same conjunction: `separate` only when the
// findings are separable **and** their combined size clears the split guide. Either half alone folds,
// and fewer than two candidates is not a fold question at all. An `undefined` size is one the diff
// could not measure, which decides nothing.
function fold_verdict(
	candidate_count: number,
	is_separable: boolean,
	size_verdict: SplitVerdict | undefined,
): FoldVerdict {
	if (candidate_count < MIN_CANDIDATES) return NO_FOLD_NEEDED

	return is_separable ? separable_verdict(size_verdict) : FOLD
}

const issue_fold = { FOLD, SEPARATE, NO_FOLD_NEEDED, UNDETERMINED, MIN_CANDIDATES, fold_verdict }

export type { FoldVerdict }
export { issue_fold }
