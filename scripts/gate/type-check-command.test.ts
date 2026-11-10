import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fake_result } from '#tools/test/execa-result'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { project_checks } from './project-checks'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { type_check_command } = await import('./type-check-command')
const { TSC_ARGS } = await import('./tsc-arguments')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const make_directory = temporary_directory()
const NODE_MANIFEST = '{"name":"app"}'

function fixture(manifest: string): string {
	const root = make_directory('josh-type-check-')

	writeFileSync(path.join(root, 'package.json'), manifest)

	return root
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh check on a basic project', () => {
	it('skips with the reason instead of reaching a missing tsc', async () => {
		const root = fixture('{"josh":{"profile":"static"}}')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>')

		expect(await type_check_command.run_type_check([], root)).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info).toHaveBeenCalledWith(
			project_checks.skip_notice('check', 'no TypeScript files were found'),
		)
	})
})

describe('josh check on a full project', () => {
	it('runs tsc with the cache flags and the forwarded arguments', async () => {
		const root = fixture(NODE_MANIFEST)

		mocked_execa.mockResolvedValue(fake_result(0))

		expect(await type_check_command.run_type_check(['--pretty'], root)).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith('pnpm', [...TSC_ARGS, '--pretty'], {
			cwd: root,
			stdio: 'inherit',
			reject: false,
		})
	})

	it('returns the type checker failure', async () => {
		mocked_execa.mockResolvedValue(fake_result(2))

		expect(await type_check_command.run_type_check([], fixture(NODE_MANIFEST))).toBe(2)
	})
})
