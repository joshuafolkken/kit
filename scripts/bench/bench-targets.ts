import { gate_skip } from '#scripts/gate-skip'
import {
	CSPELL_CACHE_FILE,
	ESLINT_CACHE_FILE,
	GATE_CACHE_FILES,
	GATE_COMMAND,
	TS_BUILD_INFO_FILE,
} from '#scripts/josh/josh-command-types'

// Which verification commands `josh bench` can measure, and what "cold" means for each one
// (joshuafolkken/kit#1314).
//
// **The clearing is defined per target rather than once for the run.** `josh lint` writes only the
// eslint cache, so a run that emptied all three before it would report a cold type check and a cold
// spell check as part of the lint's own cost — the exact confusion the command exists to remove.
//
// **Nothing outside `GATE_CACHE_FILES` is ever removed**, and that list is the gate's own
// declaration of what it writes. Two properties follow from it, both asserted next door: every path
// is git-ignored, so clearing one leaves no trace in the working tree; and the edit hook's
// `.eslintcache.edit` is not in it, so this command cannot repeat joshuafolkken/kit#1332 — an edit
// hook deleting the very cache the gate reads.

interface BenchTarget {
	// The `josh` sub-command measured, spelled exactly as it is typed.
	name: string
	// The cache files removed before the cold reading, relative to the checkout root. Empty where the
	// command keeps no cache of its own; the report says so rather than letting the reader take a
	// cold figure for a cache effect.
	caches: ReadonlyArray<string>
	// Flags the measurement needs the target to run with. Only `josh gate` has one, and it is
	// load-bearing rather than a preference — see below.
	flags: ReadonlyArray<string>
}

// **`test:unit` declares no cache on purpose.** Vitest's own cache lives under `node_modules`, and
// removing anything there is a side effect well outside the working tree — a reinstall, not a cold
// run. Its two readings therefore measure the operating system's page cache and run-to-run noise,
// which is a real answer to "is this 18 seconds cache-dependent?" and is labelled as one.
// **`josh gate` is measured with `--force`, and without it the whole gate row is a fiction.** The
// gate reuses a green result recorded on an unedited tree (`gate-skip.ts`, joshuafolkken/kit#1328),
// so the warm reading — taken seconds after a green cold one, with nothing edited in between — would
// be the skip notice rather than a run: a fraction of a second, printed as a several-hundred-fold
// cache win. Worse, a green record already on disk skips *both* readings. The flag is what makes the
// pair a measurement, and the gate accepts it precisely because a person may know something outside
// the tree moved — which is exactly what this command has just done to its caches.
const BENCH_TARGETS: ReadonlyArray<BenchTarget> = [
	{ name: 'lint', caches: [ESLINT_CACHE_FILE], flags: [] },
	{ name: 'check', caches: [TS_BUILD_INFO_FILE], flags: [] },
	{ name: 'cspell:dot', caches: [CSPELL_CACHE_FILE], flags: [] },
	{ name: 'test:unit', caches: [], flags: [] },
	{ name: GATE_COMMAND, caches: GATE_CACHE_FILES, flags: [gate_skip.FORCE_FLAG] },
]

// The whole gate is excluded from the default set because it is the sum of the four above: measuring
// both doubles the wall clock to print the same seconds twice. `josh bench gate` asks for it.
const DEFAULT_TARGETS: ReadonlyArray<BenchTarget> = BENCH_TARGETS.filter(
	(target) => target.name !== GATE_COMMAND,
)

// A path is removable only when the gate declares it as one of its own cache files **and** it names
// a file at the checkout root. The second half is not redundant: the first list is a constant today,
// and a future entry carrying a directory component would turn `rm` into a walk out of the checkout.
function is_clearable(cache: string): boolean {
	return GATE_CACHE_FILES.includes(cache) && !cache.includes('/') && !cache.includes('..')
}

function clearable_caches(target: BenchTarget): ReadonlyArray<string> {
	return target.caches.filter((cache) => is_clearable(cache))
}

function find_target(name: string): BenchTarget | undefined {
	return BENCH_TARGETS.find((target) => target.name === name)
}

// What the command line asked for, split into what can be measured and what cannot. The unknown
// half is reported rather than dropped: a mistyped target that silently measured the default set
// would answer a question nobody asked.
interface TargetSelection {
	targets: ReadonlyArray<BenchTarget>
	unknown: ReadonlyArray<string>
}

function resolve_targets(names: ReadonlyArray<string>): TargetSelection {
	if (names.length === 0) return { targets: DEFAULT_TARGETS, unknown: [] }

	return {
		targets: names.map((name) => find_target(name)).filter((target) => target !== undefined),
		unknown: names.filter((name) => find_target(name) === undefined),
	}
}

const bench_targets = {
	BENCH_TARGETS,
	DEFAULT_TARGETS,
	clearable_caches,
	find_target,
	is_clearable,
	resolve_targets,
}

export type { BenchTarget, TargetSelection }
export { bench_targets }
