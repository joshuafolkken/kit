import { run_issue_number } from '#scripts/run/run-issue-number'

// The mark a dispatched lane child carries, so the pre-gate cut and a resume are decided from the
// environment rather than from the model's reading of the prompt (joshuafolkken/kit#1904).
//
// **A dispatched child used to be indistinguishable from a person's own session.** `lane:dispatch`
// and the `run:cut` relaunch both start the child with `claude -p "fullrun #<N>"` and a copied
// environment, and nothing in the argv, the environment or a file said "this session was launched, not
// typed". So `pre-gate-cut.ts` left the human-or-child question to the model, which read its own prompt
// and — across the six children joshuafolkken/kit#1850 measured — decided "person" every time and
// declined the cut. This variable is that missing fact, made mechanical.
//
// **Its value is the issue number, because a mark that only said "a child" could not be told from one
// that leaked.** A person's shell, or a parent session that was itself a dispatched child, can carry
// this variable into a checkout it does not belong to; `marked_issue` is trusted only where its value
// equals the lane's own issue, so a leaked mark for another issue is read as absent. The name, the
// meaning and the lifetime are documented once in
// `.claude/skills/workflow-commands/pre-gate-cut.md`.
const KEY = 'JOSH_LANE_CHILD'

type MarkerSource = Readonly<Record<string, string | undefined>>

// The environment fragment that marks a child dispatched for `#<issue>`. Composed from a digits-only
// issue number rather than from text read anywhere — the same discipline `lane-dispatch.ts` applies to
// the invocation it builds — so a malformed number fails here rather than reaching a child.
function environment_for(issue: string): Record<string, string> {
	run_issue_number.require_issue_number(issue)

	return { [KEY]: issue }
}

// The issue a child was dispatched for, or `undefined` when the mark is absent or malformed. A blank
// or non-numeric value is read as absent rather than trusted, so neither a leaked variable nor a
// hand-set one can stand in for a real dispatch.
function marked_issue(source: MarkerSource = process.env): string | undefined {
	const value = source[KEY]

	if (value === undefined) return undefined

	return run_issue_number.ISSUE_NUMBER_PATTERN.test(value) ? value : undefined
}

const lane_child_marker = { KEY, env_for: environment_for, marked_issue }

export type { MarkerSource }
export { lane_child_marker }
