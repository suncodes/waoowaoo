export function isCreationWorkspaceV2Enabled(): boolean {
  const value = process.env.NEXT_PUBLIC_CREATION_WORKSPACE_V2?.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}
