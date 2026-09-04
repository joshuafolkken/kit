import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_spans, type Span } from './time-spans'

const ASSISTANT = 'assistant'
const USER = 'user'
const MINUTE_MS = 60_000
const PNPM_LABEL = 'Bash: pnpm'

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

function assistant_text(minute: number): string {
	return JSON.stringify({
		type: ASSISTANT,
		timestamp: at(minute),
		message: { content: [{ type: 'text', text: 'hello' }] },
	})
}

function tool_use(minute: number, name: string, id: string, input: unknown = {}): string {
	return JSON.stringify({
		type: ASSISTANT,
		timestamp: at(minute),
		message: { content: [{ type: 'tool_use', name, id, input }] },
	})
}

function tool_result(minute: number, id: string): string {
	return JSON.stringify({
		type: USER,
		timestamp: at(minute),

		message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] },
	})
}

function prompt(minute: number): string {
	return JSON.stringify({ type: USER, timestamp: at(minute), message: { content: 'do the thing' } })
}

function minutes_of(spans: ReadonlyArray<Span>, category: string): number {
	return spans
		.filter((span) => span.category === category)
		.reduce((sum, span) => sum + span.duration_ms, 0)
}

// A full turn: a person types, the model answers with a tool call, the tool returns, the model
// speaks again. Each leg is one minute, so a misclassified leg is visible as a whole minute.
const TURN = [
	prompt(0),
	assistant_text(1),
	tool_use(2, 'Read', 'tool-1'),
	tool_result(3, 'tool-1'),
	assistant_text(4),
].join('\n')

describe('time_spans.parse_timeline — the three-way split', () => {
	it('charges a tool_use to tool_result leg to tool execution', () => {
		const { spans } = time_spans.parse_timeline(TURN)

		expect(minutes_of(spans, time_spans.TOOL_CATEGORY)).toBe(MINUTE_MS)
	})

	it('charges every leg ending at an assistant line to model wait', () => {
		const { spans } = time_spans.parse_timeline(TURN)

		expect(minutes_of(spans, time_spans.MODEL_CATEGORY)).toBe(3 * MINUTE_MS)
	})

	it('charges a leg ending at a typed prompt to human wait', () => {
		const { spans } = time_spans.parse_timeline([assistant_text(0), prompt(5)].join('\n'))

		expect(minutes_of(spans, time_spans.HUMAN_CATEGORY)).toBe(5 * MINUTE_MS)
	})

	// The property that makes two runs comparable: the shares reconstruct the elapsed time exactly,
	// so a reader can check them rather than trust them.
	it('splits the whole elapsed time and nothing more', () => {
		const timeline = time_spans.parse_timeline(TURN)
		const total = timeline.spans.reduce((sum, span) => sum + span.duration_ms, 0)

		expect(total).toBe(timeline.ended_ms - timeline.started_ms)
		expect(timeline.ended_ms - timeline.started_ms).toBe(4 * MINUTE_MS)
	})

	it('labels a tool span with the tool that was called', () => {
		const { spans } = time_spans.parse_timeline(TURN)

		expect(spans.filter((span) => span.label !== '').map((span) => span.label)).toEqual(['Read'])
	})
})

describe('time_spans.parse_timeline — what it refuses to guess', () => {
	// A result whose call was never written — a transcript resumed mid-tool — is still time that
	// passed, so it is counted and named rather than dropped.
	it('counts a result whose call is missing as an unknown tool', () => {
		const { spans } = time_spans.parse_timeline(
			[assistant_text(0), tool_result(2, 'never-issued')].join('\n'),
		)

		expect(spans.map((span) => span.label)).toEqual([time_spans.UNKNOWN_TOOL])
	})

	// Claude Code writes a few lines microseconds out of order; an unsorted walk would turn those
	// into negative durations and break the reconstruction above.
	it('orders events by timestamp rather than by file order', () => {
		const timeline = time_spans.parse_timeline(
			[assistant_text(4), assistant_text(1), prompt(0)].join('\n'),
		)
		const total = timeline.spans.reduce((sum, span) => sum + span.duration_ms, 0)

		expect(total).toBe(4 * MINUTE_MS)
		expect(timeline.spans.every((span) => span.duration_ms >= 0)).toBe(true)
	})

	it('drops lines that carry no parseable timestamp', () => {
		const timeline = time_spans.parse_timeline(
			['', 'not json', JSON.stringify({ type: ASSISTANT }), assistant_text(0)].join('\n'),
		)

		expect(timeline.spans).toEqual([])
	})

	it('reports an empty transcript as a timeline with no spans', () => {
		expect(time_spans.parse_timeline('')).toEqual({ started_ms: 0, ended_ms: 0, spans: [] })
	})
})

