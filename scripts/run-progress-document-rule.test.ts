import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1520. Two halves have to stay written down, because each one is a thing the run
// used to get wrong. The command's contract — silence rather than a clock, observations rather than
// "still running", no Telegram, no unread verification result — and the fact that `epicrun` starts it
// **itself**, which is the half that turns the reporting from something a person asks for every run
// into something that happens.

// joshuafolkken/kit#1546 widened that scope to `fullrun`, `queue` and `halfrun`. The section stays
// the single source, so what is asserted below is the pair: the new rules are written in it, and the
// three entry points cite it without carrying a second copy of the procedure.

const DOCS = 'docs/josh-commands.md'
const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const RULE_DELIVERY = 'prompts/collaboration-workflow/rule-delivery.md'
const COMMAND = 'run:progress'
const ALIAS = 'rg'
const SCRIPT_PATH = 'scripts/run/run-progress-cli.ts'
const SECTION = 'Progress while the run is quiet'
const STATES = 'states: %s'
const SIBLING_CITATION = `\`epicrun.md\` → "${SECTION}"`

const WATCHER_EXCEPTION = 'no progress watcher is started'

const REFERRING_SKILLS: ReadonlyArray<string> = [FULLRUN, QUEUE, HALFRUN]
// The two entry points that hand an issue to a unit, and so have to say the unit starts none.
const BATCH_PARENTS: ReadonlyArray<string> = [SKILL, QUEUE]

const DOC_MARKERS: ReadonlyArray<string> = [
	// The trigger, said as the thing it is not.
	'The trigger is silence, not a clock',
	'a line never lands immediately behind a real one',
	// The rejected design, kept named so nobody re-derives the parent-polling shape.
	'a parent that waits and reports spends one of its own turns per heartbeat',
	// The stdout/stderr split every `run:*` command shares.
	'Standard output carries the progress line and nothing else',
	// The two prohibitions this repository keeps relearning.
	'It cannot send a Telegram, and that is structural rather than a promise',
	'The line reports no verification result, because it reads none',
	// The measurement behind the default, so a future change to it has to argue with the numbers.
	'6 of 15 reports carried no changed number at all',
	// Configurable and disable-able, which is an acceptance condition rather than a nicety.
	'JOSH_PROGRESS_INTERVAL_MINUTES',
	'JOSH_PROGRESS=0',
	// Idle and unreadable are not one answer.
	'A repository with nothing in flight is told apart from one whose listing could not be read',
	// joshuafolkken/kit#1560. The absolute observation time, and the three decisions behind it — the
	// third of which now prints both clocks, so the local half is pinned beside the UTC one.
	'When the observation was taken, with its date, on the local clock and in UTC',
	'The local half leads and UTC is printed beside it, with the offset that places both',
	// joshuafolkken/kit#1570. The moved default, the argument for it, and the row that enforces the
	// interval against the run's own prose rather than only against this command's own lines.
	'Why twenty minutes.',
	'The silence interval in minutes. Default 20.',
	'The `early-heartbeat` row of `josh rule:guard` refuses the `Bash` call that arms such a timer',
	'an explicit ask is not a heartbeat',
	'The fourth row is the early heartbeat',
	'One delivery per run — except for a row whose subject is a recurring act',
	// joshuafolkken/kit#1576. The form that reports where a long-running process cannot, and the
	// second source for the interval — without the latter the setting exists and does not travel.
	'`--wait` is that loop with an exit at the end, and it exists because relaying "what appears" is not always possible',
	'relays nothing at all from a process built never to exit',
	'josh.progress_interval_minutes',
]

