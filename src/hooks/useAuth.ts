import { useDynamicContext } from '@dynamic-labs/sdk-react-core'

export function useAuth() {
  const { sdkHasLoaded, user, handleLogOut } = useDynamicContext()
  return {
    loading: !sdkHasLoaded,
    authenticated: !!user,
    signOutUser: handleLogOut,
  }
}
