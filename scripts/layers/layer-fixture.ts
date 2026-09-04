import { PROJECT_SCOPE, type LayerStep } from './layer-step'

// The known configuration the duplication list is asserted against (joshuafolkken/kit#1313).
//
// It is a small stand-in for this repository's own hooks and workflows rather than a copy of them:
// the point of the assertion is that a stated configuration produces a stated list, and a fixture
// that tracked the real files would only ever assert that today equals today.
//
// **The gate rows are written out here, not taken from `gate-plan.ts`.** They are part of the known
// input. The `pnpm josh gate` line inside the CI workflow below is the opposite case on purpose — it
// exercises the expansion through the gate's own declaration, which is what a reader of the real
// configuration depends on.

// Interpolated rather than written inline: lefthook's placeholder is spelled exactly like a
// template-literal one without the dollar, and eslint reads a literal `{staged_files}` in a
// template string as a mistyped interpolation.
const STAGED = '{staged_files}'

const HOOKS_YAML = `
pre-commit:
  parallel: true
  commands:
    cspell:
      run: pnpm exec cspell lint ${STAGED}
    eslint:
      run: pnpm exec eslint --quiet ${STAGED}
    type-check:
      run: pnpm exec tsc --noEmit
pre-push:
  setup:
    - run: pnpm install
  commands:
    test-unit:
      run: pnpm josh pre-push-unit
`

const PULL_REQUEST_WORKFLOW = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v7
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Run verification gate
        run: pnpm josh gate --verbose
`

// Never a layer: it runs after the merge, so nothing a pull request waits for repeats here.
const PUSH_ONLY_WORKFLOW = `
name: Publish
on:
  push:
    branches: [main]
jobs:
  publish:
    steps:
      - name: Run the suite again
        run: pnpm exec vitest run
`

const GATE_STEPS: ReadonlyArray<LayerStep> = [
	{ layer: 'gate', step: 'lint', command: 'pnpm josh lint', scope: PROJECT_SCOPE },
	{ layer: 'gate', step: 'check', command: 'pnpm josh check', scope: PROJECT_SCOPE },
	{ layer: 'gate', step: 'cspell', command: 'pnpm josh cspell:dot', scope: PROJECT_SCOPE },
	{ layer: 'gate', step: 'test:unit', command: 'pnpm josh test:unit', scope: PROJECT_SCOPE },
]

const layer_fixture = {
	GATE_STEPS,
	HOOKS_YAML,
	PULL_REQUEST_WORKFLOW,
	PUSH_ONLY_WORKFLOW,
}

export { layer_fixture }
