import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { delegation_policy } from './delegation-policy'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#1460: the threshold has to fire more than once in a run. What the cases below pin
// is that the count is taken from the transcript rather than remembered — a delegation clears it, an
// edit takes its file back out of it, and the same accumulation reached twice refuses twice.

const {
	BRANCH,
	edit_call_line,
	josh_call_line,
	call_line,
	result_line,
	ms,
	target_turn_lines,
	tool_call_line,
} = time_transcript_fixture

const THRESHOLD = delegation_policy.INVESTIGATION_FILE_THRESHOLD
const BELOW_THRESHOLD = THRESHOLD - 1
const READ_MINUTE = 9
const DELEGATION_MINUTE = 20
const DELEGATION_END_MINUTE = 23
const LATE_TURN = 30
const NEVER_REFUSED_MS = 0
const AGENT_ID = 'agent-call'
const BASH_ID = 'bash-call'
const EDIT_ID = 'edit-call'
const FIRST_FILE = 'scripts/one.ts'
const SECOND_FILE = 'scripts/two.ts'
const NEXT_FILE = 'scripts/next.ts'
const SUBJECT_FILES = [FIRST_FILE, SECOND_FILE]
const WORKFLOW_COMMAND = 'pnpm josh gate'

// joshuafolkken/kit#1771: the four shapes a run's own session files take. Every one of them lives
// outside the checkout by construction — that is what the exclusion is anchored on — and none can be
// handed to a unit to read, because each belongs to this session's harness alone.
//
// **The temp root itself is not what is matched**, which is why this fixture uses the `/var/folders`
// spelling `os.tmpdir()` returns on macOS rather than the `/private/tmp` one the observed path had: the
// rule keys on the `claude-<uid>` segment, so both spellings answer alike and neither is load-bearing.
const SESSION_TEMP = '/var/folders/q7/claude-501/-Users-me-kit/9f2'
const CLAUDE_STATE = '/Users/me/.claude/projects/-Users-me-kit'
const TASK_OUTPUT = `${SESSION_TEMP}/tasks/bg.output`
const SCRATCHPAD_FILE = `${SESSION_TEMP}/scratchpad/probe.ts`
const TOOL_RESULT = `${CLAUDE_STATE}/tool-results/big.txt`
const TRANSCRIPT = `${CLAUDE_STATE}/9f2.jsonl`
const SESSION_FILES = [TASK_OUTPUT, TOOL_RESULT, TRANSCRIPT]
// What `SKILL.md` → §1 specifies a `queue` entry to read. Obeying the procedure must not trip the guard.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const ENTRY_SET = [
	...['SKILL', 'fullrun', 'chain-rule', 'followup', 'split-assessment', 'eval-gate'].map(
		(name) => `${WORKFLOW_SKILL}/${name}.md`,
	),
	'prompts/review.md',
]
const NOT_COUNTED = 'does not count %s'

interface ToolCall {
	name: string
	input: unknown
}

// Enough closed `Read` calls to leave `count` files pending, each naming a file of its own.
function reads_text(count: number, turn = 0, prefix = 'read'): string {
	const targets = Array.from(
		{ length: count },
		(_unused, index) => `scripts/${prefix}-${String(index)}.ts`,
	)

	return target_turn_lines(turn, targets).join('\n')
}

function bash_text(command: string): string {
	return [
		josh_call_line(READ_MINUTE, BRANCH, command, BASH_ID),
		result_line(READ_MINUTE + 1, BRANCH, BASH_ID),
	].join('\n')
}

function delegation_lines(): Array<string> {
	return [
		call_line(DELEGATION_MINUTE, BRANCH, 'Agent', AGENT_ID),
		result_line(DELEGATION_END_MINUTE, BRANCH, AGENT_ID),
	]
}

function read_call(file_path: string): ToolCall {
	return { name: 'Read', input: { file_path } }
}

function bash_call(command: string): ToolCall {
	return { name: 'Bash', input: { command } }
}

