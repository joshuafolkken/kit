import { readFileSync } from 'node:fs'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ci_yml_fixture } from './ci-yml-fixture'

// kit's own e2e job is skipped while kit ships no E2E specs, so a step calling a package script
// that does not exist stays latent until the first spec lands and the job fails to start
// (joshuafolkken/kit#6555). These guards read the job as written instead of waiting for that run.
const E2E_JOB = 'e2e'
const RUN_STEP_NAME = 'Run E2E tests'
const FIRST_ATTEMPT_ID = 'e2e_tests'
// pnpm's own commands, which name no package script. `pnpm build` and `pnpm josh` resolve to
// scripts and so must appear in package.json.
const PNPM_BUILTINS = new Set(['exec', 'install', 'dlx'])
const PNPM_CALL = /(?:^|[\s;&|])pnpm\s+([\w:-]+)/gu
const SCRIPTS_SCHEMA = z.looseObject({ scripts: z.record(z.string(), z.string()) })
const { RUNTIME_CI_YML, TEMPLATE_CI_YML, find_job, find_step_by_id, step_run } = ci_yml_fixture

const runtime_job = find_job(RUNTIME_CI_YML, E2E_JOB)
const manifest: unknown = JSON.parse(readFileSync(package_path('package.json'), 'utf8'))
const package_scripts = Object.keys(SCRIPTS_SCHEMA.parse(manifest).scripts)

function invoked_scripts(script: string): ReadonlyArray<string> {
	return [...script.matchAll(PNPM_CALL)]
		.map((match) => match[1] ?? '')
		.filter((name) => !PNPM_BUILTINS.has(name))
}

describe('ci.yml e2e entry point (.github/workflows/ci.yml)', () => {
	it('calls only package scripts that kit declares', () => {
		const calls = (runtime_job?.steps ?? []).flatMap((step) => invoked_scripts(step.run ?? ''))

		expect(calls.length).toBeGreaterThan(0)
		for (const name of calls) expect(package_scripts).toContain(name)
	})

	it('starts the suite with the same command as the distributed template', () => {
		const runtime_step = runtime_job?.steps?.find((step) => step.name === RUN_STEP_NAME)
		const template_step = find_step_by_id(find_job(TEMPLATE_CI_YML, E2E_JOB), FIRST_ATTEMPT_ID)

		expect(step_run(template_step)).not.toBe('')
		expect(step_run(runtime_step)).toBe(step_run(template_step))
	})
})