const SKILL_MARKERS: ReadonlyArray<string> = [
	// The auto-start, and why being asked for it is a failure rather than a preference.
	'Start the progress step before step 1 of the loop, and do it without being asked',
	'It starts by itself, and that is the requirement rather than a convenience',
	'A run that has to be asked has not solved it',
	// What keeps the heartbeat off the heels of a real report.
	'`--mark` at every real report',
	// The content rule, and the two output rules.
	'The line carries observations, never "still running"',
	'a result nobody read must never be printed as one',
	'It goes to the session only',
	'Nothing is reported while no child is in flight',
	// joshuafolkken/kit#1567. The relayed line was already one line; what cost was the run's own
	// prose around it — 27.9% of everything a measured parent accumulated, the largest single
	// source. A tick with no bound reprints the epic's table and pays for it on every later request.
	"the executing side's own text at **27.9%**",
	'A tick is quiet when none of the real reports happened since the last one',
	"the relayed line plus at most two lines of the run's own prose",
	'no re-listing of the remaining children',
	// The scope, and the two decisions joshuafolkken/kit#1546 was filed to take.
	'The scope is every implementing run, not this command alone',
	'`halfrun` is included, and the reason is that the trigger is silence rather than command identity',
	'One watcher per run, and the outermost invocation is the one that starts it',
	'In a single-issue run it starts immediately after `pnpm josh run:hold` succeeds',
	// The two a cross-repository target and a stopping run would otherwise get wrong silently: a
	// watcher reading the wrong repository's listing, and one left reporting after the run stopped.
	"It is started in the target repository's checkout, and `--mark` is run there too",
	'`--mark` follows the watcher',
	'A run that merges needs no teardown, and a run that stops has to end the reporting itself',
	// What a real report is once the run has one child instead of many — without it `--mark` is never
	// called and a heartbeat lands on the heels of a real report.
	'any turn that puts a progress statement in front of the person',
	"the Step 0 work summary, the pull request opening, each review round's verdict",
	'A tool result only you read is not one',
	// Why the flag the loop passes is dropped where no transcript stays current for the whole run.
	'`--output` is omitted in those runs, and `record` reads `unread`',
	// joshuafolkken/kit#1560. Without the heading rule the machine's line carries the instant and the
	// run's own prose does not, which is the half of the report a person actually reads.
	'Every report this run writes opens with the time the observation was taken',
	'The date is part of it',
	// Both halves are pinned, because dropping either is the failure the other one was filed for: UTC
	// alone is unreadable to the person in front of the run, and local alone breaks the relay.
	'The local clock leads and UTC is printed beside it, with the offset that ties the two together',
	'UTC is kept rather than replaced',
	'a stamp nobody can place is a stamp nobody reads',
	'It is added, never substituted for the elapsed figure',
	// joshuafolkken/kit#1570. The refusal in front of the arm, the three answers it turns on, and the
	// measurement that makes it believable — the promise was kept and the interval was not.
	'Do not keep a progress clock of your own, and the hook refuses an arm rather than asking you not to',
	'The promise was kept and the interval was not',
	'The default interval is twenty minutes, and it is overridable — by the person, not by the run.',
	'An explicit ask is not a heartbeat, and it is exempt by construction rather than by exception.',
	'A live timer is counted from the record the guard writes when it allows one',
	// joshuafolkken/kit#1576. The three halves of the fix, each one a thing a reader would otherwise
	// have to derive: why the form that exits is the one to start, the step the parent actually takes
	// at every interval, and what the guard really refuses — the sentence this section used to get
	// wrong, which is how obeying it produced silence.
	'`--wait` waits one silence interval out, prints one line and exits — and the exit is what makes the line arrive.',
	'The step the parent repeats, named so a session that has read only this can run it.',
	'What the hook refuses, written exactly as it decides',
	'a single correctly-spaced arm is allowed',
	// The interval reaching another machine at all, which a non-committed `.env` cannot do.
	'The interval travels with the repository too',
	// joshuafolkken/kit#1650. The verbatim rule handed over eight unlabelled `·`-joined values, which
	// protected the content and lost the reader — so the presentation is labelled, while the half the
	// verbatim rule was actually defending is restated as a rule of its own.
	'The line is presented with a label in front of every field, never handed over as it was printed',
	'handing over an unreadable line does not achieve it',
	'Four field lines, in this order, and a fifth for the next report time',
	'Every value is carried across unchanged; the presentation adds a label and nothing else',
	'Naming a field is not interpreting it',
	// A field the command did not measure must not be presented as one that came back clean.
	'Never present an unmeasured field as a measurement',
	'never as *not stalled*, which is a measurement the command did not take',
	// The question a heartbeat is asked every time it does not answer it — and the two conditions that
	// keep the answer a schedule rather than a claim.
	'The presentation closes with the next report time, written as an absolute instant in both clocks',
	'It is derived, not observed',
	'a real report arriving first resets the clock through `--mark` and supersedes it',
	'The next report time is the one instant the presentation does derive',
	// The volume budget is unchanged: the five lines stand where the one line stood.
	'The presentation stands where the relayed line stood, and is not an addition to it',
]

