import { run_ship_stage, type Stage } from './run-ship-stage'
import type { ShipArguments } from './run-ship-steps'

// The command a relaunched lane child runs once it has fixed what stopped its detached ship.
// The stopped stage decides the command mechanically, so it is decided here, once, and the prompt
// carries it rather than each relaunched session re-deriving it. `chain-rule.md` step 0 stays the
// single source of the procedure; `ship-stop-prompt-document-rule.test.ts` holds every command below
// to it.
//
// The fix is left uncommitted on purpose: a dirty tree reads as not committed
// (`run-ship-probe.ts`), so a re-detached ship runs the gate and the commit again on the fixed tree
// instead of passing over them.
//
// **Every route is a re-detach.** The prompt only ever reaches a lane child, and a lane child's commit
// and push belong to the detached ship (`scripts/rules/lane-background.ts`), so a `josh git -y` here could never
// run. The rounds are the supervisor's too: under `--review` it skips a round 1 already recorded for the
// issue and asks `review:round2` itself after the commit (`run-ship-review-steps.ts`), so the fix delta
// is verified as round 2 rather than reviewed again as round 1.
//
// **The re-run carries the stopped ship's own options.** A preflight that stopped on missing live
// evidence asks for `--body-file`, and `followup` delivers the body from it; a command naming only
// the title would stop on the same evidence again, and drop the `--cite` follow-ups `run:tail` reads.

const { STAGE } = run_ship_stage

const COMMAND = {
	LOG: 'pnpm josh ship --log',
	DETACH: 'pnpm josh ship --detach',
	DETACH_REVIEW: 'pnpm josh ship --detach --review',
} as const

// A single quote cannot appear inside single quotes, so it closes the quote, escapes one, and reopens.
const ESCAPED_QUOTE = String.raw`'\''`

// A token of only these characters means the same to the shell quoted or not, so it is left bare.
const BARE_WORD = /^[\w%+,./:=@-]+$/u

// What a stopped ship is re-run with: its title, every option it was started with, and whether it
// carried `--review` — the one option a route decides rather than repeats.
interface ShipResume {
	title: string
	flags: ReadonlyArray<string>
	is_review: boolean
	// The paths a merge of the default branch left unmerged.
	conflicts?: ReadonlyArray<string>
}

// Single quotes, so a `$` or a backtick in a title is never expanded by the shell that runs it.
function quoted(title: string): string {
	return `'${title.split("'").join(ESCAPED_QUOTE)}'`
}

function shell_word(token: string): string {
	return BARE_WORD.test(token) ? token : quoted(token)
}

// A supervised ship's notify tail is already file-form (`run-ship-detach.ts`), so every flag is a path
// or an issue number and fits the prompt.
function resume_of(args: ShipArguments): ShipResume {
	const cites = args.cites.flatMap((cite) => ['--cite', cite])

	return {
		title: args.title,
		flags: [...args.notify, ...args.body, ...cites],
		is_review: args.is_review,
	}
}

// The command prefix stays as written; only the stopped ship's own tokens are quoted where needed.
function ship_command(command: string, resume: ShipResume): string {
	const words = [...resume.flags, resume.title].map((token) => shell_word(token))

	return [command, ...words].join(' ')
}

// After the merge-side stages, or after round 2 — which is final — the re-detach reviews nothing.
function detach_again(resume: ShipResume): string {
	return `leave the fix uncommitted and run \`${ship_command(COMMAND.DETACH, resume)}\`.`
}

// Before round 2 the re-run takes the stopped ship's own shape: `--review` only when it carried it. A
// reviewing ship skips its recorded round 1 and decides round 2 after the commit; a ship started
// without `--review` was re-detached after round 2, which is final, so it reviews nothing.
function detach_as_started(resume: ShipResume): string {
	const command = resume.is_review ? COMMAND.DETACH_REVIEW : COMMAND.DETACH

	return `leave the fix uncommitted and run \`${ship_command(command, resume)}\`.`
}

const AFTER_FIX: Record<Stage, (resume: ShipResume) => string> = {
	[STAGE.PREFLIGHT]: detach_as_started,
	[STAGE.REVIEW]: detach_as_started,
	[STAGE.GATE]: detach_as_started,
	[STAGE.SYNC]: detach_as_started,
	[STAGE.COMMIT]: detach_as_started,
	[STAGE.ROUND_TWO]: detach_again,
	[STAGE.FOLLOWUP]: detach_again,
	[STAGE.REPORT]: detach_again,
}

// A conflict names its paths, so the resumed session resolves them without
// reading the report or asking git which files are unmerged.
function conflict_step(conflicts: ReadonlyArray<string>): string {
	return `Resolve the conflict with origin/main in ${conflicts.join(', ')} (the merge is left in progress: remove the conflict markers in those files), then`
}

// Two lines' worth: read the stopped report, then the one command that resumes after the fix.
function next_step(issue: string, stage: Stage, resume: ShipResume): string {
	const conflicts = resume.conflicts ?? []

	if (conflicts.length > 0) return `${conflict_step(conflicts)} ${AFTER_FIX[stage](resume)}`

	return `Read the stopped report with \`${COMMAND.LOG} ${issue}\`, fix the ${stage} failure, then ${AFTER_FIX[stage](resume)}`
}

const run_ship_next = { COMMAND, next_step, quoted, resume_of }

export { run_ship_next, type ShipResume }
