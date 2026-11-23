import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	agent_worker_profile,
	type WorkerResult,
	type WorkerSettings,
} from './agent-worker-profile'

const HAIKU_NAME = 'haiku'
const HAIKU_MODEL = 'claude-haiku-5-5'
const SONNET_NAME = 'sonnet-medium'
const OPUS_NAME = 'opus-high'
const UNSET = { kind: 'unset' }
const HAIKU = { name: HAIKU_NAME, model: HAIKU_MODEL, effort: 'low', when: 'Mechanical work' }
const SONNET_MODEL = 'claude-sonnet-5-5'
const OPUS_MODEL = 'claude-opus-5-5'
const SONNET = { name: SONNET_NAME, model: SONNET_MODEL, effort: 'medium', when: 'A brief' }
const OPUS = { name: OPUS_NAME, model: OPUS_MODEL, effort: 'high', when: 'A core rebuild' }
const WORKER = { default: SONNET_NAME, profiles: [HAIKU, SONNET, OPUS] }
const KIT_ROOT = path.resolve(import.meta.dirname, '../..')
const LIGHT_BODY =
	'## 背景\n\n- 種別: 非不具合\n- 規模見積もり: 約 1 ファイル / 20 行（テスト含む）'
const fixture = { directory: '' }
const make_directory = temporary_directory()

function write_manifest(manifest: object): void {
	writeFileSync(path.join(fixture.directory, PACKAGE_JSON), JSON.stringify(manifest))
}

function write_worker(worker: object): void {
	write_manifest({ name: 'app', josh: { worker } })
}

function with_sonnet(change: object): object {
	return { ...WORKER, profiles: [{ ...SONNET, ...change }] }
}

function settings(): WorkerSettings {
	write_worker(WORKER)
	const result = agent_worker_profile.read(fixture.directory)
	if (result.kind !== 'settings') throw new Error(`expected settings, got ${result.kind}`)

	return result.settings
}

async function resolved(labels: ReadonlyArray<string> | undefined): Promise<WorkerResult> {
	write_worker(WORKER)

	return await agent_worker_profile.resolve(fixture.directory, async () => await labels)
}

async function resolved_name(labels: ReadonlyArray<string>): Promise<string | undefined> {
	const result = await resolved(labels)

	return result.kind === 'worker' ? result.worker.name : undefined
}

beforeEach(() => {
	fixture.directory = make_directory('agent-worker-profile-')
})

describe('agent_worker_profile.read — a josh.worker setting', () => {
	it('reads the profiles weakest first, escalate defaulting to false', () => {
		const read = settings()

		expect(read.profiles.map((profile) => profile.name)).toEqual([
			HAIKU_NAME,
			SONNET_NAME,
			OPUS_NAME,
		])
		expect(read.profiles[0]?.agent).toEqual({
			provider: 'anthropic',
			role: 'worker',
			model: HAIKU_MODEL,
			effort: 'low',
		})
		expect(read.escalate).toBe(false)
	})

	it.each([
		['a default no profile names', { ...WORKER, default: 'opus-medium' }, 'default must name one'],
		[
			'a repeated profile name',
			{ ...WORKER, profiles: [HAIKU, HAIKU] },
			'josh.worker.profiles: profile names must be unique',
		],
		['an effort outside low to max', with_sonnet({ effort: 'none' }), 'effort none is not one of'],
		['an unsafe model', with_sonnet({ model: 'claude\nrm' }), 'is not a safe model'],
		['a consultation model', with_sonnet({ model: 'claude-fable-5-1' }), 'is a consultation model'],
	])('rejects %s with the reason', (_label, worker, reason) => {
		write_worker(worker)
		const result = agent_worker_profile.read(fixture.directory)

		expect(result.kind).toBe('rejected')
		expect(result.kind === 'rejected' ? result.note : '').toContain(reason)
	})
})

