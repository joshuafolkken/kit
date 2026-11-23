import { vi } from 'vitest'
import { run_chain_background } from './run-chain-background'

// Each half of `run:chain` runs as a background worker (joshuafolkken/kit#8705,
// joshuafolkken/kit#8761); a suite that reads the stages a call runs has the worker run them in place,
// in the call's own process, as the launched worker would. Shared so the opening and join suites agree
// on what the worker is handed. `run` is `run_chain_cli.run`, passed in because the CLI carries a main
// guard no imported module may (`main-guard-boundary.test.ts`).
function run_worker_in_place(run: (argv: ReadonlyArray<string>) => Promise<number>): void {
	vi.spyOn(run_chain_background, 'open').mockImplementation(
		async (_worker, argv) => await run([...argv, run_chain_background.WORKER_FLAG]),
	)
	vi.spyOn(run_chain_background, 'finish').mockReturnValue()
}

const run_chain_worker_fixture = { run_worker_in_place }

export { run_chain_worker_fixture }