describe('time_spans.bash_label — bundling by the leading command', () => {
	it('names the command a bare call runs', () => {
		expect(time_spans.bash_label('git status --short')).toBe('Bash: git')
	})

	// Taking the literal first word put `Bash: cd` at the top of every table — 82 calls of one
	// measured session, naming the one part of the command that did no work.
	it('walks past a cd prefix to the command that does the work', () => {
		expect(time_spans.bash_label('cd /tmp/project && pnpm josh gate')).toBe(PNPM_LABEL)
	})

	// The command inside the assignment is the one that runs first, and in every real occurrence
	// measured it was the work itself — `A=$(gh api …)`, `F=$(ls -t …)`.
	it('names the command inside an assignment substitution', () => {
		expect(time_spans.bash_label('A=$(gh api repos/x/y) && echo done')).toBe('Bash: gh')
	})

	it('walks past a plain assignment to the next segment', () => {
		expect(time_spans.bash_label('COUNT=3 ; git status')).toBe('Bash: git')
	})

	// A flag is never a command name. `F=$(ls -t *.jsonl | head -1)` used to be labelled `Bash: -t`.
	it('never labels a call after a flag', () => {
		expect(time_spans.bash_label('F=$(ls -t x | head -1) && wc -l x')).toBe('Bash: ls')
	})

	// Skipping the wrapper but not its flags left the walk on a flag, so the whole call dropped out
	// of the per-command table instead of being named.
	it('walks past a wrapper carrying its own flags', () => {
		expect(time_spans.bash_label('env -i pnpm test')).toBe(PNPM_LABEL)
	})
})

describe('time_spans.bash_label — prefixes that are not the command', () => {
	// The inline form is the one that actually occurs, and reading only each segment's first word
	// reported it as `Bash: FOO=1` — a bucket keyed by the value, so one command scattered across a
	// row per environment it ran under.
	it('walks past an assignment that shares a segment with the command', () => {
		expect(time_spans.bash_label('NODE_OPTIONS=--x node script.js')).toBe('Bash: node')
	})

	// `time <cmd>` runs the command after it, so the walk continues rather than stopping.
	it('walks past a wrapper to the command it wraps', () => {
		expect(time_spans.bash_label('time pnpm build')).toBe(PNPM_LABEL)
	})

	// `cd` runs nothing, so a call that is only a `cd` has no command to be named after. The bare
	// tool name is honest; naming it after the prefix is the defect this walk exists to fix.
	it('names a navigation-only call after the tool rather than the builtin', () => {
		expect(time_spans.bash_label('cd /some/path')).toBe('Bash')
	})

	// Splitting on `;` cuts inside `python3 -c 'import time; print(x)'`, and the fragment left over
	// is not command-shaped — so it is walked past rather than printed as a tool name.
	it('rejects a fragment left by a split inside a quoted argument', () => {
		expect(time_spans.bash_label("python3 -c 'import time; print(time.time())'")).toBe(
			'Bash: python3',
		)
	})

	it('falls back to the bare tool name when there is no command at all', () => {
		expect(time_spans.bash_label(' '.repeat(3))).toBe('Bash')
	})
})

describe('time_spans.josh_command_of', () => {
	it('reads the subcommand out of a pnpm josh invocation', () => {
		expect(time_spans.josh_command_of('cd /x && pnpm josh test:related')).toBe('josh test:related')
	})

	it('reads a bare josh invocation too', () => {
		expect(time_spans.josh_command_of('josh gate')).toBe('josh gate')
	})

	// `joshuafolkken` is the repository owner and appears in most `gh` calls in this project. A
	// substring match would charge every one of them to a subcommand named after whatever followed.
	it('does not match josh inside a longer word', () => {
		expect(time_spans.josh_command_of('gh api repos/joshuafolkken/kit/issues')).toBe('')
	})

	// Charging the whole duration to each of two named subcommands would report more josh time than
	// the session spent, so only the first counts.
	it('takes only the first subcommand of a compound command', () => {
		expect(time_spans.josh_command_of('pnpm josh lint && pnpm josh gate')).toBe('josh lint')
	})

	it('answers empty for a command that names none', () => {
		expect(time_spans.josh_command_of('git status')).toBe('')
	})

	// This repository's own commit messages and issue comments name josh subcommands constantly. A
	// loose search charged every one of those `git` calls to the subcommand they mentioned.
	it('does not match a josh command quoted inside an argument', () => {
		expect(time_spans.josh_command_of('git commit -m "ran pnpm josh gate"')).toBe('')
	})

	it('still matches when an assignment precedes the invocation', () => {
		expect(time_spans.josh_command_of('CI=1 pnpm josh gate')).toBe('josh gate')
	})

	// The quoted body carries a `|`, which the segment split cuts on — so a segment beginning with
	// `pnpm josh` appears where no such command was ever run. Only the segment that actually holds
	// the command is read, so this `gh` call is charged to nothing.
	it('does not match a josh command quoted after a shell operator', () => {
		expect(time_spans.josh_command_of('gh api -f body="see | pnpm josh lint"')).toBe('')
	})
})

