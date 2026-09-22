import { bash_triggers } from './bash-triggers'
import { decision_oracle } from './decision-oracle'
import { shell_segments } from './shell-segments'

// The firing-point declaration every decision oracle owes (joshuafolkken/kit#2324). An oracle records a
// *decision*, but nothing on the oracle entry says which action must consult it first — so the 32
// oracles have a command each and a firing point almost never. This module is the missing half: for
// every oracle name, either the governed action (a `FiringPoint`, matched as a Bash command) or the
// reason none can be named. A run adding an oracle must answer one or the other, and the totality is
// enforced by `oracle-firing.test.ts` rather than by judgement.
//
// **It lives beside `decision-oracle.ts`, not inside it**, because that file sits 15 code lines under
// the 300 ceiling and 32 declarations would breach it. The registry stays a printable enumeration; the
// firing points key off its names, and the test asserts the keys cover every oracle exactly once. The
// predicate lives on the declaration so a line fully names its own trigger — the generic guard
// (`oracle-consulted.ts`) reads it rather than carrying a second table keyed by name.

// The governed action an oracle must precede: a human description printed by `oracle:list`, and a Bash
// predicate the generic guard fires on.
interface FiringPoint {
	describes: string
	governs: (command: string) => boolean
}

// **A package-add, not a bare install.** `pnpm add <pkg>` / `yarn add` / `bun add` add a dependency, as
// does `npm install <pkg>` with a package argument; a bare `pnpm install` reinstalls the lockfile and
// adds nothing, so it is left alone. Segment-wise, so a spelling quoted inside another command's body is
// not read as the add it is not.
const PACKAGE_ADD = /^(?:pnpm|yarn|bun)\s+add\s+\S|^npm\s+(?:install|i)\s+[^-\s]/u

function is_package_add(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => PACKAGE_ADD.test(segment))
}

// `pnpm josh followup` — the merge-and-release step `release:scope` decides the release owed after.
const FOLLOWUP_NAMES: ReadonlySet<string> = new Set(['followup'])

function is_followup(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, FOLLOWUP_NAMES))
}

// The three firing points wired first — the oracles whose governed call can be named without guessing:
// the package add, the Issue filing, and the release step. The rest declare why none can be named, so
// the unenforced oracles are visible rather than silently missing.
const FIRING: ReadonlyMap<string, FiringPoint> = new Map([
	[
		'pkg:scout',
		{
			describes: 'a package-add command (`pnpm add …`, `npm install <pkg>`)',
			governs: is_package_add,
		},
	],
	[
		'issue:lint',
		{
			describes: 'an Issue-filing call (`gh api …/issues`, `gh issue create`)',
			governs: bash_triggers.is_issue_filing,
		},
	],
	['release:scope', { describes: 'a release step (`pnpm josh followup`)', governs: is_followup }],
])

// The reason an oracle names no firing point, in three recurring shapes plus the four already gated
// elsewhere. `PHASE` — the governed act is a run phase, not one shell call. `READ` — it answers a status
// question and governs no action of its own. `SELF` — the command is itself the act, with nothing
// earlier to gate. A guard for any of these would fire on the wrong turn or double-gate a call another
// rule already claims.
const PHASE =
	'the act it governs is a phase of a run, not a single shell call a trigger can anchor on'
const READ = 'it answers a status question and governs no action of its own to gate before'
const SELF = 'the command is itself the governed act; there is no earlier call to gate before it'

const LATEST_SCOPE_REASON =
	'the run it governs (`pnpm josh latest`) is already gated at its point of use by the latest-gate; ' +
	'a firing here would double-gate it'
const EPIC_BUNDLE_REASON =
	'it runs after a filing to place it, and that filing is already gated by `issue-scout`; it has no ' +
	'earlier call of its own'

const NOT_NAMED: ReadonlyMap<string, string> = new Map([
	['delegate', PHASE],
	['review:level', READ],
	['review:round2', READ],
	['disposition', READ],
	['review:attest', READ],
	['latest:scope', LATEST_SCOPE_REASON],
	['run:hold', SELF],
	['cost:cut', READ],
	['epic:bundle', EPIC_BUNDLE_REASON],
	['issue:scout', 'the filing it governs is already gated by the `issue-scout` delivered rule'],
	[
		'issue:fold',
		'the second filing it governs is already gated by the `issue-fold` delivered rule',
	],
	['cases', READ],
	['issue:state', READ],
	['run:cut:resume', SELF],
	['run:cut:gate', SELF],
	['backlog:budget', READ],
	['run:liveness', READ],
	['stash:pop', SELF],
	['backlog:next', READ],
	['auto-ok:next', READ],
	['epic:next', READ],
	['run:merge', PHASE],
	['run:step', SELF],
	['refactor:scan', PHASE],
	['split:assess', PHASE],
	['sonar:hotspots', READ],
	['clone:scan', PHASE],
	['epic:reconcile', SELF],
	['lane:list', READ],
])

// The declaration for one oracle: a firing point, a reason none is named, or neither — the last is the
// undeclared state the test refuses.
interface FiringDeclaration {
	firing_point?: FiringPoint
	not_firing_reason?: string
}

function declaration_for(name: string): FiringDeclaration {
	const firing_point = FIRING.get(name)

	if (firing_point !== undefined) return { firing_point }

	const not_firing_reason = NOT_NAMED.get(name)

	return not_firing_reason === undefined ? {} : { not_firing_reason }
}

// Every oracle that declares a firing point, paired with it — the generic guard's input.
function firing_oracles(): ReadonlyArray<{
	oracle: (typeof decision_oracle.DECISION_ORACLES)[number]
	firing_point: FiringPoint
}> {
	return decision_oracle.DECISION_ORACLES.flatMap((oracle) => {
		const firing_point = FIRING.get(oracle.name)

		return firing_point === undefined ? [] : [{ oracle, firing_point }]
	})
}

const oracle_firing = {
	FIRING,
	NOT_NAMED,
	declaration_for,
	firing_oracles,
	is_followup,
	is_package_add,
}

export type { FiringDeclaration, FiringPoint }
export { oracle_firing }
