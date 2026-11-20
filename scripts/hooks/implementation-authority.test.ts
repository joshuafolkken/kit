import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { implementation_authority } from './implementation-authority'

const RUNTIME_FILE = 'scripts/example.ts'
const UNKNOWN_INPUT = 'Cannot verify'
const REFUSED = 'Implementation refused before execution'
const create_directory = temporary_directory('suite')
// This suite's own temp root, so no path is shared with a concurrent suite.
const ROOT = create_directory('authority-')
const SESSION = path.join(ROOT, 'session')

function payload(file_paths: Array<string>, tool_name = 'Edit'): string {
	return JSON.stringify({
		tool_name,
		tool_input: { file_paths },
		transcript_path: SESSION,
	})
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('implementation authority', () => {
	it('refuses a mixed Codex patch even when its first path is documentation', () => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(payload(['README.md', RUNTIME_FILE]))).toContain(REFUSED)
	})

	it.each(['scheduler', 'reviewer', undefined])('allows operational records for %s', (role) => {
		vi.stubEnv(agent_session_role.KEY, role)

		for (const paths of [
			['README.md'],
			['prompts/plan.md'],
			// The hook reads scratch records under `os.tmpdir()`; the name is this suite's own.
			[path.join(tmpdir(), `${path.basename(ROOT)}-review-findings.json`)],
		]) {
			expect(implementation_authority.reason(payload(paths, 'Write'))).toBeUndefined()
		}
	})

	it('allows a launcher-assigned worker to edit runtime files', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')

		expect(implementation_authority.reason(payload([RUNTIME_FILE]))).toBeUndefined()
	})

	it('refuses source edits outside the checkout through the same authority check', () => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')
		const file_path = path.join(ROOT, 'other-repo/app.ts')
		const raw_payload = payload([file_path])

		expect(implementation_authority.reason(raw_payload)).toContain(REFUSED)
	})

	it.each(['Edit', 'Write', 'Bash', 'apply_patch', 'exec'])(
		'refuses an unverified %s input without granting implementation authority',
		(tool_name) => {
			vi.stubEnv(agent_session_role.KEY, undefined)

			expect(implementation_authority.reason(payload([], tool_name))).toContain(UNKNOWN_INPUT)
		},
	)
})

function shell_payload(command: string): string {
	return JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command },
		transcript_path: SESSION,
	})
}

describe('shell implementation authority', () => {
	it.each([
		'printf changed > scripts/example.ts',
		'printf changed>scripts/example.ts',
		'echo changed | tee scripts/example.ts',
		'bash -c "echo changed > scripts/example.ts"',
		'printf changed > "$TARGET"',
	])('refuses a visible write to a runtime path: %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		const first = implementation_authority.reason(shell_payload(command))

		expect(first).toContain('lane:dispatch')
		expect(implementation_authority.reason(shell_payload(command))).toBe(first)
	})

	// joshuafolkken/kit#6586: a write the spelling hides is restored after the call (`bash-revert.ts`).
	it.each([
		'sed -i s/old/new/ scripts/example.ts',
		"node -e \"require('fs').writeFileSync('scripts/example.ts', 'changed')\"",
		'cp /tmp/replacement scripts/example.ts',
		'custom-editor scripts/example.ts',
		'git diff --out{put,put}=app.ts',
	])('runs a write the post-call revert takes back: %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		expect(implementation_authority.reason(shell_payload(command))).toBeUndefined()
	})
})

