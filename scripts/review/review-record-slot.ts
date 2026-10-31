import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { review_attest } from './review-attest'

// `josh review:record --from-slot` — record the findings a reviewer wrote with `josh review:submit`,
// not findings the parent copied out of the reviewer's reply (joshuafolkken/kit#5549). The slot is the
// one `run:review`'s brief and `review:submit` share (`review_paths(PROJECT_ROOT, slot)`). Each finding
// is recorded `fixed` unless a positional `<n>=<disposition>` gives its own, `<n>` its 1-based line in
// the findings file; `review-record-cli.ts` validates the disposition as it does any positional. The
// entry calls `run` here with `review_record_cli.run`, kept out of `review-record-cli.ts`, which
// `run-ship-review.ts` imports.

const FAILURE_EXIT_CODE = 1
const FROM_SLOT = '--from-slot'
const DEFAULT_DISPOSITION = 'fixed'
const OVERRIDE_PATTERN = /^(?<line>[1-9]\d*)=(?<disposition>\S.*)$/u
const USAGE = `Usage: josh review:record ${FROM_SLOT} --issue <N> [--interaction | --comment] [<n>=<disposition> ...]`
const OPTIONS = {
	issue: { type: 'string' },
	interaction: { type: 'boolean' },
	comment: { type: 'boolean' },
	'from-slot': { type: 'boolean' },
} as const

interface Expansion {
	argv: ReadonlyArray<string>
	refusal?: string
}

interface Values {
	issue?: string
	interaction?: boolean
	comment?: boolean
}

type Overrides = Map<number, string>
type SlotReader = (is_interaction: boolean) => string | undefined
type Recorder = (argv: ReadonlyArray<string>, now: Date) => Promise<number>

function refused(refusal: string): Expansion {
	return { argv: [], refusal }
}

function override_of(positional: string): [number, string] | undefined {
	const { line, disposition } = OVERRIDE_PATTERN.exec(positional)?.groups ?? {}

	if (line === undefined || disposition === undefined) return undefined

	return [Number(line), disposition]
}

// `undefined` once every positional is read; else the first one outside `<n>=<disposition>`.
function overrides_of(
	positionals: ReadonlyArray<string>,
	overrides: Overrides,
): string | undefined {
	for (const positional of positionals) {
		const override = override_of(positional)

		if (override === undefined) return positional

		overrides.set(...override)
	}

	return undefined
}

function slot_text(is_interaction: boolean): string | undefined {
	const { CODE, INTERACTION } = review_attest.REVIEW_SLOT
	const paths = lane_session_broker.review_paths(PROJECT_ROOT, is_interaction ? INTERACTION : CODE)

	return stamp_file.read_stamp_text(paths.findings)
}

function unmarked(line: string): string {
	const { FIXED_PREFIX } = run_ship_review

	return line.startsWith(FIXED_PREFIX) ? line.slice(FIXED_PREFIX.length) : line
}

// The report keeps each line whole, its reason with it, so the stop log gets the reason too.
function slot_findings(text: string | undefined, overrides: Overrides): Expansion {
	const verdict = run_ship_review.read_verdict(text)

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return refused(verdict.note)

	const last = Math.max(0, ...overrides.keys())

	if (last > verdict.report.length) return refused(`no finding ${String(last)} in the slot`)

	return {
		argv: verdict.report.map(
			(line, index) => `${overrides.get(index + 1) ?? DEFAULT_DISPOSITION} ${unmarked(line)}`,
		),
	}
}

function flags_of(values: Values): ReadonlyArray<string> {
	return [
		...(values.issue === undefined ? [] : ['--issue', values.issue]),
		...(values.interaction === true ? ['--interaction'] : []),
		...(values.comment === true ? ['--comment'] : []),
	]
}

function expand_parsed(
	values: Values,
	positionals: ReadonlyArray<string>,
	read: SlotReader,
): Expansion {
	const overrides: Overrides = new Map()
	const unreadable = overrides_of(positionals, overrides)

	if (unreadable !== undefined) return refused(`unreadable override: ${unreadable}\n${USAGE}`)

	const findings = slot_findings(read(values.interaction === true), overrides)

	if (findings.refusal !== undefined) return findings

	return { argv: [...flags_of(values), ...findings.argv] }
}

// An argv without `--from-slot` passes through untouched.
function expand(argv: ReadonlyArray<string>, read: SlotReader = slot_text): Expansion {
	if (!argv.includes(FROM_SLOT)) return { argv }

	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return refused(USAGE)

	return expand_parsed(parsed.values, parsed.positionals, read)
}

// `josh review:record`: a refused expansion exits 1 before anything is recorded.
async function run(argv: ReadonlyArray<string>, record: Recorder): Promise<number> {
	const expansion = expand(argv)

	if (expansion.refusal === undefined) return await record(expansion.argv, new Date())

	console.error(expansion.refusal)

	return FAILURE_EXIT_CODE
}

const review_record_slot = {
	expand,
	run,
}

export { review_record_slot }
