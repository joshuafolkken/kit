// The public surface a downstream distribution package imports to stamp the workflows it writes.
// Exported rather than left internal because the alternative is every distributor re-implementing
// the header, and a second implementation that spells the token differently or stacks a duplicate
// silently breaks the check that reads it (joshuafolkken/kit#844).
export { managed_marker_logic } from './managed-marker-logic'
