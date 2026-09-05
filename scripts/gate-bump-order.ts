import { gate_skip } from './gate-skip'
import type { FileMapStamp } from './josh/file-map-stamp'
import { review_stamps } from './review/review-stamps'

// Whether `josh gate` is about to spend its four checks on a tree a version bump is certain to
// invalidate (joshuafolkken/kit#1437).
//
// **`josh bump` always rewrites `package.json`**, so a gate run before it is guaranteed to have to
// run again after it: the green record joshuafolkken/kit#1328 reuses is keyed on the digest of every
// changed file, and the pre-push unit check reuses the same record (joshuafolkken/kit#1334). Neither
// can match once the version has moved. Measured on `fullrun 1428` (PR #1435), one run went
// `gate` → `bump` → `gate` and threw 19 seconds away entirely; the order `chain-rule.md` prescribes —
// `bump` first — needs one gate for the same tree.
//
// **The order was written down and nothing enforced it.** joshuafolkken/kit#1246 established "do not
// run the whole gate per edit" and joshuafolkken/kit#1324 gave that norm a mechanism, but neither
// covers the case where `bump` **itself** is the editor, which is why no existing judgement caught it.
//
// **This needs no run-progress state, which is what the issue left open as a design question.** The
// answer is that the tree and the existing record already say it: a record covering this same work,
// taken before any version bump, over a tree that has since moved, is a gate that ran where the bump
// should have gone first. Nothing has to know which josh commands this run has issued — and nothing
// could, since no such log exists.
//
// **It refuses rather than warning, and that is the whole of why it is a mechanism.** A warning is
// printed by a command that has already run, so the 19 seconds are spent by the time anyone reads it
// and the gate's `call_count` does not move — joshuafolkken/kit#1344 measured across three consecutive
// runs that notices and prose do not change the numbers. **Refusing weakens nothing**: no check is
// narrowed, dropped or reinterpreted, the output says in its first words that nothing was verified,
// and `--force` runs all four.

// A version bump is the one edit that always lands here, so its absence from the changed-file map is
// what says the bump is still owed. **A `package.json` changed for any other reason reads as "the
// bump may already be in"** and this module stays silent — a missed refusal costs one gate, a wrong
// one costs a run that cannot verify itself, and only one of those is worth avoiding.
const PACKAGE_JSON = 'package.json'

// Non-zero, so no run can read a refusal as a gate that passed, and the same code the gate's argument
// refusal already exits with — both mean "nothing was checked; the call itself is what to fix".
const REFUSED_EXIT_CODE = 1

function is_bump_owed(files: Record<string, string>): boolean {
	return files[PACKAGE_JSON] === undefined
}

// **Every path the record covers is still changed in this tree**, which is how a record is known to be
// this run's own. Within one run that always holds: round 1's fixes move digests and may add files, and
// nothing a run has edited stops differing from the base. Across runs it usually fails — a previous
// run's work has been committed, reverted or stashed, so its paths are gone from this map — and that is
// what keeps a record left behind on the same base from refusing the **first** gate of the next run,
// which the base check alone cannot do whenever the default branch has not moved in between.
//
// **One case it deliberately does not exclude**: a run resuming an earlier one's uncommitted tree. The
// refusal is right there — a green gate really does cover work this tree has since moved, and the bump
// is still owed.
//
// A record with an empty map is refused outright rather than treated as covering everything: it is a
// subset of any tree and speaks for no file at all.
function covers_current_work(stamp: FileMapStamp, tree: Record<string, string>): boolean {
	const covered = Object.keys(stamp.files)

	return covered.length > 0 && covered.every((name) => tree[name] !== undefined)
}

// `is_bump_owed` is asked of the record as well as of the tree, so a record written **after** a
// previous run's bump — the last gate of a run that follows the prescribed order — can never be the
// one that refuses.
function is_pre_bump_record(
	stamp: FileMapStamp,
	tree: Record<string, string>,
	base: string,
): boolean {
	return stamp.base === base && is_bump_owed(stamp.files) && covers_current_work(stamp, tree)
}

