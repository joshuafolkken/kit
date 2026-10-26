import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob } from './ci-yml-fixture'

// joshuafolkken/kit#4449: a main push that reuses a pull request's Checks skips `static-checks`, so
// nothing saved an ESLint cache for it and the next pull request restored one several merges old. The
// pull request's run hands its cache over as an artifact, and `seed-eslint-cache` saves it under the
// push's key. These guards pin the hand-off: the prefix the run uploads is the key it restores with,
// and the seed job runs only on a proven reuse, from that exact run.
const RUNTIME = ci_yml_fixture.RUNTIME_CI_YML
const STATIC_JOB = 'static-checks'
const SEED_JOB = 'seed-eslint-cache'
const REUSE_JOB = 'reuse-pr-checks'
const RESTORE_STEP = 'eslint-cache'
const SHA_SUFFIX = '${{ github.sha }}'
const CACHE_PATH = '.eslintcache'
const PULL_REQUEST_ONLY = "github.event_name == 'pull_request'"
const PREFIX_FILE = 'eslint-cache-prefix'
const UPLOAD_ARTIFACT = 'eslint-cache-${{ github.event.pull_request.number }}'

function job(job_name: string): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(RUNTIME, job_name)
}

function step_with(job_name: string, step_id: string, input: string): string {
	return String(ci_yml_fixture.find_step_by_id(job(job_name), step_id)?.with?.[input] ?? '')
}

function upload_input(input: string): string | number | undefined {
	return ci_yml_fixture.upload_input(
		ci_yml_fixture.find_upload(job(STATIC_JOB), UPLOAD_ARTIFACT),
		input,
	)
}

function uploaded_prefix(): string {
	const step = ci_yml_fixture.find_step_by_id(job(STATIC_JOB), PREFIX_FILE)

	return step?.env?.['ESLINT_CACHE_PREFIX'] ?? ''
}

function seed_script(): string {
	return ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(job(SEED_JOB), 'download'))
}

describe('the pull request run hands its ESLint cache over', () => {
	it('uploads the prefix the cache key is built from, without the sha', () => {
		const prefix = uploaded_prefix()

		expect(prefix).not.toBe('')
		expect(step_with(STATIC_JOB, RESTORE_STEP, 'key')).toBe(`${prefix}${SHA_SUFFIX}`)
	})

	it('uploads the cache file and the prefix only on a pull request', () => {
		const upload = ci_yml_fixture.find_upload(job(STATIC_JOB), UPLOAD_ARTIFACT)
		const upload_path = String(upload_input(ci_yml_fixture.UPLOAD_PATH_INPUT))

		expect(upload?.if).toBe(PULL_REQUEST_ONLY)
		expect(upload_path).toContain(CACHE_PATH)
		expect(upload_path).toContain(PREFIX_FILE)
		expect(upload_input('include-hidden-files')).toBe(true)
	})

	it('keeps the pull request green when the upload fails', () => {
		const upload = ci_yml_fixture.find_upload(job(STATIC_JOB), UPLOAD_ARTIFACT)

		expect(ci_yml_fixture.step_continue_on_error(upload)).toBe(true)
	})
})