const AT_THRESHOLD_TEXT = reads_text(BELOW_THRESHOLD)
const NEXT_READ = read_call(NEXT_FILE)
// The pending set holds resolved paths, because that is the only form in which a shell target and a
// tool's `file_path` can be compared at all.
const resolve = investigation_reads.resolved

describe('investigation_reads.tally_of — reads and edits', () => {
	it('counts every file a closed read named', () => {
		expect(investigation_reads.tally_of(reads_text(THRESHOLD)).pending).toHaveLength(THRESHOLD)
	})

	// The rule counts files the run will not edit, and at read time nothing can say which those are.
	// Subtracting on the edit is what makes the set mean that without asking the run to declare it.
	it('takes a file back out once it has been edited', () => {
		const text = [
			...target_turn_lines(0, SUBJECT_FILES),
			edit_call_line(READ_MINUTE, BRANCH, FIRST_FILE, EDIT_ID),
			result_line(READ_MINUTE + 1, BRANCH, EDIT_ID),
		].join('\n')

		expect(investigation_reads.tally_of(text).pending).toEqual([resolve(SECOND_FILE)])
	})

	// **The two forms have to meet.** A shell line names the file as typed and a tool call names it
	// absolutely, so unresolved they never cancel and the file stays pending for the rest of the run.
	it('cancels a shell read against an absolute edit of the same file', () => {
		const text = [
			josh_call_line(READ_MINUTE, BRANCH, `cat ${FIRST_FILE}`, BASH_ID),
			result_line(READ_MINUTE + 1, BRANCH, BASH_ID),
			edit_call_line(READ_MINUTE + 2, BRANCH, resolve(FIRST_FILE), EDIT_ID),
			result_line(READ_MINUTE + 3, BRANCH, EDIT_ID),
		].join('\n')

		expect(investigation_reads.tally_of(text).pending).toEqual([])
	})

	// `cat` is how most of this repository's reading is actually done — run #1441 issued 10 of them
	// against 5 `Read` calls — so a count blind to it is a count of the minority.
	it('counts a file read through a shell command', () => {
		expect(investigation_reads.tally_of(bash_text(`cat ${FIRST_FILE}`)).pending).toEqual([
			resolve(FIRST_FILE),
		])
	})

	// `grep` reports *about* a file without carrying its text, so it costs nothing to carry forward and
	// must not push the count toward a threshold about what rides in the prompt.
	it('does not count a search that never carried the file', () => {
		expect(investigation_reads.tally_of(bash_text(`grep -n thing ${FIRST_FILE}`)).pending).toEqual(
			[],
		)
	})
})

