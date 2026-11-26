import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentProfile } from '#scripts/agent/agent-profile-schema'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { run_handoff_route, type RouteInput } from './run-handoff-route'

// joshuafolkken/kit#8891: the `run:handoff` kickoff child runs on the weakest worker profile behind
// `josh.handoff.route`.

const SONNET_MODEL = 'claude-sonnet-5-5'
const OPUS_MODEL = 'claude-opus-5-5'
const SONNET = { name: 'sonnet', model: SONNET_MODEL, effort: 'low', when: 'Small work' }
const OPUS = { name: 'opus', model: OPUS_MODEL, effort: 'high', when: 'Design work' }
const WORKER = { default: 'opus', profiles: [SONNET, OPUS] }
const SCHEDULER: AgentProfile = {
	provider: 'anthropic',
	role: 'scheduler',
	model: OPUS_MODEL,
	effort: 'medium',
}
const ROUTED = { ...SCHEDULER, model: SONNET_MODEL, effort: 'low' }
const fixture = { directory: '' }
const make_directory = temporary_directory()

function write_josh(josh: object): void {
	writeFileSync(path.join(fixture.directory, PACKAGE_JSON), JSON.stringify({ name: 'app', josh }))
}

function input(overrides: Partial<RouteInput>): RouteInput {
	return {
		keyword: 'kickoff',
		resolved: SCHEDULER,
		environment: {},
		cwd: fixture.directory,
		...overrides,
	}
}

beforeEach(() => {
	fixture.directory = make_directory('handoff-route-')
})

describe('run_handoff_route.profile_of — the switch on', () => {
	beforeEach(() => {
		write_josh({ handoff: { route: true }, worker: WORKER })
	})

	it('runs the kickoff child on the weakest profile’s model and effort, keeping the scheduler role', () => {
		expect(run_handoff_route.profile_of(input({}))).toStrictEqual(ROUTED)
	})

	it.each(['retrospective', 'fullrun', 'halfrun', 'prrun', undefined] as const)(
		'keeps the resolved profile for %s',
		(keyword) => {
			expect(run_handoff_route.profile_of(input({ keyword }))).toStrictEqual(SCHEDULER)
		},
	)

	it.each(['JOSH_SCHEDULER_MODEL', 'JOSH_SCHEDULER_EFFORT'])(
		'lets %s a person set win over the route',
		(key) => {
			const environment = { [key]: OPUS_MODEL }

			expect(run_handoff_route.profile_of(input({ environment }))).toStrictEqual(SCHEDULER)
		},
	)

	it('keeps the resolved profile when the weakest profile runs on another provider', () => {
		const resolved: AgentProfile = { ...SCHEDULER, provider: 'openai', model: 'gpt-6.1-sol' }

		expect(run_handoff_route.profile_of(input({ resolved }))).toStrictEqual(resolved)
	})
})

describe('run_handoff_route.profile_of — the switch off or unset', () => {
	it.each([
		['route: false', { handoff: { route: false }, worker: WORKER }],
		['no josh.handoff', { worker: WORKER }],
		['no josh.worker', { handoff: { route: true } }],
	])('keeps the scheduler profile with %s', (_name, josh) => {
		write_josh(josh)

		expect(run_handoff_route.profile_of(input({}))).toStrictEqual(SCHEDULER)
	})

	it('keeps the scheduler profile where no manifest is readable', () => {
		expect(run_handoff_route.profile_of(input({ cwd: '/no/such/repo' }))).toStrictEqual(SCHEDULER)
	})
})
