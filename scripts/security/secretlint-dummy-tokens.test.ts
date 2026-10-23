import { resolve_local_bin } from '#scripts/build/local-bin'
import { package_path } from '#scripts/init/init-paths'
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { secretlint_scan } from './secretlint-scan'

// joshuafolkken/kit#4657: the CI `Secret Scan` job fails a pull request on any finding, so the dummy
// tokens the test suites carry must pass the project's `.secretlintrc.json` as they stand. The files
// are found by the tokens rather than listed, so a new test that copies one is covered as well.
const DUMMY_TOKENS = ['sk-ant-oat01-exampleTokenValue', 'ghp_abc123']

function files_carrying_dummy_tokens(): Array<string> {
	const patterns = DUMMY_TOKENS.flatMap((token) => ['-e', token])
	const result = execaSync('git', ['grep', '-l', '-F', ...patterns], {
		cwd: package_path('.'),
		reject: false,
	})

	return result.stdout.split('\n').filter(Boolean)
}

describe('the secretlint configuration and the dummy tokens in the tests', () => {
	it('reports no finding on the files that carry them', () => {
		const files = files_carrying_dummy_tokens()
		const binary = resolve_local_bin(package_path('.'), 'secretlint')
		const scan = execaSync(binary, secretlint_scan.build_scan_arguments(files), {
			cwd: package_path('.'),
			reject: false,
		})

		expect(files).not.toEqual([])
		expect(scan.stdout).toBe('')
		expect(scan.exitCode).toBe(0)
	})
})
