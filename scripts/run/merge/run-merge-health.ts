import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { issue_cite } from '#scripts/issue/issue-cite'
import { PRIORITY_CRITICAL_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { execa } from 'execa'

// The failure guard's check (joshuafolkken/kit#7078): a streak of failed children asks whether `main`
// itself is broken by running CI's whole-tree verification there — `pnpm josh gate` alone reads only a
// branch's changed files, which on `main` are none. Green, the failures are the children's own — each
// already parked — and the run goes on. Red twice in a row (one red can be a memory-pressure flake,
// `backlogrun-lanes.md`), kit's own verification is broken for every lane, so a `run:solo` Issue is
// filed; the backlog runs it alone and holds every other launch until it has merged
// (`backlogrun-lanes.md` → "A solo run"). Either way nobody is waited on. One filing stands until the
// next merge, so a streak still red is not filed twice. The child processes' output is captured, so
// `run:merge`'s stdout stays its one token. Script-emitted, so English.

interface HealthCheck {
	args: ReadonlyArray<string>
	env: Readonly<Record<string, string>>
}

const TITLE = 'Repair the verification gate failing on main'
const OUTPUT_TAIL_LINES = 20
// CI's split: the static gate, whole-tree under `CI`, and the whole unit suite on its own.
const STATIC_CHECK: HealthCheck = { args: ['josh', 'gate', '--no-unit'], env: { CI: 'true' } }
const UNIT_CHECK: HealthCheck = { args: ['josh', 'test:unit'], env: {} }
const COMMANDS = '`CI=true pnpm josh gate --no-unit` and `pnpm josh test:unit`'

function is_filed(events: ReadonlyArray<RunEvent>): boolean {
	return run_event_stream
		.since(events, run_event_stream.EVENT_KIND.MERGE)
		.some(
			(event) =>
				event.kind === run_event_stream.EVENT_KIND.FILED &&
				run_event_filed.parse(event.text)?.title === TITLE,
		)
}

// The lines `issue:file` requires of a defect whose origin is unknown (`issue:file --check`).
const DECLARATIONS = [
	issue_body_keys.heading('background'),
	'',
	issue_body_keys.line('kind', 'bug'),
	issue_body_keys.line('purpose', 'bug_fix'),
	issue_body_keys.line('judgement', 'not_needed'),
	`${issue_body_keys.line('origin', 'unknown')}（found by the backlogrun health check, not traced yet）`,
	`${issue_body_keys.prefix('size')} 約 1 ファイル / 20 行（テスト除く）`,
]
const SYMPTOM = [
	issue_body_keys.heading('symptom'),
	'',
	`${COMMANDS} fail on \`main\`, twice in a row.`,
]
const EXPECTED = [
	issue_body_keys.heading('expected'),
	'',
	`${COMMANDS} pass on \`main\`.`,
	'',
	issue_body_keys.heading('criteria'),
	'',
	`- [ ] ${COMMANDS} pass on \`main\`.`,
]

function body_of(child: string, output: string): string {
	const tail = output.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n')
	const origin = `Filed by \`pnpm josh run:merge\` after ${issue_cite.plain_for('github', child)}: a streak of children failed, and the whole-tree verification on \`main\` failed too, so it is broken for every lane.`
	const reproduction = [
		issue_body_keys.heading('reproduction'),
		'',
		`${COMMANDS} on \`main\`:`,
		'',
		'```text',
		tail,
		'```',
	]

	return [...DECLARATIONS, '', origin, '', ...SYMPTOM, '', ...reproduction, '', ...EXPECTED].join(
		'\n',
	)
}

async function file_solo(child: string, output: string): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), 'josh-health-'))
	const body_file = path.join(directory, 'body.md')
	const answers = ['--defect', 'yes', '--verification', 'yes', '--every-run', 'yes']
	const labels = ['--label', RUN_SOLO_LABEL, '--label', PRIORITY_CRITICAL_LABEL]

	await writeFile(body_file, body_of(child, output))
	const filing = await execa(
		'pnpm',
		['josh', 'issue:file', TITLE, '--body-file', body_file, ...labels, ...answers, '--over-cap'],
		{ reject: false, all: true, stdin: 'ignore' },
	)

	if (filing.exitCode !== 0) {
		console.error(`run:merge: the run:solo Issue was not filed:\n${filing.all}`)
	}
}

// The red check's output, or `undefined` when it passed.
async function red_output(health_check: HealthCheck): Promise<string | undefined> {
	const result = await execa('pnpm', health_check.args, {
		reject: false,
		all: true,
		stdin: 'ignore',
		env: health_check.env,
	})

	return result.exitCode === 0 ? undefined : result.all
}

async function verification_red(): Promise<string | undefined> {
	return (await red_output(STATIC_CHECK)) ?? (await red_output(UNIT_CHECK))
}

// Runs the whole-tree verification on the checkout `run:merge` stands in — `main`, after the parent's
// sync — and files the solo Issue when it is red twice. Answers whether `main` was green.
async function check(child: string): Promise<boolean> {
	if ((await verification_red()) === undefined) return true

	const output = await verification_red()

	if (output === undefined) return true

	if (!is_filed(await run_event_stream_emit.current_events())) await file_solo(child, output)

	return false
}

const run_merge_health = { TITLE, check }

export { run_merge_health }
