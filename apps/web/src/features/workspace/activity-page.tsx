import { formatDisplayDateTime } from "@app/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../auth/auth-gate";

type Feed = {
  total: number;
  items: Array<{
    id: string;
    actorName: string;
    action: string;
    summary: string;
    datasetId: string | null;
    datasetName: string | null;
    rowId: string | null;
    createdAt: string;
  }>;
  actors: Array<{ id: string; name: string }>;
  datasets: Array<{ id: string; name: string }>;
};

const ACTIONS = [
  "cell.updated",
  "action.validate",
  "action.verify",
  "action.amc",
  "action.pms",
  "action.followup",
  "action.assign",
  "call.logged",
  "call.resolved",
  "dataset.imported",
  "dataset.merged",
  "dataset.deleted",
  "dataset.restored",
  "row.created",
  "row.deleted",
  "row.restored",
];

export function ActivityPage() {
  const { timeZone } = useAuth();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["activity-feed", "audit", userId, action, datasetId, from, to],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50", offset: String(pageParam) });
      if (userId) params.set("userId", userId);
      if (action) params.set("action", action);
      if (datasetId) params.set("datasetId", datasetId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return api<Feed>(`/api/activity?${params}`);
    },
    getNextPageParam: (last, _pages, lastParam) => {
      if (last.items.length === 0) return undefined;
      const next = lastParam + last.items.length;
      return next < last.total ? next : undefined;
    },
  });
  const feed = query.data?.pages[0];
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity" subtitle="Every recorded change, newest first." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FilterSelect label="User" value={userId} onChange={setUserId} options={feed?.actors.map((actor) => ({ id: actor.id, label: actor.name })) ?? []} />
        <FilterSelect label="Action" value={action} onChange={setAction} options={ACTIONS.map((item) => ({ id: item, label: item }))} />
        <FilterSelect label="Dataset" value={datasetId} onChange={setDatasetId} options={feed?.datasets.map((dataset) => ({ id: dataset.id, label: dataset.name })) ?? []} />
        <div className="flex gap-2">
          <Input aria-label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input aria-label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border border-hairline bg-surface">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-2">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Dataset</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-t border-hairline hover:bg-surface-2"
                onClick={() => {
                  if (item.datasetId && item.rowId) void navigate(`/records/${item.datasetId}?row=${item.rowId}`);
                }}
              >
                <td className="px-4 py-3 text-ink-2">{formatDisplayDateTime(item.createdAt, timeZone || "UTC")}</td>
                <td className="px-4 py-3">{item.actorName}</td>
                <td className="px-4 py-3">{item.summary}</td>
                <td className="px-4 py-3 text-ink-2">{item.datasetName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || "all"} onValueChange={(next) => onChange(next === "all" ? "" : next)}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}s</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
