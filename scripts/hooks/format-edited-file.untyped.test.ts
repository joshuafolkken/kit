import { untyped_environment } from '#eslint/untyped-environment.js'
import { eslint_heap } from '#scripts/lint/eslint-heap'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { make_directory_helpers, payload_for } from './format-edited-file-fixtures'

vi.mock('execa', () => ({ execa: vi.fn() }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { format_edited_payload } = await import('./format-edited-file')

const make_directory = temporary_directory('suite')
const TEST_DIRECTORY = make_directory('format-edited-untyped-')
const { write_fixture } = make_directory_helpers(TEST_DIRECTORY)

function spawned_environments(): ReadonlyArray<unknown> {
	return mocked_execa.mock.calls.map((call) => {
		const options: unknown = call.at(-1)

		return typeof options === 'object' && options !== null && 'env' in options
			? options.env
			: undefined
	})
}

// joshuafolkken/kit#6768: whichever route the hook takes — the daemon it may start, the shim or
// `pnpm exec` — eslint lints without a type program.
describe('format_edited_payload — the type program', () => {
	it('spawns every formatter with the untyped switch', async () => {
		mocked_execa.mockResolvedValue({ exitCode: 0, stdout: '' } as unknown as Awaited<
			ReturnType<typeof execa_module.execa>
		>)

		await format_edited_payload(payload_for(write_fixture('edited.ts')), TEST_DIRECTORY)

		expect(spawned_environments().length).toBeGreaterThan(0)

		for (const environment of spawned_environments()) {
			expect(environment).toMatchObject(untyped_environment.environment())
		}
	})
})

// joshuafolkken/kit#7247: a daemon the hook starts gets the heap the lint path starts it with.
describe('format_edited_payload — the heap', () => {
	it('spawns every formatter with the daemon launch heap', async () => {
		vi.stubEnv('NODE_OPTIONS', '')
		mocked_execa.mockResolvedValue({ exitCode: 0, stdout: '' } as unknown as Awaited<
			ReturnType<typeof execa_module.execa>
		>)

		await format_edited_payload(payload_for(write_fixture('edited.ts')), TEST_DIRECTORY)

		expect(spawned_environments().length).toBeGreaterThan(0)

		for (const environment of spawned_environments()) {
			expect(environment).toMatchObject({ NODE_OPTIONS: eslint_heap.with_heap('') })
		}

		vi.unstubAllEnvs()
	})
})
