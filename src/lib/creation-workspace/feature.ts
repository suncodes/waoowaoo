export function isCreationWorkspaceV2Enabled(): boolean {
  // Studio is now the only supported product workspace. Keeping the helper
  // avoids churn at call sites while preventing users from falling back to
  // the retired glass-based workspace through an environment toggle.
  return true
}