describe('agent_worker_profile.read — no josh.worker setting', () => {
	it.each([
		['a manifest without the setting', { name: 'app' }],
		['a josh block without the setting', { name: 'app', josh: { review_gate: 'ci' } }],
	])('answers unset for %s', (_label, manifest) => {
		write_manifest(manifest)

		expect(agent_worker_profile.read(fixture.directory)).toEqual(UNSET)
	})

	it('answers unset where no manifest exists', () => {
		expect(agent_worker_profile.read(fixture.directory)).toEqual(UNSET)
	})
})

describe("agent_worker_profile.read — kit's own setting (joshuafolkken/kit#8760)", () => {
	it('routes between Sonnet and an Opus default', () => {
		const read = agent_worker_profile.read(KIT_ROOT)
		if (read.kind !== 'settings') throw new Error(`expected settings, got ${read.kind}`)
		const models = read.settings.profiles.map((profile) => profile.agent.model)

		expect(read.settings.route).toBe(true)
		expect(models).toEqual([SONNET_MODEL, OPUS_MODEL])
		expect(agent_worker_profile.for_labels(read.settings, [])).toMatchObject({
			worker: { agent: { model: OPUS_MODEL } },
		})
	})
})

describe('agent_worker_profile.resolve — josh.worker.route', () => {
	async function routed_name(
		route: boolean,
		labels: ReadonlyArray<string>,
		body?: string,
	): Promise<string> {
		write_worker({ ...WORKER, route })
		const result = await agent_worker_profile.resolve(
			fixture.directory,
			async () => await labels,
			async () => await body,
		)

		return result.kind === 'worker' ? result.worker.name : result.kind
	}

	it('runs a light unlabelled Issue on the weakest profile', async () => {
		expect(await routed_name(true, [], LIGHT_BODY)).toBe(HAIKU_NAME)
	})

	it.each<[string, boolean, ReadonlyArray<string>, string | undefined]>([
		['the switch off', false, [], LIGHT_BODY],
		['a heavy body', true, [], '## 背景\n\n- 互換性: 破壊的変更'],
		['a body read that failed', true, [], undefined],
	])('keeps the default with %s', async (_name, route, labels, body) => {
		expect(await routed_name(route, labels, body)).toBe(SONNET_NAME)
	})

	it("keeps a person's worker label over the rule", async () => {
		expect(await routed_name(true, [`worker:${OPUS_NAME}`], LIGHT_BODY)).toBe(OPUS_NAME)
	})
})

describe('agent_worker_profile.resolve — the profile an Issue runs on', () => {
	it('picks the profile its worker:<name> label names', async () => {
		expect(await resolved_name(['enhancement', `worker:${OPUS_NAME}`])).toBe(OPUS_NAME)
	})

	it('falls back to the default without a worker label', async () => {
		expect(await resolved_name(['enhancement'])).toBe(SONNET_NAME)
	})

	it.each([
		[
			'an unknown worker label',
			['worker:opus-max'],
			'has no profile for the label worker:opus-max',
		],
		['two worker labels', [`worker:${HAIKU_NAME}`, `worker:${OPUS_NAME}`], 'allows one'],
		['a label read that failed', undefined, 'could not read the Issue labels'],
	])('rejects %s, naming the reason', async (_label, labels, reason) => {
		const result = await resolved(labels)

		expect(result.kind === 'rejected' ? result.note : '').toContain(reason)
	})

	it('answers unset without fetching the labels where no setting exists', async () => {
		write_manifest({ name: 'app' })
		const fetch_labels = vi.fn(async (): Promise<ReadonlyArray<string>> => [])

		expect(await agent_worker_profile.resolve(fixture.directory, fetch_labels)).toEqual(UNSET)
		expect(fetch_labels).not.toHaveBeenCalled()
	})
})

describe('agent_worker_profile.next — one step up the escalation order', () => {
	it('answers the next profile in the list', () => {
		const read = settings()
		const [haiku] = read.profiles
		if (haiku === undefined) throw new Error('expected a first profile')

		expect(agent_worker_profile.next(read, haiku)?.name).toBe(SONNET_NAME)
	})

	it('answers undefined at the top', () => {
		const read = settings()
		const top = read.profiles.at(-1)
		if (top === undefined) throw new Error('expected a last profile')

		expect(agent_worker_profile.next(read, top)).toBeUndefined()
	})
})
