import { run_stage } from '#scripts/run/run-stage'
import type { DecisionOracle } from './decision-oracle'

// The stage-ladder oracle, kept beside the enumeration rather than inside it
// because `decision-oracle.ts` sits at its file-size limit. Where a run on an issue starts — and whether
// the command typed has already been reached — is computed by `run:entry` from the issue and the tree's
// hold, so the skill's stage table points at the command rather than re-deciding it in prose. The
// vocabulary is `run_stage`'s own start tokens, never a second copy.
const RUN_ENTRY_ORACLE: DecisionOracle = {
	name: 'run:entry',
	decision:
		'Where a run on an issue starts, and whether the typed command has already been reached',
	args: '<N> [--to kickoff|halfrun|prrun|fullrun]',
	vocabulary: run_stage.START_TOKENS,
	single_source: 'docs/how-to/run-issues.md',
}

export { RUN_ENTRY_ORACLE }
