import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import { epic_triage } from '#scripts/epic/epic-triage'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { BUG_LABEL, has_label_name, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'

// The mechanical half of the triage gate (joshuafolkken/kit#5517).
//
// `run:solo` needs all three conditions of `backlogrun-lanes.md` → "A solo run", and the first two are
// readable without an agent: a defect carries `bug`, and a defect in kit's own verification names one
// of its paths. An untriaged candidate missing either is `run:lane` by the rule itself, so it is
// labelled here, with the missing condition in a comment, instead of waking a judgment session for
// minutes. Only a `bug` naming a verification-gate path is left untriaged for the judgment.
//
// A label read or write that fails, or a `bug` whose body was not read, leaves the candidate
// untriaged, so the judgment still covers it.

// Condition 2's area: the lint / type check / spell check / unit-test gate, the code review, the
// pre-push hook and the merge checks. A path missed here costs a wrong `run:lane`; one too many costs
// only a judgment session, so the list errs wide.
const GATE_PATHS: ReadonlyArray<string> = [
	'eslint/',
	'eslint.config',
	'scripts/hooks/',
	'scripts/gate/',
	'scripts/lint/',
	'scripts/review/',
	'scripts/ci/',
	'prompts/review',
	'lefthook',
	'.github/workflows/',
	'vitest.config',
	'tsconfig',
	'cspell.config',
]

function names_gate_path(body: string): boolean {
	return GATE_PATHS.some((path) => body.includes(path))
}

// The condition the candidate lacks, or `undefined` when only a judgment can answer.
function lane_reason(child: EpicChild): string | undefined {
	if (!has_label_name(child.labels, BUG_LABEL)) return `it carries no \`${BUG_LABEL}\` label`
	if (child.body === undefined || names_gate_path(child.body)) return undefined

	return `it is a \`${BUG_LABEL}\`, but its body names no verification-gate path`
}

// `issue_comment` appends the run marker itself.
function comment_of(reason: string): string {
	return [
		`Triaged mechanically to \`${RUN_LANE_LABEL}\`: ${reason}.`,
		'`run:solo` needs all three conditions of `backlogrun-lanes.md` → "A solo run", so no judgment session was woken.',
	].join('\n')
}

// The labels the candidate carries once decided, or `undefined` to leave it for the judgment. They are
// read fresh first: `backlog:next` runs from several callers at once (the arrival probe, each lane's
// merge), and the second to arrive finds the first one's label and posts no second comment.
async function decided_labels(
	child: EpicChild,
	repo: string,
): Promise<ReadonlyArray<string> | undefined> {
	const reason = lane_reason(child)

	if (reason === undefined) return undefined

	const issue = String(child.number)
	const current = await git_gh_command.read_label_names(issue, repo)

	if (current === undefined || epic_triage.has_triage_label(current)) return current

	const write = await git_gh_command.issue_apply_label(issue, RUN_LANE_LABEL, repo)

	if (!write.is_applied) return undefined

	await git_gh_command.issue_try_comment(issue, comment_of(reason), repo)

	return [...current, RUN_LANE_LABEL]
}

async function settle_child(child: EpicChild, repo: string): Promise<EpicChild> {
	if (epic_triage.is_triaged(child)) return child

	const labels = await decided_labels(child, repo)

	return labels === undefined ? child : { ...child, labels }
}

async function settle_children(
	children: ReadonlyArray<EpicChild>,
	repo: string,
): Promise<ReadonlyArray<EpicChild>> {
	return await Promise.all(children.map(async (child) => await settle_child(child, repo)))
}

// The result with every mechanically-decided candidate of `repo` carrying `run:lane`, as it now does
// on GitHub.
async function settle(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result

	const candidates = await Promise.all(
		result.candidates.map(async (bucket) =>
			bucket.repo === repo
				? { ...bucket, children: await settle_children(bucket.children, repo) }
				: bucket,
		),
	)

	return { ...result, candidates }
}

// The candidates of `repo` the settle above left for the judgment.
async function untriaged_of(
	result: EpicNextResult,
	repo: string,
): Promise<{ result: EpicNextResult; untriaged: ReadonlyArray<EpicChild> }> {
	const settled = await settle(result, repo)

	if (settled.verdict !== 'run') return { result: settled, untriaged: [] }

	return {
		result: settled,
		untriaged: epic_triage.untriaged(epic_report.candidates_for_repo(settled, repo)),
	}
}

const backlog_auto_triage = { lane_reason, untriaged_of }

export { backlog_auto_triage }
