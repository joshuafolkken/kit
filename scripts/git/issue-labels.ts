// The workflow label names, defined once. The epic auto-close, the epic validator, the issue-prep
// labeler and the next-issues display all key on these exact strings, and a drifted copy would
// fail silently — an epic filtered on the wrong name is simply never closed or never excluded.
const EPIC_LABEL = 'epic'
const IN_PROGRESS_LABEL = 'in-progress'
// Parks a child that cannot advance without a person deciding something. `epic:next` is what reads
// it: a parked child is why a run reports "nothing left that time will fix" rather than waiting
// forever (joshuafolkken/kit#860).
const NEEDS_DECISION_LABEL = 'needs-decision'

export { EPIC_LABEL, IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL }
