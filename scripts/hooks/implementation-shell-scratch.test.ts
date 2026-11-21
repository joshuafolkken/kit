import { describe, expect, it } from 'vitest'
import { implementation_shell } from './implementation-shell'

// joshuafolkken/kit#8262: a scratch script runs only through `josh scratch:run`, while a scratch path
// stays free as data for any program.
const SCRATCH = '.josh/tmp/scratch/x'
const SCRIPT = `${SCRATCH}/gen.mjs`
const DATA = `${SCRATCH}/data.txt`
const SCRATCH_RUN = 'scratch:run'

const LAUNCHERS = ['node', 'python3', 'python3.12', 'bash', 'source', '.', 'npx tsx', 'perl -w']

const REFUSED = [
	...LAUNCHERS.map((name) => `${name} ${SCRIPT}`),
	...LAUNCHERS.map((name) => `${name} ${DATA}`),
	`env FOO=1 node ${DATA}`,
	`node --import=x ${DATA}`,
	`python3 -X dev ${DATA}`,
	`bash -- ${DATA}`,
	`./${SCRIPT}`,
	`"$PWD/${DATA}"`,
	`\${PWD}/${DATA}`,
	`node --loader=${SCRIPT} a.mjs`,
	`node --require ${DATA} a.mjs`,
	`make -f ${DATA}`,
	`sed -f ${DATA} a.txt`,
	`awk -f ${DATA} a.txt`,
	`npx vite-node ${SCRIPT}`,
	`find . -exec ./${SCRIPT} {} ;`,
	`sh -c 'bash ${DATA}'`,
	`./${SCRIPT} scratch:run`,
]

const RUNS = [
	`pnpm josh scratch:run ${SCRIPT}`,
	`magick a.svg ${SCRATCH}/out.png`,
	`magick ${SCRATCH}/a.svg ${SCRATCH}/out.png`,
	`mkdir -p ${SCRATCH}`,
	`python3 -m json.tool ${SCRATCH}/data.json`,
	`cat ${SCRIPT}`,
	`ls ${SCRATCH}`,
	`printf x > ${SCRIPT}`,
	`printf x > "${SCRIPT}"`,
	`printf x | tee ${SCRATCH}/out.png`,
	'node scripts/build.ts',
]

describe('implementation_shell scratch scripts', () => {
	it.each(REFUSED)('refuses running a scratch script directly: %s', (command) => {
		expect(implementation_shell.refusal(command)).toContain(SCRATCH_RUN)
	})

	it.each(RUNS)('lets a scratch path through as data: %s', (command) => {
		expect(implementation_shell.refusal(command)).toBeUndefined()
	})
})
