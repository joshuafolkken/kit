import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { core_weights } from '#scripts/gate/core-weights'
import { find_package_directory } from '#scripts/josh/package-directory'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'

// ESLint takes its heap from here in `josh lint`, `josh format` and the refactor scan: the cold
// `pnpm exec eslint`, direct launches and the eslint_d forwarder, whose launcher hands its
// environment on to the daemon. CI sets nothing of its own; its `josh gate` / `josh lint` arrive
// here too. The size is the core budget's (`core-weights.ts`), which reserves it for each lint.
const { ESLINT_HEAP_MIB } = core_weights

// Node reads the flag with `-` or `_` between words (`node --help`), and either spelling set by the
// person wins: their limit is a deliberate choice, this one only a floor for the default.
const HEAP_FLAG = /--max[-_]old[-_]space[-_]size\b/u
const NODE_OPTIONS = 'NODE_OPTIONS'
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_PATH = path.join(
	find_package_directory(MODULE_DIRECTORY),
	'scripts/lint/eslint-memory.js',
)
const MEMORY_IMPORT = `--import=${pathToFileURL(MEMORY_PATH).href}`

function with_heap(given_options: string | undefined): string {
	const current = given_options?.trim() ?? ''
	if (HEAP_FLAG.test(current)) return current
	const heap = `--max-old-space-size=${String(ESLINT_HEAP_MIB)}`

	return current === '' ? heap : `${current} ${heap}`
}

// The buffered child's environment, its other `NODE_OPTIONS` kept.
function environment(): NodeJS.ProcessEnv {
	const child = buffered_process.child_environment()

	return { ...child, [NODE_OPTIONS]: with_heap(child[NODE_OPTIONS]) }
}

// A `pnpm exec eslint` list as a buffered child under this heap, launched without pnpm.
async function run_cold(pnpm_arguments: ReadonlyArray<string>): Promise<BufferedProcessResult> {
	const child = environment()

	return await buffered_process.run_buffered_direct(pnpm_arguments, {
		environment: { ...child, [NODE_OPTIONS]: `${child[NODE_OPTIONS] ?? ''} ${MEMORY_IMPORT}` },
	})
}

const eslint_heap = { environment, run_cold, with_heap }

export { ESLINT_HEAP_MIB, eslint_heap }