// One case per file per marker: the section's body must live in exactly one file.
const CLONE_CASES = REFERRING_SKILLS.flatMap((skill) =>
	SKILL_MARKERS.map((marker) => ({ marker, skill })),
)

describe(`${DOCS} — the command's contract is written down`, () => {
	const content = read_unwrapped(DOCS)

	it('gives the command a section of its own', () => {
		expect(read_repo_file(DOCS)).toMatch(/^### `josh run:progress`$/mu)
	})

	it.each(DOC_MARKERS)(STATES, (marker) => {
		expect(content).toContain(marker)
	})

	it('sends the reader to the loop that starts it', () => {
		expect(content).toContain(`\`${SKILL}\` → "${SECTION}"`)
	})
})

describe(`${SKILL} — the run starts the watcher itself`, () => {
	const content = read_unwrapped(SKILL)

	it('gives the rule a section of its own', () => {
		expect(read_repo_file(SKILL)).toMatch(new RegExp(`^## ${SECTION}$`, 'mu'))
	})

	it.each(SKILL_MARKERS)(STATES, (marker) => {
		expect(content).toContain(marker)
	})

	it('places the section in front of the loop it precedes', () => {
		const source = read_repo_file(SKILL)

		expect(source.indexOf(`## ${SECTION}`)).toBeLessThan(source.indexOf('## The loop'))
	})
})

describe('the other entry points reference the section instead of copying it', () => {
	it.each(REFERRING_SKILLS)('%s starts the watcher', (skill) => {
		expect(read_unwrapped(skill)).toContain(`pnpm josh ${COMMAND}`)
	})

	it.each(REFERRING_SKILLS)('%s cites the single source', (skill) => {
		expect(read_unwrapped(skill)).toContain(SIBLING_CITATION)
	})

	it.each(CLONE_CASES)('$skill does not copy: $marker', ({ marker, skill }) => {
		expect(read_unwrapped(skill)).not.toContain(marker)
	})
})

describe('a batch parent tells its unit not to start a second watcher', () => {
	it.each(BATCH_PARENTS)('%s writes the exception into the brief', (skill) => {
		expect(read_unwrapped(skill)).toContain(WATCHER_EXCEPTION)
	})
})

// joshuafolkken/kit#1570. The mechanism half of the Issue: the enumeration's own topic file has to
// carry the row and the once-per-run exception, or a future row copies the exception by accident.
describe(`${RULE_DELIVERY} — the row and its exception are written down`, () => {
	const content = read_unwrapped(RULE_DELIVERY)

	it.each(['早すぎる進捗報告', '例外 — 繰り返す行為を止める行は毎回発火する'])(STATES, (marker) => {
		expect(content).toContain(marker)
	})

	it('sends the reader to the section that carries the procedure', () => {
		expect(content).toContain(SECTION)
	})
})

describe('the command is registered', () => {
	it('runs the CLI the documentation names', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})
