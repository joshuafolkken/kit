import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { REQUIRE_ENV } from '#scripts/security/secretlint-scan'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'

// joshuafolkken/kit#4657: the pre-commit secretlint scan skips when its binary is missing and never
// runs under `--no-verify`, so a pull request is scanned again in CI. The job is pinned in both the
// runtime workflow and the template `josh sync` distributes, and its step script is executed against
// a real merge commit, so what it hands secretlint is observed rather than matched as a substring.
const SECRET_SCAN_JOB = 'secret-scan'
const SECRET_SCAN_CONTEXT = 'Secret Scan'
const SCAN_STEP = 'scan'
const CHECKOUT_ACTION = 'actions/checkout'
const WORKFLOWS = [ci_yml_fixture.RUNTIME_CI_YML, ci_yml_fixture.TEMPLATE_CI_YML]
// GitHub runs a `shell: bash` step as `bash --noprofile --norc -eo pipefail {0}`.
const STEP_SHELL = ['--noprofile', '--norc', '-eo', 'pipefail', '-c']
const GIT_NAME = 'test'
const GIT_EMAIL = 'test@example.com'
const GIT_IDENTITY = {
	GIT_AUTHOR_NAME: GIT_NAME,
	GIT_AUTHOR_EMAIL: GIT_EMAIL,
	GIT_COMMITTER_NAME: GIT_NAME,
	GIT_COMMITTER_EMAIL: GIT_EMAIL,
}
const KEPT_FILE = 'kept.txt'
const ADDED_FILE = 'added file.txt'
const REMOVED_FILE = 'removed.txt'
const STUB_PNPM = '#!/bin/sh\nprintf "%s\\n" "$@" >> "$PNPM_ARGS"\n'
const EXECUTABLE = 0o755

const ctx = { root: '' }

function secret_scan_job(workflow: string): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(workflow, SECRET_SCAN_JOB)
}

function step_using(job: WorkflowJob | undefined, action: string): WorkflowStep | undefined {
	return job?.steps?.find((step) => ci_yml_fixture.action_name(step) === action)
}

function repository(): string {
	return path.join(ctx.root, 'repo')
}

function git(...arguments_: ReadonlyArray<string>): void {
	spawnSync('git', ['-c', 'init.defaultBranch=main', ...arguments_], {
		cwd: repository(),
		env: { ...process.env, ...GIT_IDENTITY },
	})
}

function write_file(name: string, content: string): void {
	writeFileSync(path.join(repository(), name), content)
}

function commit_all(message: string): void {
	git('add', '-A')
	git('commit', '-qm', message)
}

function commit_base(): void {
	mkdirSync(repository())
	git('init', '-q')
	write_file(KEPT_FILE, 'base\n')
	write_file(REMOVED_FILE, 'removed\n')
	commit_all('base')
}

// The checkout of a `pull_request` run is the merge commit, whose first parent is the base branch,
// so a file only the base changed must not reach the scan either.
function commit_pull_request_merge(): void {
	git('checkout', '-qb', 'feature')
	write_file(ADDED_FILE, 'new\n')
	write_file(KEPT_FILE, 'changed\n')
	git('rm', '-q', REMOVED_FILE)
	commit_all('feature')
	git('checkout', '-q', 'main')
	write_file('base-only.txt', 'base moved on\n')
	commit_all('base moves on')
	git('merge', '-q', '--no-ff', '-m', 'merge', 'feature')
}

function install_stub_pnpm(): void {
	const stub = path.join(ctx.root, 'pnpm')

	writeFileSync(stub, STUB_PNPM)
	chmodSync(stub, EXECUTABLE)
}

function run_scan_step(): number {
	const script = ci_yml_fixture.step_run(
		ci_yml_fixture.find_step_by_id(secret_scan_job(ci_yml_fixture.RUNTIME_CI_YML), SCAN_STEP),
	)
	const run = spawnSync('bash', [...STEP_SHELL, script], {
		cwd: repository(),
		env: {
			PATH: `${ctx.root}${path.delimiter}${process.env['PATH'] ?? ''}`,
			PNPM_ARGS: path.join(ctx.root, 'args'),
		},
	})

	return run.status ?? -1
}

function scanned_arguments(): Array<string> {
	try {
		return readFileSync(path.join(ctx.root, 'args'), 'utf8').split('\n').filter(Boolean)
	} catch {
		return []
	}
}

beforeEach(() => {
	ctx.root = mkdtempSync(path.join(tmpdir(), 'ci-secret-scan-'))
	install_stub_pnpm()
	commit_base()
})

afterEach(() => {
	rmSync(ctx.root, { recursive: true, force: true })
})

describe.each(WORKFLOWS)('the Secret Scan job in %s', (workflow) => {
	it('reports the Secret Scan context on pull requests only', () => {
		const job = secret_scan_job(workflow)

		expect(job?.name).toBe(SECRET_SCAN_CONTEXT)
		expect(job?.if).toBe("github.event_name == 'pull_request'")
	})

	// Off the critical path: it waits for nothing, and nothing waits for it.
	it('runs in parallel with every other job', () => {
		const jobs = Object.values(ci_yml_fixture.load_workflow(workflow).jobs)

		expect(ci_yml_fixture.job_needs(secret_scan_job(workflow))).toEqual([])
		expect(jobs.flatMap((job) => ci_yml_fixture.job_needs(job))).not.toContain(SECRET_SCAN_JOB)
	})

	it('checks out the merge commit with its base parent and without credentials', () => {
		const checkout = step_using(secret_scan_job(workflow), CHECKOUT_ACTION)

		expect(checkout?.with).toMatchObject({ 'fetch-depth': 2, 'persist-credentials': false })
	})

	it('installs secretlint from the cached pnpm store', () => {
		const setup = step_using(secret_scan_job(workflow), ci_yml_fixture.SETUP_PNPM_USES)

		expect(setup).toBeDefined()
		expect(setup?.with?.['cache']).toBeUndefined()
		expect(setup?.with?.['install']).toBeUndefined()
	})

	it('requires the scan through the josh wrapper under pipefail', () => {
		const scan = ci_yml_fixture.find_step_by_id(secret_scan_job(workflow), SCAN_STEP)

		expect(scan?.shell).toBe('bash')
		expect(scan?.env).toStrictEqual({ [REQUIRE_ENV]: '1' })
		expect(ci_yml_fixture.step_run(scan)).toContain('xargs -0 -r pnpm josh secretlint-scan')
	})
})

describe('the Secret Scan step script', () => {
	it('is the same in the runtime workflow and the template', () => {
		const scripts = WORKFLOWS.map((workflow) =>
			ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(secret_scan_job(workflow), SCAN_STEP)),
		)

		expect(scripts[0]).not.toBe('')
		expect(scripts[1]).toBe(scripts[0])
	})

	it('hands the wrapper only the files the pull request adds or changes', () => {
		commit_pull_request_merge()

		expect(run_scan_step()).toBe(0)
		expect(scanned_arguments()).toEqual(['josh', 'secretlint-scan', ADDED_FILE, KEPT_FILE])
	})

	// Without the base parent the diff fails; under pipefail that fails the step instead of an
	// empty file list passing it.
	it('fails when the base commit is not available', () => {
		expect(run_scan_step()).not.toBe(0)
		expect(scanned_arguments()).toEqual([])
	})
})