describe('a reused main push saves that cache', () => {
	it('runs only when the reuse proof answered true', () => {
		expect(ci_yml_fixture.job_needs(job(SEED_JOB))).toContain(REUSE_JOB)
		expect(job(SEED_JOB)?.if).toContain("needs.reuse-pr-checks.outputs.reuse == 'true'")
	})

	it('reads the artifact from the run the proof selected', () => {
		const outputs = job(REUSE_JOB)?.outputs
		const prove = ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(job(REUSE_JOB), 'prove'))

		expect(prove).toContain('echo "run-id=${run_id}" >> "$GITHUB_OUTPUT"')
		expect(prove).toContain('echo "pull-number=${pull_number}" >> "$GITHUB_OUTPUT"')
		expect(outputs?.['run-id']).toBe('${{ steps.prove.outputs.run-id }}')
		expect(outputs?.['pull-number']).toBe('${{ steps.prove.outputs.pull-number }}')
		expect(seed_script()).toContain('gh run download "${RUN_ID}"')
		expect(seed_script()).toContain('--name "eslint-cache-${PULL_NUMBER}"')
	})

	it('checks the prefix before it becomes a key, and stays green without one', () => {
		const script = seed_script()

		expect(script).toContain('-eslint-cache-v[0-9.]+-')
		expect(script.indexOf('grep -Eq')).toBeLessThan(script.indexOf('prefix=${prefix}'))
		expect(script).not.toContain('exit 1')
	})

	it('saves the downloaded file under the push sha, and only with a checked prefix', () => {
		const save = ci_yml_fixture.find_step_by_id(job(SEED_JOB), 'save')

		expect(save?.uses).toContain('actions/cache@')
		expect(save?.if).toBe("steps.download.outputs.prefix != ''")
		expect(step_with(SEED_JOB, 'save', 'path')).toContain(CACHE_PATH)
		// actions/cache versions an entry by its path list, so a seed saved under a different list is
		// invisible to the pull request's restore.
		expect(step_with(SEED_JOB, 'save', 'path')).toBe(step_with(STATIC_JOB, RESTORE_STEP, 'path'))
		expect(step_with(SEED_JOB, 'save', 'key')).toBe(
			`\${{ steps.download.outputs.prefix }}${SHA_SUFFIX}`,
		)
	})
})

// joshuafolkken/kit#5050: an outside author's run can write any `.eslintcache`, so only a pull request
// whose author holds a trusted association is promoted to main's scope. The download step runs
// under `bash -e`, as a runner does, with a stub `gh` that hands back a valid prefix file, so a row
// reads what the script actually does rather than what its text contains.
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR']
const UNTRUSTED = ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE', '']
const STUB_PREFIX = 'Linux-eslint-cache-v24.1.0-0a1b-2c3d-'
const work_directory = mkdtempSync(path.join(tmpdir(), 'seed-eslint-cache-'))

afterAll(() => {
	rmSync(work_directory, { recursive: true, force: true })
})

function write_stub_gh(directory: string): void {
	const stub = path.join(directory, 'bin', 'gh')

	mkdirSync(path.dirname(stub), { recursive: true })
	writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' '${STUB_PREFIX}' > ${PREFIX_FILE}\n`)
	chmodSync(stub, 0o755)
}

function run_download(association: string): { did_download: boolean; output: string } {
	const directory = mkdtempSync(path.join(work_directory, 'run-'))
	const output_path = path.join(directory, 'output')

	write_stub_gh(directory)
	writeFileSync(output_path, '')
	const result = spawnSync('bash', ['-e', '-c', seed_script()], {
		cwd: directory,
		env: {
			...process.env,
			PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
			GITHUB_OUTPUT: output_path,
			AUTHOR_ASSOCIATION: association,
		},
		encoding: 'utf8',
	})

	expect(result.status, result.stderr).toBe(0)

	return {
		did_download: existsSync(path.join(directory, PREFIX_FILE)),
		output: readFileSync(output_path, 'utf8'),
	}
}

describe('the seed promotes only a trusted author association', () => {
	it('carries the author association from the reuse proof', () => {
		const prove = ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(job(REUSE_JOB), 'prove'))
		const download = ci_yml_fixture.find_step_by_id(job(SEED_JOB), 'download')

		expect(prove).toContain('.merged_at, .author_association] | @tsv')
		expect(prove).toContain('echo "author-association=${author_association}" >> "$GITHUB_OUTPUT"')
		expect(job(REUSE_JOB)?.outputs?.['author-association']).toBe(
			'${{ steps.prove.outputs.author-association }}',
		)
		expect(download?.env?.['AUTHOR_ASSOCIATION']).toBe(
			'${{ needs.reuse-pr-checks.outputs.author-association }}',
		)
	})

	it.each(TRUSTED)('downloads and hands the prefix on for %s', (association) => {
		const { did_download, output } = run_download(association)

		expect(did_download).toBe(true)
		expect(output).toBe(`prefix=${STUB_PREFIX}\n`)
	})

	it.each(UNTRUSTED)('neither downloads nor saves for "%s", and stays green', (association) => {
		const { did_download, output } = run_download(association)

		expect(did_download).toBe(false)
		expect(output).toBe('')
	})
})