// joshuafolkken/kit#1472: a span keeps no tool input, so two kinds of write could not be subtracted
// at all and the count of unedited files was too large — one false refusal per accumulation.
describe('investigation_reads.tally_of — a write the transcript could not describe', () => {
	// Symptom 1. `sed` is in the read set because `sed -n` is how this repository reads, and a span
	// cannot tell that spelling from `sed -i` — so a file written in place was counted as read and
	// never taken back out. `CLAUDE.md` allows a small `sed -i` explicitly, so this is daily.
	//
	// **Asserted as an empty set since joshuafolkken/kit#1611.** It had to be written as an absence
	// while the *read* half of the same span still tokenized the whole line: the quoted substitution
	// left the path-shaped fragment `s/old/new` pending, so the set was not empty even once the real
	// file came out of it. `bash_facts` now strips the quoted spans first, and the whole-set assertion
	// is what would catch that third over-count coming back.
	it('does not leave a file written in place by sed pending', () => {
		const text = bash_text(`sed -i '' 's/old/new/' ${FIRST_FILE}`)

		expect(investigation_reads.tally_of(text).pending).toEqual([])
	})

	// The other half of the same case: subtracting the write must not swallow the read that shares the
	// command name, or the guard stops counting the reading it exists to count.
	it('still counts a file read with sed -n', () => {
		const text = bash_text(`sed -n '1,40p' ${FIRST_FILE}`)

		expect(investigation_reads.tally_of(text).pending).toEqual([resolve(FIRST_FILE)])
	})

	// The over-claim that direction risks: a later segment's `-i` must not make the first segment's
	// read look like a write, because subtracting deletes a file the run really did read.
	it('counts the read when a later pipeline segment carries the -i', () => {
		const text = bash_text(`sed -n '1,40p' ${FIRST_FILE} | grep -i thing`)

		expect(investigation_reads.tally_of(text).pending).toEqual([resolve(FIRST_FILE)])
	})

	// Symptom 2. Both tools carry `EDIT_MARKER` and neither is in `BUNDLEABLE_TOOLS`, so their spans
	// used to arrive naming nothing at all and the subtraction had nothing to subtract. Measured on
	// PR #1468: `Edit` and `Write` emptied `pending`, these two left the file in it.
	//
	// Each tool is given the field it really names — `NotebookEdit` sends `notebook_path` — so the case
	// would fail if that field stopped being read, rather than passing on the other tool's field.
	it.each([
		['MultiEdit', 'file_path'],
		['NotebookEdit', 'notebook_path'],
	])('takes a file back out once %s has written it', (name, field) => {
		const text = [
			...target_turn_lines(0, SUBJECT_FILES),
			tool_call_line(READ_MINUTE, BRANCH, {
				name,
				input: { [field]: resolve(FIRST_FILE) },
				id: EDIT_ID,
			}),
			result_line(READ_MINUTE + 1, BRANCH, EDIT_ID),
		].join('\n')

		expect(investigation_reads.tally_of(text).pending).toEqual([resolve(SECOND_FILE)])
	})
})

describe('investigation_reads.tally_of — what a delegation does to the count', () => {
	// The defect the Issue measured: after the unit returned the run kept reading and nothing was
	// counted again. Clearing here makes the second accumulation indistinguishable from the first.
	it('clears the count at a delegation and reports when it closed', () => {
		const text = [...target_turn_lines(0, SUBJECT_FILES), ...delegation_lines()].join('\n')
		const tally = investigation_reads.tally_of(text)

		expect(tally.pending).toEqual([])
		expect(tally.reset_ms).toBe(ms(DELEGATION_END_MINUTE))
	})

	it('reports no reset where the window holds no delegation', () => {
		expect(investigation_reads.tally_of(reads_text(1)).reset_ms).toBe(NEVER_REFUSED_MS)
	})
})

// Found by the guard refusing its own author: the run that built it was stopped reading
// `prompts/refactoring.md`, which is not the Issue's subject and which nearly every run reads.
describe('investigation_reads — the run’s own instructions are not the subject', () => {
	it.each([
		'prompts/refactoring.md',
		'prompts/collaboration-workflow/delegation.md',
		'.claude/skills/workflow-commands/SKILL.md',
		'CLAUDE.md',
	])(NOT_COUNTED, (target) => {
		expect(investigation_reads.is_instruction_document(target)).toBe(true)
		expect(investigation_reads.tally_of(bash_text(`cat ${target}`)).pending).toEqual([])
	})

	// Anchored at the repository root: matching the absolute path anywhere made every file in the
	// repository an instruction document for a checkout sitting under a directory called `prompts`.
	it.each([
		'docs/josh-commands.md',
		'scripts/eval/prompts/x.ts',
		'MY_CLAUDE.md',
		'/Users/someone/prompts/kit/scripts/one.ts',
	])('still counts %s, which is subject material', (target) => {
		expect(investigation_reads.is_instruction_document(target)).toBe(false)
	})

	it('never refuses a call that names only instructions', () => {
		expect(investigation_reads.is_refusable_call(read_call('CLAUDE.md'))).toBe(false)
		expect(investigation_reads.is_refusable_call(bash_call('cat prompts/review.md'))).toBe(false)
	})
})

