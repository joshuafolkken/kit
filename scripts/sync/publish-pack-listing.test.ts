import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const PACK_JOB = ci_yml_fixture.find_job('.github/workflows/publish.yml', 'pack')
const PACK_OUTPUT = 'pack-output.txt'
const LISTING_LINE = 'scripts/lane/lane-session.ts'
const make_directory = temporary_directory()

// A pnpm that fails the way the runner's did (joshuafolkken/kit#7635) whenever its stdout is a pipe,
// and otherwise prints a listing larger than a pipe holds.
const FAKE_PNPM = `#!/usr/bin/env bash
if [ -p /dev/stdout ]; then exit 1; fi
for i in $(seq 3000); do echo "${LISTING_LINE}"; done
`

function run_pack_step(): { status: number | null; directory: string } {
	const directory = make_directory('publish-pack-')
	const pnpm = path.join(directory, 'pnpm')

	writeFileSync(pnpm, FAKE_PNPM)
	chmodSync(pnpm, 0o755)
	const script = ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(PACK_JOB, 'pack'))
	const result = spawnSync('bash', ['-e', '-c', script], {
		cwd: directory,
		env: {
			...process.env,
			PATH: `${directory}:${process.env['PATH'] ?? ''}`,
			RUNNER_TEMP: directory,
			TARBALL: 'kit.tgz',
		},
	})

	return { status: result.status, directory }
}

describe('publish.yml — the pack listing', () => {
	it('keeps the pack listing off the stdout pipe, so a full pipe cannot fail the job', () => {
		const { status, directory } = run_pack_step()

		expect(status).toBe(0)
		expect(readFileSync(path.join(directory, PACK_OUTPUT), 'utf8')).toContain(LISTING_LINE)
	})

	it('uploads the pack listing as an artifact even when the pack fails', () => {
		const upload = ci_yml_fixture.find_upload(PACK_JOB, 'npm-package-contents')

		expect(upload?.if).toBe('always()')
		expect(upload?.with?.['path']).toBe(`\${{ runner.temp }}/${PACK_OUTPUT}`)
	})
})
