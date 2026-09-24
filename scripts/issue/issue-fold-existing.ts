import type { SplitVerdict } from '#scripts/split/split-assess'
import { issue_fold } from './issue-fold'

type ExistingVerdict = 'duplicate' | 'fold' | 'separate' | 'inspect'
type ContentVerdict = 'duplicate' | 'compatible' | 'separate' | 'unknown'
const FOLD_CANDIDATE_COUNT = 2

interface ExistingAssessment {
	content: ContentVerdict
	is_open?: boolean | undefined
	is_unstarted?: boolean | undefined
	has_pull_request?: boolean | undefined
	has_complete_read: boolean
	has_dependency_conflict?: boolean | undefined
	is_separable?: boolean | undefined
	size_verdict?: SplitVerdict | undefined
}

function has_unknown_facts(facts: ExistingAssessment): boolean {
	const required = [
		facts.is_open,
		facts.is_unstarted,
		facts.has_pull_request,
		facts.has_dependency_conflict,
		facts.is_separable,
		facts.size_verdict,
	]

	return facts.content === 'unknown' || !facts.has_complete_read || required.includes(undefined)
}

function has_active_conflict(facts: ExistingAssessment): boolean {
	return (
		facts.is_open === false ||
		facts.is_unstarted === false ||
		facts.has_pull_request === true ||
		facts.has_dependency_conflict === true
	)
}

function fold_or_separate(facts: ExistingAssessment): ExistingVerdict {
	const verdict = issue_fold.fold_verdict(
		FOLD_CANDIDATE_COUNT,
		facts.is_separable ?? false,
		facts.size_verdict ?? 'split',
	)

	return verdict === issue_fold.FOLD ? 'fold' : 'separate'
}

function decide(facts: ExistingAssessment): ExistingVerdict {
	if (has_unknown_facts(facts)) return 'inspect'
	if (facts.content === 'separate') return 'separate'
	if (facts.content === 'duplicate') return 'duplicate'
	if (has_active_conflict(facts)) return 'separate'

	return fold_or_separate(facts)
}

function append_requirements(
	existing_body: string,
	draft_body: string,
	verification: string,
): string {
	const addition = `## 追加要件\n\n${draft_body.trim()}\n\n### 検証方法\n\n${verification.trim()}`

	return `${existing_body.trimEnd()}\n\n${addition}\n`
}

const issue_fold_existing = { decide, append_requirements }

export type { ExistingAssessment, ExistingVerdict }
export { issue_fold_existing }
