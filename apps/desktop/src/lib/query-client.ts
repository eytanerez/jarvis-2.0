import { QueryClient } from '@tanstack/react-query'

// Shared React Query client. Lives in its own module (not main.tsx) so non-React
// code — e.g. the profile store on a gateway swap — can invalidate cached,
// profile-scoped settings without importing the app entry point.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000
    }
  }
})