// joshuafolkken/kit#1771. A backgrounded call's result reaches its run only as the harness's output
// file, and a tool result too large for the transcript only as a file the harness wrote — so refusing
// either refuses a run the answer to an instruction it issued itself, and the remedy the refusal names
// does not exist for a file no unit can be sent to.
describe('investigation_reads — the harness’s own session files are not the subject', () => {
	it.each(SESSION_FILES)(NOT_COUNTED, (target) => {
		expect(investigation_reads.is_session_artifact(target)).toBe(true)
		expect(investigation_reads.tally_of(bash_text(`cat ${target}`)).pending).toEqual([])
	})

	it('never refuses a call that names only session files', () => {
		expect(investigation_reads.is_refusable_call(read_call(TASK_OUTPUT))).toBe(false)
		expect(investigation_reads.is_refusable_call(bash_call(`cat ${TOOL_RESULT}`))).toBe(false)
	})

	// The anchor is inverted rather than borrowed: leaving the checkout is a precondition, so no
	// repository file can be exempted here however its directories happen to be named.
	it.each(['scripts/tasks/one.ts', '.claude/settings.json'])(
		'still counts %s, which is inside the checkout',
		(target) => {
			expect(investigation_reads.is_session_artifact(target)).toBe(false)
			expect(investigation_reads.is_subject_file(target)).toBe(true)
		},
	)

	// **The exemption is the harness's own files, not the session tree.** Exempting the tree would
	// silently uncount anything a run unpacks or clones into its scratchpad to investigate — real
	// subject material — and a false negative here produces no output at all, so nothing would show it.
	it('still counts subject material the run put in its own scratchpad', () => {
		expect(investigation_reads.is_session_artifact(SCRATCHPAD_FILE)).toBe(false)
		expect(investigation_reads.tally_of(bash_text(`cat ${SCRATCHPAD_FILE}`)).pending).toEqual([
			resolve(SCRATCHPAD_FILE),
		])
	})
})

// The second false-positive class of joshuafolkken/kit#1771, decided as **excluded**. It already was,
// through the instruction-document paths above; what was missing is a case pinning the whole set, so a
// run that obeys `SKILL.md` → §1 cannot be refused for obeying it.
describe('investigation_reads — the entry set a queue is specified to read', () => {
	it.each(ENTRY_SET)(NOT_COUNTED, (target) => {
		expect(investigation_reads.is_subject_file(target)).toBe(false)
		expect(investigation_reads.is_refusable_call(read_call(target))).toBe(false)
	})
})

// The acceptance criterion that keeps the two exclusions from becoming a loosening.
describe('investigation_reads.should_block — the threshold itself is unchanged', () => {
	it('refuses a call that mixes exempt files with one subject file', () => {
		const call = bash_call(`cat ${TASK_OUTPUT} CLAUDE.md ${NEXT_FILE}`)

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, call, NEVER_REFUSED_MS)).toBe(true)
	})

	it('allows that same call once its only subject file is gone', () => {
		const call = bash_call(`cat ${TASK_OUTPUT} CLAUDE.md`)

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, call, NEVER_REFUSED_MS)).toBe(false)
	})
})

describe('investigation_reads.is_at_threshold — the boundary is the read that reaches it', () => {
	it('trips on the call that would take the count up to the threshold', () => {
		expect(investigation_reads.is_at_threshold(BELOW_THRESHOLD)).toBe(true)
	})

	it('leaves the calls below it in the main line', () => {
		expect(investigation_reads.is_at_threshold(BELOW_THRESHOLD - 1)).toBe(false)
	})

	// A blind increment refused a *re-read* — a second `sed -n` window of a file already pending, or a
	// `Read` with a new offset — when the set would not have grown at all.
	it('does not count a file that is already pending twice', () => {
		const pending = [resolve(FIRST_FILE), resolve(SECOND_FILE)]

		expect(investigation_reads.projected_count(pending, read_call(FIRST_FILE))).toBe(pending.length)
		expect(investigation_reads.projected_count(pending, read_call(NEXT_FILE))).toBe(THRESHOLD)
	})

	// Counting the call's own targets toward the boundary refused one bundled multi-file read as the
	// very first call of a run, with a reason claiming three files had already been read.
	it('allows a bundled multi-file read before anything has accumulated', () => {
		const call = bash_call(`cat ${FIRST_FILE} ${SECOND_FILE} ${NEXT_FILE}`)

		expect(investigation_reads.should_block('', call, NEVER_REFUSED_MS)).toBe(false)
	})

	// A glob resolves to a literal path with a `*` in it, which no edit can ever name.
	it('does not count a shell glob as a file', () => {
		expect(investigation_reads.tally_of(bash_text('cat scripts/delegation/*.ts')).pending).toEqual(
			[],
		)
	})
})

