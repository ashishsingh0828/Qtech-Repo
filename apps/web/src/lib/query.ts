import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: retryQuery,
    },
    mutations: {
      retry: false,
    },
  },
});
