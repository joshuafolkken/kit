import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { epic_add_fixture } from '#scripts/epic/epic-add-fixture'
import { describe, expect, it } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const KINDS = ['kit', 'consumer', 'lane'] as const
const environment = josh_harness_fixture.open_environments(KINDS)
const { SCENARIO_TIMEOUT_MS } = josh_harness_fixture
const EXECUTABLE_MODE = 0o755
const EPIC = 100
const FIRST = 101
const REMOVED = 102
const LAST = 103
const OTHER_FIRST = 104
const OTHER_LAST = 105
const STATE_FILE = 'epic-state.json'
const KEPT_CHAIN = '#104 -> #105'
const INITIAL_BODY = epic_add_fixture.body_of(
	['#101 -> #102 -> #103', KEPT_CHAIN],
	[FIRST, REMOVED, LAST, OTHER_FIRST, OTHER_LAST],
)
const EXPECTED_BODY = epic_add_fixture.body_of([KEPT_CHAIN], [FIRST, LAST, OTHER_FIRST, OTHER_LAST])

// Stateful transport: unknown calls fail closed, and only CLI writes can change the saved graph.
const GH_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('gh version 2.0.0'); process.exit(0) }
const statePath = process.env.JOSH_EPIC_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const journal = statePath + '.deleted'
state.deleted = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse) : []
state.deleted.sort((left, right) => left[1] - right[1])
for (const [blocker, blocked] of state.deleted) {
  state.blockers[blocked] = state.blockers[blocked].filter(value => value !== blocker)
}
const included = args.includes('--include')
const endpoint = (included ? args.at(-1) : args[1]).split('?')[0]
const method = args[args.indexOf('--method') + 1]
const number = Number(endpoint.split('/')[4])
function issue(value) {
  return { number: value, id: value, state: 'open', labels: [{ name: 'epic' }],
    body: value === 100 ? state.body : '',
    repository_url: 'https://api.github.com/repos/joshuafolkken/kit',
    issue_dependencies_summary: { total_blocked_by: (state.blockers[value] ?? []).length } }
}
function answer() {
  if (endpoint.split('/').length === 3) return { full_name: 'joshuafolkken/kit' }
  if (method === 'DELETE') {
    const blocker = Number(endpoint.split('/').at(-1))
    fs.appendFileSync(journal, JSON.stringify([blocker, number]) + '\n')
    return ''
  }
  if (method === 'PATCH') {
    state.body = JSON.parse(fs.readFileSync(0, 'utf8')).body
    state.patches += 1
    fs.writeFileSync(statePath, JSON.stringify(state))
    return 'https://github.com/joshuafolkken/kit/issues/100'
  }
  if (endpoint.endsWith('/dependencies/blocked_by')) return (state.blockers[number] ?? []).map(issue)
  if (Number.isInteger(number) && number >= 100 && number <= 105) {
    return args.includes('.id') ? number : issue(number)
  }
  throw new Error('Unexpected gh call: ' + args.join(' '))
}
const result = answer()
// A conditional read (--include) carries a status line and headers before the body.
if (included) console.log('HTTP/2.0 200 OK\n')
console.log(typeof result === 'string' ? result : JSON.stringify(result))
`

function state_path(opened: JoshEnvironment): string {
	return path.join(opened.workspace, STATE_FILE)
}

function setup_transport(opened: JoshEnvironment): Record<string, string | undefined> {
	const bin = path.join(opened.workspace, 'offline-bin')

	mkdirSync(bin, { recursive: true })
	writeFileSync(path.join(bin, 'gh'), GH_SCRIPT, { mode: EXECUTABLE_MODE })
	writeFileSync(
		state_path(opened),
		JSON.stringify({
			body: INITIAL_BODY,
			blockers: { [REMOVED]: [FIRST], [LAST]: [REMOVED], [OTHER_LAST]: [OTHER_FIRST] },
			deleted: [],
			patches: 0,
		}),
	)

	return {
		...josh_harness.CHILD_ENVIRONMENT,
		PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
		JOSH_NOTIFY: 'off',
		JOSH_EPIC_STATE: state_path(opened),
	}
}

async function untrack(
	opened: JoshEnvironment,
	command_environment: Record<string, string | undefined>,
): Promise<void> {
	const result = await josh_harness.run_command(
		opened.launcher.executable,
		[...opened.launcher.leading_arguments, 'epic', '--untrack', String(EPIC), String(REMOVED)],
		{ cwd: opened.root, env: command_environment, timeout_ms: SCENARIO_TIMEOUT_MS },
	)

	expect(result.is_timed_out).toBe(false)
	expect(result.exit_code, result.stderr + result.stdout).toBe(0)
}

function assert_untracked(opened: JoshEnvironment): void {
	const state = JSON.parse(readFileSync(state_path(opened), 'utf8'))
	const deletions = readFileSync(`${state_path(opened)}.deleted`, 'utf8')
		.trim()
		.split('\n')
		.toSorted((left, right) => left.localeCompare(right))

	expect(deletions).toEqual([JSON.stringify([FIRST, REMOVED]), JSON.stringify([REMOVED, LAST])])
	expect(state).toEqual({
		body: EXPECTED_BODY,
		blockers: { [REMOVED]: [], [LAST]: [], [OTHER_LAST]: [OTHER_FIRST] },
		deleted: [
			[FIRST, REMOVED],
			[REMOVED, LAST],
		],
		patches: 1,
	})
}

describe('josh harness — epic child removal', () => {
	it.each(KINDS)(
		'removes connected relations and rows without reconnecting survivors in %s, safely twice',
		async (kind) => {
			const opened = environment(kind)
			const command_environment = setup_transport(opened)

			if (kind === 'consumer') expect(existsSync(path.join(opened.root, 'docs'))).toBe(false)
			await untrack(opened, command_environment)
			assert_untracked(opened)
			await untrack(opened, command_environment)
			assert_untracked(opened)
		},
		SCENARIO_TIMEOUT_MS,
	)
})