describe('time_spans.parse_timeline — josh attribution', () => {
	it('carries the josh subcommand on the tool span it was measured from', () => {
		const { spans } = time_spans.parse_timeline(
			[
				tool_use(0, 'Bash', 'tool-1', { command: 'cd /x && pnpm josh gate' }),
				tool_result(3, 'tool-1'),
			].join('\n'),
		)

		expect(spans.map((span) => [span.label, span.josh_command, span.duration_ms])).toEqual([
			[PNPM_LABEL, 'josh gate', 3 * MINUTE_MS],
		])
	})
})

// The branch is what attributes a span to an issue, and the absolute end is what lets the CI wait be
// subtracted from the pull request's window rather than added on top of it
// (joshuafolkken/kit#1268).
function on_branch(minute: number, branch: string): string {
	return JSON.stringify({
		type: ASSISTANT,
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'text', text: 'hello' }] },
	})
}

const ISSUE_BRANCH = '1268-measure'

describe('time_spans.parse_timeline — branch and instant', () => {
	it('carries the branch of the line that closed the span', () => {
		const lines = [on_branch(0, 'main'), on_branch(1, ISSUE_BRANCH)].join('\n')
		const { spans } = time_spans.parse_timeline(lines)

		expect(spans.map((span) => span.branch)).toEqual([ISSUE_BRANCH])
	})

	it('records the instant the span ended, so its interval can be reconstructed', () => {
		const { spans } = time_spans.parse_timeline(TURN)
		const intervals = spans.map((span) => [span.ended_ms - span.duration_ms, span.ended_ms])

		expect(intervals[0]).toEqual([Date.parse(at(0)), Date.parse(at(1))])
		expect(intervals.at(-1)).toEqual([Date.parse(at(3)), Date.parse(at(4))])
	})

	// A line written before any branch existed is not dated to one: the fill-forward walk in
	// `cost_attribute` is what carries a branch backwards, and inventing one here would take that
	// decision away from it.
	it('leaves a line with no branch empty rather than guessing one', () => {
		const { spans } = time_spans.parse_timeline(TURN)
		const branches = spans.map((span) => span.branch)

		expect(branches).toEqual(['', '', '', ''])
	})
})

function marker_of(lines: ReadonlyArray<string>): string {
	const { spans } = time_spans.parse_timeline(lines.join('\n'))

	return spans.at(-1)?.marker ?? ''
}

// The phase boundary is decided from the call's *input*, which a span does not keep — so it is read
// here, where the input is still in hand, and carried on the span (joshuafolkken/kit#1269).
describe('time_spans.parse_timeline — the phase marker', () => {
	it('carries the edit marker of the call the span closed', () => {
		const lines = [assistant_text(0), tool_use(1, 'Edit', 'tool-1'), tool_result(2, 'tool-1')]

		expect(marker_of(lines)).toBe(time_markers.EDIT_MARKER)
	})

	it('carries the review marker of a code-review skill call', () => {
		const input = { skill: 'code-review', args: 'medium' }
		const lines = [
			assistant_text(0),
			tool_use(1, 'Skill', 'tool-1', input),
			tool_result(2, 'tool-1'),
		]

		expect(marker_of(lines)).toBe(time_markers.REVIEW_MARKER)
	})

	it('carries the plan marker of the Bash call that posted the plan', () => {
		const command = 'gh api repos/{owner}/{repo}/issues/1269/comments -f body="the plan"'
		const lines = [
			assistant_text(0),
			tool_use(1, 'Bash', 'tool-1', { command }),
			tool_result(2, 'tool-1'),
		]

		expect(marker_of(lines)).toBe(time_markers.PLAN_MARKER)
	})

	it('leaves a span that closed no tool call unmarked', () => {
		expect(marker_of([prompt(0), assistant_text(1)])).toBe(time_markers.NO_MARKER)
	})
})

// The one criterion every scope withholds a transcript figure on (joshuafolkken/kit#1295), so the run
// report, its phase table and the epic aggregation cannot answer it three different ways.
describe('time_spans.has_transcript_data', () => {
	it('answers no for a run nothing was read for', () => {
		expect(time_spans.has_transcript_data(0)).toBe(false)
	})

	it('answers yes as soon as one span was read', () => {
		expect(time_spans.has_transcript_data(1)).toBe(true)
	})
})

// Claude Code writes one line per content block and repeats the assistant message's id on each, so a
// turn's calls can only be counted by grouping on it (joshuafolkken/kit#1329).
describe('time_spans.parse_line — the assistant message a line belongs to', () => {
	it('carries the message id every line of one turn repeats', () => {
		const line = JSON.stringify({
			type: ASSISTANT,
			timestamp: at(0),
			message: { id: 'msg-1', content: [{ type: 'tool_use', name: 'Read', id: 'a' }] },
		})

		expect(time_spans.parse_line(line)?.message_id).toBe('msg-1')
	})

	it('leaves a line written without one ungrouped', () => {
		expect(time_spans.parse_line(prompt(0))?.message_id).toBe(time_spans.NO_MESSAGE_ID)
	})
})