describe('investigation_reads.is_refusable_call — what may be refused at all', () => {
	it('refuses a read tool', () => {
		expect(investigation_reads.is_refusable_call(read_call(FIRST_FILE))).toBe(true)
	})

	it('refuses a shell command that prints a file', () => {
		expect(investigation_reads.is_refusable_call(bash_call(`cat ${FIRST_FILE}`))).toBe(true)
	})

	// Claude Code denies one call of a turn and runs the rest, so a refused write leaves its siblings
	// applied and itself not. Every one of these has to be allowed through whatever the count says.
	it.each([
		['an edit', { name: 'Edit', input: { file_path: FIRST_FILE } }],
		['a command that may be writing', bash_call(`sed -i '' s/a/b/ ${FIRST_FILE}`)],
		['a read whose line also redirects', bash_call(`cat ${FIRST_FILE} > copy.ts`)],
		['a workflow command', bash_call(WORKFLOW_COMMAND)],
		['a git write', bash_call('git switch main')],
	])('never refuses %s', (_label, call) => {
		expect(investigation_reads.is_refusable_call(call)).toBe(false)
	})
})

describe('investigation_reads.should_block — the refusal', () => {
	it('refuses the read that reaches the threshold', () => {
		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_READ, NEVER_REFUSED_MS)).toBe(
			true,
		)
	})

	it('says nothing below the threshold', () => {
		expect(investigation_reads.should_block(reads_text(1), NEXT_READ, NEVER_REFUSED_MS)).toBe(false)
	})

	it('says nothing for a call that could never be refused', () => {
		const call = bash_call(WORKFLOW_COMMAND)

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, call, NEVER_REFUSED_MS)).toBe(false)
	})
})

describe('investigation_reads.should_block — and its second firing', () => {
	// One refusal per accumulation: a run that reads on regardless pays one round trip rather than
	// being wedged on the file it needs.
	it('refuses the same accumulation only once', () => {
		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_READ, ms(READ_MINUTE))).toBe(
			false,
		)
	})

	// The whole of joshuafolkken/kit#1460: three more unedited files after a delegation is a new
	// accumulation, and it is refused again.
	it('refuses again once a delegation has reset the count', () => {
		const text = [
			AT_THRESHOLD_TEXT,
			...delegation_lines(),
			reads_text(BELOW_THRESHOLD, LATE_TURN, 'late'),
		].join('\n')

		expect(investigation_reads.should_block(text, NEXT_READ, ms(READ_MINUTE))).toBe(true)
	})

	// Without this arm the guard fell permanently silent on a long run: once the last delegation has
	// scrolled out of the window there is no reset instant left to beat, and one stale stamp disarmed
	// the rest of the session — on exactly the run lengths the Issue was filed about.
	it('refuses again once the recorded refusal is older than the window', () => {
		const tally = investigation_reads.tally_of(AT_THRESHOLD_TEXT)
		const before_window = tally.window_start_ms - 1

		expect(investigation_reads.is_rearmed(tally, before_window)).toBe(true)
		expect(investigation_reads.is_rearmed(tally, tally.window_start_ms + 1)).toBe(false)
	})

	it('names the count, the command and the return shape in the reason', () => {
		expect(investigation_reads.REASON).toContain(String(THRESHOLD))
		expect(investigation_reads.REASON).toContain('pnpm josh delegate investigation')
		expect(investigation_reads.REASON).toContain('never the file text')
	})
})
