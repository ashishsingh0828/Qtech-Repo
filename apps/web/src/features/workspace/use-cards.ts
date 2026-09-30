import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { CardsPage } from "./types";

export function useCards(
  datasetId: string | null,
  queue: string,
  filters: { mine?: boolean; city?: string; contract?: string; slot?: "validator" | "service" } = {},
) {
  const query = useInfiniteQuery({
    queryKey: ["workspace", datasetId, queue, filters.mine === true, filters.city ?? "", filters.contract ?? "", filters.slot ?? ""],
    enabled: Boolean(datasetId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        datasetId: datasetId ?? "",
        queue,
        limit: "20",
        offset: String(pageParam),
      });
      if (filters.mine) params.set("mine", "true");
      if (filters.city) params.set("city", filters.city);
      if (filters.contract) params.set("contract", filters.contract);
      if (filters.slot) params.set("slot", filters.slot);
      return api<CardsPage>(`/api/workspace/cards?${params}`);
    },
    getNextPageParam: (last, _pages, lastParam) => {
      if (last.items.length === 0) return undefined;
      const next = lastParam + last.items.length;
      return next < last.total ? next : undefined;
    },
  });
  const first = query.data?.pages[0];
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: first?.total ?? 0,
    cities: first?.cities ?? [],
    contracts: first?.contracts ?? [],
    loading: query.isPending,
    error: query.isError ? query.error : null,
    hasMore: query.hasNextPage === true,
    loadingMore: query.isFetchingNextPage,
    onLoadMore: () => {
      void query.fetchNextPage();
    },
  };
}
