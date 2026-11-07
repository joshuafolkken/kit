import { readFile } from 'node:fs/promises'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { run_ship_body_draft } from '#scripts/run/ship/run-ship-body-draft'

// joshuafolkken/kit#6572: **one verified deliverable answers a size-only notice.** A notice asks for
// the rest to be split off, and an Issue whose every criterion is met has no rest — filing a child for
// it invents work. It answers only on positive evidence: every current criterion met in this
// worktree's ship draft, no deferral or stale row, and green `lint:related` / `test:related` on this
// tree. Any unread input is no evidence, so the notice stands.

const REQUIRED_SCRIPTS = [scoped_green.LINT_SCRIPT, scoped_green.TEST_SCRIPT]

// Every current criterion is met, and the draft defers nothing and maps no criterion the Issue dropped.
function all_met(issue_body: string | undefined, draft: string | undefined): boolean {
	const criteria = acceptance_map.criteria_of(issue_body)
	const rows = acceptance_map.rows_of(draft)
	const comparison = acceptance_map.compare(criteria, rows)
	const is_met = criteria.every((criterion) => rows.met.has(criterion.id))

	return (
		criteria.length > 0 && is_met && rows.deferrals.length === 0 && comparison.stale.length === 0
	)
}

// The pair green on exactly this tree: a record written after it, `.josh/` ones included, means
// running the pair again rather than reading an older green as this tree's.
function is_green(tree: GateTree): boolean {
	const scripts = scoped_green.green_scripts(tree.files, tree.base)

	return REQUIRED_SCRIPTS.every((script) => scripts.includes(script))
}

async function draft_text(issue: number): Promise<string | undefined> {
	const target = await run_ship_body_draft.existing(String(issue))

	return target === undefined ? undefined : await readFile(target, 'utf8')
}

async function is_verified(issue: number): Promise<boolean> {
	const tree = await gate_tree.read_gate_tree()

	if (!is_green(tree)) return false
	const read = await git_gh_command.issue_get_body_classified(String(issue))

	return read.kind === 'read' && all_met(read.text, await draft_text(issue))
}

async function verified(issue: number): Promise<boolean> {
	try {
		return await is_verified(issue)
	} catch {
		return false
	}
}

const split_verified_single = { all_met, verified }

export { split_verified_single }