// joshuafolkken/kit#5793: the refusal names the rule it matched, so a false refusal is diagnosable.
describe('the named refusal rule', () => {
	it.each([
		['git push origin main', '`git push`, a git write'],
		['ls scripts/*.ts | xargs pnpm josh git -y', '`josh git`, a shared-state write'],
		['pnpm install', '`install`, a dependency change'],
	])('names the rule %s matched', (command, rule) => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		expect(implementation_authority.reason(shell_payload(command))).toContain(
			`Matched rule: ${rule}`,
		)
	})

	it('names the unverified patch input', () => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		expect(implementation_authority.reason(payload([], 'apply_patch'))).toContain(
			'Matched rule: `apply_patch` input.',
		)
	})

	it('passes a consultation grep of the repository', () => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		expect(
			implementation_authority.reason(shell_payload('grep -rn pattern scripts')),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#5534: a finding quotes code in backticks, which a single-quoted argument leaves
// as text, so the reviewer's findings path stays open while any other destination stays refused.
const FINDING = "printf '%s\\n' 'Run `josh followup` before $(merge) with FOO=1'"
const REVIEWER = 'reviewer'

describe('review findings piped through a single-quoted argument', () => {
	it.each([FINDING, `${FINDING} 'second; rm x\nline | tee ${RUNTIME_FILE}'`])(
		'allows piping a finding with backticks to review:submit: %s',
		(finding) => {
			vi.stubEnv(agent_session_role.KEY, REVIEWER)

			expect(
				implementation_authority.reason(shell_payload(`${finding} | pnpm josh review:submit`)),
			).toBeUndefined()
		},
	)

	it.each([`${FINDING} > ${RUNTIME_FILE}`, `${FINDING} | tee ${RUNTIME_FILE}`])(
		'still refuses the same finding written elsewhere: %s',
		(command) => {
			vi.stubEnv(agent_session_role.KEY, REVIEWER)

			expect(implementation_authority.reason(shell_payload(command))).toContain(REFUSED)
		},
	)
})

describe('operational shell authority', () => {
	it.each([
		'rg implementation scripts',
		'cat scripts/example.ts',
		'printf plan > prompts/plan.md',
		'printf plan | tee /tmp/issue-body.md',
		'pnpm josh issue:comment 5454 --body-file /tmp/issue-body.md',
		'pnpm josh lane:dispatch 5454',
		'gh api repos/owner/repo/issues/5454',
	])('keeps reads and operational records available: %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(shell_payload(command))).toBeUndefined()
	})

	it('allows worker shell writes and refuses unknown patch inputs for every other role', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		expect(implementation_authority.reason(shell_payload('echo changed > app.ts'))).toBeUndefined()

		for (const role of ['scheduler', 'reviewer', 'unknown', undefined]) {
			vi.stubEnv(agent_session_role.KEY, role)
			expect(implementation_authority.reason(payload([], 'apply_patch'))).toContain(UNKNOWN_INPUT)
		}
	})
})

// joshuafolkken/kit#8262: a consultation artifact is written to the scratch area and its script run
// only through `josh scratch:run`.
const SCRATCH_SCRIPT = '.josh/tmp/scratch/x/gen.mjs'
const SCRATCH_RULE = 'scratch:run'
// Every launcher that names a scratch script, not only a known interpreter, meets the scratch rule.
const LAUNCHERS = ['node', 'python3', 'python3.12', 'bash', 'source', '.', 'npx tsx', 'make -f']
const SCRATCH_LAUNCHERS = LAUNCHERS.map((name) => `${name} ${SCRATCH_SCRIPT}`)
const SCRATCH_DIRECT_RUNS = [
	`./${SCRATCH_SCRIPT}`,
	`"$PWD/${SCRATCH_SCRIPT}"`,
	`\${PWD}/${SCRATCH_SCRIPT}`,
	`node --loader=${SCRATCH_SCRIPT} a.mjs`,
	`find . -exec ./${SCRATCH_SCRIPT} {} ;`,
	`sh -c 'bash ${SCRATCH_SCRIPT}'`,
	`sed -f ${SCRATCH_SCRIPT} a.txt`,
]

describe('consultation scratch artifacts', () => {
	it('allows writing a script of any extension into the scratch area', () => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(payload([SCRATCH_SCRIPT], 'Write'))).toBeUndefined()
	})

	it.each(['src/app.ts', RUNTIME_FILE, '.josh/tmp/gen.mjs'])(
		'still refuses a write outside the scratch area: %s',
		(file_path) => {
			vi.stubEnv(agent_session_role.KEY, undefined)

			expect(implementation_authority.reason(payload([file_path], 'Write'))).toContain(REFUSED)
			expect(implementation_authority.reason(payload([file_path]))).toContain(REFUSED)
		},
	)

	it.each([
		['node --input-type=module - out.png <<EOF\nx\nEOF', 'a heredoc'],
		...[...SCRATCH_LAUNCHERS, ...SCRATCH_DIRECT_RUNS].map((command) => [command, SCRATCH_RULE]),
	])('refuses %s', (command, rule) => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(shell_payload(command))).toContain(rule)
	})

	it.each([
		`pnpm josh scratch:run ${SCRATCH_SCRIPT}`,
		`cat ${SCRATCH_SCRIPT}`,
		'ls .josh/tmp/scratch',
		'printf x | tee .josh/tmp/scratch/x/out.png',
		'printf x > .josh/tmp/scratch/x/out.svg',
	])('runs %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(shell_payload(command))).toBeUndefined()
	})
})

// joshuafolkken/kit#7761: a no-filing request is built by the production subagent alone.
const NO_FILING = '起票せずにボタンを作って'
const PLAIN = 'ボタンを作って'
const TIMESTAMP = '2026-11-18T00:00:00.000Z'
const PRODUCER = { agent_id: 'a1', agent_type: 'producer' }

function prompt_line(content: unknown): string {
	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { role: 'user', content } })
}

