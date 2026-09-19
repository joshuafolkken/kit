// Isolation requirements — a test that meets any of the following conditions must NOT appear in
// this list and must run with the default isolate:true setting in vitest.config.ts:
//   1. Module mocks: vi.mock / vi.spyOn / vi.stubEnv / vi.resetModules / vi.unstubAllEnvs
//   2. Environment variable writes: process.env.X = ... or delete process.env.X
//   3. Subprocess calls: execSync / spawnSync / spawn / exec / child_process.*
//   4. Filesystem writes: writeFileSync / mkdirSync / mkdtemp / rmSync / unlinkSync / rimraf
//   5. Git operations: any command that could change branch, commits, or working tree

const PILOT_FILES: ReadonlyArray<string> = [
	'scripts/ci/ci-yml-build-order.test.ts',
	'scripts/ci/ci-yml-unit-step.test.ts',
	'scripts/cost-runtime/cost-cli-registration.test.ts',
	'scripts/init/init-logic-development-engines.test.ts',
	'scripts/init/init-paths.test.ts',
	'scripts/josh/josh-environment-file.test.ts',
	'scripts/time-runtime/time-format.test.ts',
	'scripts/time-runtime/time-instant.test.ts',
	'scripts/version/kit-descriptor.test.ts',
	'scripts/version/parse-json.test.ts',
]

export { PILOT_FILES }