// The stamp rather than a boolean, for the reason `gate_skip.reusable_green_gate` hands one back: the
// caller prints `taken_at`, and a refusal that could not name when the earlier gate was green would be
// asking the reader to take its word for the whole thing.
//
// **A record that matches the tree exactly never reaches here** — the caller asks this only once reuse
// has been refused, so a redundant call is answered by joshuafolkken/kit#1328's skip and costs nothing
// to begin with. What is left is the one shape that costs real time: the tree moved, and the bump that
// will invalidate whatever is verified now has not happened yet.
function owed_bump_gate(
	tree: Record<string, string>,
	base: string | undefined,
	source?: string,
): FileMapStamp | undefined {
	if (base === undefined || !is_bump_owed(tree)) return undefined

	const stamp = review_stamps.gate_stamp.read(source)

	if (stamp === undefined || !is_pre_bump_record(stamp, tree, base)) return undefined

	return stamp
}

// **The first words say nothing was checked**, because that is the one thing this output must not be
// mistaken about: a reader who takes it for a red gate goes hunting for a failure, and one who takes
// it for a pass commits on a gate that never ran. It deliberately does not carry the gate's own
// verdict line — `josh_verdict` builds those, and a refusal is neither `passed` nor `failed`.
//
// **The two ways forward are written as a pair, not as an instruction with a caveat**, because which
// one applies is decided by something this command cannot see: whether the run is heading for a commit.
// A run that will not commit — `halfrun`, or a `needs-human-review` child — never bumps at all, so
// `--force` is the correct answer there rather than a bypass, and a message that buried it in a
// trailing clause would read as prescribing the one command those runs are forbidden to type
// (`halfrun.md` says so in its own fix-round step).
function format_refusal(taken_at: string): string {
	return (
		`⚠ nothing was checked — this gate would have been paid for twice.\n` +
		`  Lint, the type check, the spell check and the unit tests were already green on this branch ` +
		`at ${taken_at}, the tree has moved since, and this branch still carries no version bump.\n` +
		`  Where this run will commit: \`pnpm josh bump minor\` rewrites \`package.json\`, so whatever ` +
		`is verified now has to be verified again after it — run \`pnpm josh bump minor\` first and ` +
		`then \`pnpm josh gate\`, one gate instead of two.\n` +
		`  Where it will not (\`halfrun\`, or a \`needs-human-review\` child — neither ever bumps): ` +
		`\`pnpm josh gate ${gate_skip.FORCE_FLAG}\` runs the four checks now.`
	)
}

// Read structurally rather than imported from `verification-gate.ts`: the gate imports this module, so
// taking its option type back would be a cycle for two fields.
interface BumpOrderOptions {
	is_forced?: boolean
	stamp_path?: string
}

// The decision, the message and the exit code sit together for the reason `gate-skip.ts` holds its own
// pair: they are one answer, and a caller that printed the text from somewhere else is where the two
// stop agreeing about what fired.
//
// `--force` is answered here rather than by the caller — unlike the skip, whose flag the gate reads
// itself — because there the flag overrides a *result* the caller may want anyway, and here it says the
// order this module is about does not apply to the run at all.
function refuse_bump_order(
	files: Record<string, string>,
	base: string | undefined,
	options: BumpOrderOptions,
): number | undefined {
	if (options.is_forced === true) return undefined

	const owed = owed_bump_gate(files, base, options.stamp_path)

	if (owed === undefined) return undefined

	// stdout beside the skip rather than stderr beside the argument refusal: both are "what this gate
	// did", and an agent that pipes the command through `tail` without `2>&1` — the common shape
	// `prompts/collaboration-workflow/output-bounds.md` describes — would read a stderr refusal as a gate
	// that found nothing to say.
	process.stdout.write(`${format_refusal(owed.taken_at)}\n`)

	return REFUSED_EXIT_CODE
}

const gate_bump_order = { format_refusal, owed_bump_gate, PACKAGE_JSON, refuse_bump_order }

export { gate_bump_order }