const TOOL_USE_ID = 'toolu_producer'
// The consultation's Agent call that dispatched the producer (joshuafolkken/kit#8248).
const DISPATCH = JSON.stringify({
	type: 'assistant',
	timestamp: TIMESTAMP,
	message: { content: [{ type: 'tool_use', id: TOOL_USE_ID, name: 'Agent', input: {} }] },
})

const LAUNCHED: { tool_use_id?: string } = { tool_use_id: TOOL_USE_ID }

// A parent transcript, with the harness's launch record for `PRODUCER` naming `tool_use_id`, or none.
function transcript(lines: Array<string>, { tool_use_id } = LAUNCHED): string {
	const directory = create_directory('authority-transcript-')
	const file_path = path.join(directory, 'session.jsonl')
	const subagents = path.join(directory, 'session', 'subagents')

	writeFileSync(file_path, `${lines.join('\n')}\n`)
	if (tool_use_id === undefined) return file_path
	mkdirSync(subagents, { recursive: true })
	writeFileSync(
		path.join(subagents, 'agent-a1.meta.json'),
		JSON.stringify({ toolUseId: tool_use_id }),
	)

	return file_path
}

function subagent_payload(transcript_path: string, unit: object, tool_name = 'Edit'): string {
	const tool_input =
		tool_name === 'Bash'
			? { command: `printf x > ${RUNTIME_FILE}` }
			: { file_paths: [RUNTIME_FILE] }

	return JSON.stringify({ tool_name, tool_input, transcript_path, ...unit })
}

// The scheduler's verdict — the interactive main line a no-filing request reaches.
function verdict(transcript_path: string, unit: object, tool_name = 'Edit'): string | undefined {
	vi.stubEnv(agent_session_role.KEY, 'scheduler')

	return implementation_authority.reason(subagent_payload(transcript_path, unit, tool_name))
}

function asked(): string {
	return transcript([prompt_line(NO_FILING), DISPATCH])
}

describe('no-filing production authority', () => {
	it.each(['producer', 'kit:producer'])('allows a %s subagent edit asked for', (agent_type) => {
		expect(verdict(asked(), { ...PRODUCER, agent_type })).toBeUndefined()
	})

	it.each([
		['the main session itself', {}],
		['a main session launched as the producer agent', { agent_type: 'producer' }],
		['a subagent of another type', { agent_id: 'a1', agent_type: 'investigator' }],
		['a producer whose id leaves the launch records', { ...PRODUCER, agent_id: '/../agent-a1' }],
	])('refuses %s on the same prompt', (_name, unit) => {
		expect(verdict(asked(), unit)).toContain(REFUSED)
	})

	it('refuses the producer when the prompt asks for no such thing', () => {
		const plain = transcript([prompt_line(PLAIN), DISPATCH])

		expect(verdict(plain, PRODUCER)).toContain(REFUSED)
	})

	it('keeps refusing the producer’s shell write and a missing transcript', () => {
		const missing = path.join(ROOT, 'no-such-session.jsonl')

		expect(verdict(asked(), PRODUCER, 'Bash')).toContain(REFUSED)
		expect(verdict(missing, PRODUCER)).toContain(REFUSED)
	})
})

// joshuafolkken/kit#8248: the grant is read from the prompt the producer was dispatched under.
describe('no-filing production authority — the dispatching prompt', () => {
	it('keeps the grant when the person prompts again while the producer works', () => {
		const later = transcript([prompt_line(NO_FILING), DISPATCH, prompt_line(PLAIN)])

		expect(verdict(later, PRODUCER, 'Write')).toBeUndefined()
	})

	it('reads the dispatching prompt, not a no-filing prompt sent after it', () => {
		const later = transcript([prompt_line(PLAIN), DISPATCH, prompt_line(NO_FILING)])

		expect(verdict(later, PRODUCER, 'Write')).toContain(REFUSED)
	})

	it.each([
		['no launch record', {}],
		['a launch record naming no call on the transcript', { tool_use_id: 'toolu_other' }],
	])('refuses the producer with %s', (_name, launch) => {
		const unknown = transcript([prompt_line(NO_FILING), DISPATCH], launch)

		expect(verdict(unknown, PRODUCER, 'Write')).toContain(REFUSED)
	})

	it('grants nothing from a tool result or a hand-back that says no filing', () => {
		const forged = transcript([
			prompt_line(PLAIN),
			prompt_line([{ type: 'tool_result', tool_use_id: 't1', content: NO_FILING }]),
			JSON.stringify({
				type: 'user',
				timestamp: TIMESTAMP,
				origin: { kind: 'task' },
				message: { content: NO_FILING },
			}),
			DISPATCH,
		])

		expect(verdict(forged, PRODUCER)).toContain(REFUSED)
	})
})
