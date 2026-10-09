import { run_issue_number } from '#scripts/run/run-issue-number'
import { lane_paths } from './lane-paths'

// The mark a dispatched lane child carries, so the pre-gate cut and a resume are decided from the
// environment rather than from the model's reading of the prompt.
//
// **Without this mark a dispatched child is indistinguishable from a person's own session.**
// `lane:dispatch` and the `run:cut` relaunch both start the child with `claude -p "fullrun #<N>"` and
// a copied environment, and nothing in the argv, the environment or a file says "this session was
// launched, not typed". Left to the model, the human-or-child question is answered by reading its own
// prompt, which decides "person" and declines the cut. This variable is that missing fact, made
// mechanical.
//
// **Its value is the issue number, because a mark that only said "a child" could not be told from one
// that leaked.** A person's shell, or a parent session that was itself a dispatched child, can carry
// this variable into a checkout it does not belong to; `marked_issue` is trusted only where its value
// equals the lane's own issue, so a leaked mark for another issue is read as absent. The name, the
// meaning and the lifetime are documented once in
// `.claude/skills/workflow-commands/pre-gate-cut.md`.
const KEY = 'JOSH_LANE_CHILD'

// **A dispatched child also asks for the five-minute prompt-cache TTL**. A
// headless `claude -p` session on a subscription defaults to the one-hour TTL, whose writes bill at 2x
// the input rate against 1.25x for five minutes. A replay of 1,953 lane transcripts (about 57,000
// requests) found 0.3% of request gaps over five minutes, so the shorter TTL — re-writing the prefix on
// those few gaps — still costs 12-13% less. Every launcher of a child composes its environment here,
// so this is the one place the choice is made.
const CACHE_TTL_KEY = 'CLAUDE_CODE_PROMPT_CACHE_TTL'
const CACHE_TTL = '5m'

type MarkerSource = Readonly<Record<string, string | undefined>>

// The environment fragment that marks a child dispatched for `#<issue>`. Composed from a digits-only
// issue number rather than from text read anywhere — the same discipline `lane-dispatch.ts` applies to
// the invocation it builds — so a malformed number fails here rather than reaching a child.
function environment_for(issue: string): Record<string, string> {
	run_issue_number.require_issue_number(issue)

	return { [KEY]: issue, [CACHE_TTL_KEY]: CACHE_TTL }
}

// The issue a child was dispatched for, or `undefined` when the mark is absent or malformed. A blank
// or non-numeric value is read as absent rather than trusted, so neither a leaked variable nor a
// hand-set one can stand in for a real dispatch.
function marked_issue(source: MarkerSource = process.env): string | undefined {
	const value = source[KEY]

	if (value === undefined) return undefined

	return run_issue_number.ISSUE_NUMBER_PATTERN.test(value) ? value : undefined
}

// True when this session is a dispatched lane child for the checkout it is running in: the mark is
// present and names this lane's own issue, read from the checkout path. A numeric mark naming a
// *different* issue leaked in from a parent session into a checkout it does not belong to, so it is
// read as a person's run — the trust condition the header describes, applied the same way
// `pre-gate-cut.ts` applies it to the resume decision.
function is_child_of(directory: string, source: MarkerSource = process.env): boolean {
	const marked = marked_issue(source)

	return marked !== undefined && marked === lane_paths.lane_issue_of(directory, { ...source })
}

const lane_child_marker = {
	KEY,
	env_for: environment_for,
	is_child_of,
	marked_issue,
}

export type { MarkerSource }
export { lane_child_marker }
