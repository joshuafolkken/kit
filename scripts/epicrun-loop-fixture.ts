import { read_repo_file } from './ai-document-fixture'

// The numbered loop in `.claude/skills/workflow-commands/epicrun.md` is where a rule has to be
// written to be reached. A rule stated only in the prose section that argues it is a rule a reader
// working through the steps never meets, so two suites slice the loop's per-child step out and
// assert against that slice rather than against the whole file.
//
// It lives here because both of them need the same three lines (joshuafolkken/kit#1212). Written
// twice, a renamed step heading would take one suite green and leave the other asserting against an
// empty string — which passes every `not.toContain` in it.

const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'

const LOOP_START = '1. Run the command above.'
const NEXT_STEP = '3. '

// **A missing marker throws rather than degrading.** `indexOf` answers `-1`, and `slice(0, -1)` is
// the whole rest of the file rather than nothing — so a renumbered loop (`3)` for `3. `) would turn
// every "the rule is reachable by following the numbered steps" assertion into a whole-file search,
// which passes while the rules have left the loop entirely. That is the exact failure this slice
// exists to detect, so it fails loudly instead of quietly widening.
function index_of_marker(content: string, marker: string): number {
	const found = content.indexOf(marker)

	if (found === -1) throw new Error(`${EPICRUN_SKILL} no longer contains ${JSON.stringify(marker)}`)

	return found
}

// The text between two markers, with whitespace collapsed so a marker pins the words rather than the
// column a reflow left them in.
function slice_between(content: string, start: string, end: string): string {
	const tail = content.slice(index_of_marker(content, start))

	return tail.slice(0, index_of_marker(tail, end)).replaceAll(/\s+/gu, ' ')
}

// Step 2 of the loop — everything between running `epic:next` and the `wait` branch.
function per_child_step(): string {
	return slice_between(read_repo_file(EPICRUN_SKILL), LOOP_START, NEXT_STEP)
}

const epicrun_loop = { per_child_step, slice_between }

export { epicrun_loop, EPICRUN_SKILL }
