import { git_followup_stages, type FollowupStage } from '#scripts/git/git-followup-stages'

// Reading `followup`'s own stage rows back out of what it printed (joshuafolkken/kit#1445).
//
// joshuafolkken/kit#1349 gave `pnpm josh followup` a per-stage block — one
// `followup stage: <name> <n> s` row per lap — and declared the prefix as a constant so a reader
// could be added without matching a string the printer is free to reword. **There was no reader.**
// `josh time` sees a `followup` invocation as one Bash span, so the breakdown existed only on the
// screen of whoever happened to be watching that run: two runs could not be compared stage by stage,
// and a transcript recorded last week could not be read at all.
//
// **The prefix is imported rather than retyped**, which is the whole of what keeps this from being a
// guess about another module's output — the shape `time-reported-failure.ts` already uses for
// `status_icons`. A rename over there breaks the build here rather than silently emptying the table.
//
// **The parse is split from the aggregation, and the split is structural rather than tidy.** This
// module is reached from `time-transcript-line.ts`, which `time-spans.ts` imports; a single module
// that also aggregated would need `Span`, and `time-spans → time-transcript-line → here → time-spans`
// is a cycle. `time-single-check.ts` beside `time-single-checks.ts` is the same pair for the same
// reason, so this is that seam applied again rather than a new one.
//
// **What is read is the row, never the total.** `followup stages total:` is the sum of the rows, so
// parsing it would give this module a second source for one number and a way for the two to
// disagree; the caller sums the rows it has. The two prefixes do not collide — the total's fourteenth
// character is `s` where the row's is `:` — so a row scan cannot pick the total up by accident.

const LINE_SEPARATOR = '\n'
// **The row is read from its end, not from the gap in its middle.** The printer pads the stage name
// to a fixed width so the durations line up, and reading the two as whitespace-separated fields works
// only for as long as every name is shorter than that width — `coderabbit-comments` is already 19 of
// the 20. A name that reached it would make `padEnd` a no-op, the printer would emit
// `some-very-long-stage12.3 s`, and a field split would take `some-very-long-stage12.3` for the name
// and `NaN` for the seconds — dropping the row silently, which is the going-quiet-without-failing this
// module's header argues against. The duration and its unit are `time_format.format_seconds`'s output,
// so the tail is the one part of the row whose shape the alignment cannot move.
const SECONDS_SUFFIX = ' s'
const DIGIT_OR_POINT = /[\d.]/u
// Written here rather than imported: `time-format.ts` keeps its own copy private, and reaching for
// `run-progress.ts` would pull a command module into the parse for one number.
const MS_PER_SECOND = 1000
const NO_STAGES: ReadonlyArray<FollowupStage> = []

// Leading whitespace is trimmed for the same reason `time-reported-failure.ts` trims it: the printer
// indents nothing, but a harness that wraps or previews a body may, and the row is still the row.
function stage_body(line: string): string | undefined {
	const trimmed = line.trimStart()

	if (!trimmed.startsWith(git_followup_stages.STAGE_LINE_PREFIX)) return undefined

	return trimmed.slice(git_followup_stages.STAGE_LINE_PREFIX.length)
}

// Where the duration begins: the run of digits and points closing the row. **Walked rather than
// matched.** A pattern describing the name as well would need a lazy or greedy prefix beside the
// number, which backtracks — `sonarjs/super-linear-regex` refuses it, and it is right to: this is one
// pass over a row whose length nothing bounds.
function digits_start(head: string): number {
	let index = head.length

	while (index > 0 && DIGIT_OR_POINT.test(head.charAt(index - 1))) index -= 1

	return index
}

// **An empty run is not a zero-second stage**, and it is tested for rather than folded into the
// number: `Number('')` is `0`, so a row that ended in the unit with no digits in front of it would
// otherwise be reported as a lap that ran and took no time — which is the reading this module exists
// to keep the table out of.
function is_duration(digits: string): boolean {
	return digits !== '' && Number.isFinite(Number(digits))
}

// A row that does not end in a duration is dropped rather than counted as zero — a body the harness
// truncated is the common cause, and a zero there would read as a stage that ran and took no time.
function to_stage(body: string): FollowupStage | undefined {
	const text = body.trimEnd()

	if (!text.endsWith(SECONDS_SUFFIX)) return undefined

	const head = text.slice(0, -SECONDS_SUFFIX.length)
	const start = digits_start(head)
	const name = head.slice(0, start).trim()
	const digits = head.slice(start)

	if (name === '' || !is_duration(digits)) return undefined

	return { name, duration_ms: Number(digits) * MS_PER_SECOND }
}

// **The `includes` guard is the whole of what keeps this cheap.** `to_block` runs it over every tool
// result of every session, and almost none of them are a `followup` run: a scan that found nothing
// would still have allocated a line array per body. A substring test allocates nothing, and the split
// below is paid only by the handful of bodies that actually carry the block.
function read_stages(text: string): ReadonlyArray<FollowupStage> {
	if (!text.includes(git_followup_stages.STAGE_LINE_PREFIX)) return NO_STAGES

	return text
		.split(LINE_SEPARATOR)
		.map((line) => stage_body(line))
		.filter((body): body is string => body !== undefined)
		.map((body) => to_stage(body))
		.filter((stage): stage is FollowupStage => stage !== undefined)
}

const time_followup_stage = { NO_STAGES, read_stages }

export { time_followup_stage }
