import { toast } from "sonner";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { rowAction } from "./actions";
import {
  ContractModal,
  DeskEmpty,
  DeskHeader,
  DeskTable,
  Panel,
  ReminderTag,
  Stats,
  StatusPill,
  Td,
  Th,
  Tr,
  monthLabel,
  openPms,
  pmTone,
  showDate,
  stopRow,
  useDesk,
  type DeskContract,
  type DeskPm,
} from "./desk-kit";
import { useSelectedDataset } from "./use-dataset";

export function ValidatorDesk() {
  const selected = useSelectedDataset();
  const desk = useDesk(selected.id);
  const datasetId = desk.data?.datasetId || selected.id || "";
  const today = desk.data?.today ?? "";
  const [open, setOpen] = useState<{ contract: DeskContract; pm: DeskPm } | null>(null);
  const visits = (desk.data?.contracts ?? []).flatMap((contract) => openPms(contract).map((pm) => ({ contract, pm })));
  const overdue = visits.filter(({ pm }) => (today ? pm.date < today : false));
  const unassigned = visits.filter(({ contract }) => !contract.eng);
  const months = groupByMonth(visits);

  async function assign(contract: DeskContract, engineerId: string) {
    if (!datasetId) return;
    const engineer = desk.data?.engineers.find((item) => item.id === engineerId);
    try {
      await rowAction(datasetId, contract.rowId, "/actions/assign", {
        serviceId: engineerId,
        engineer: engineer?.name,
      });
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not assign the engineer."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Service Coordinator" subtitle="Every open PM by month. Assign engineers and watch the reminder level." />
      <Stats
        items={[
          { value: visits.length, label: "Open PMs" },
          { value: overdue.length, label: "Overdue PMs", tone: "ruby" },
          { value: unassigned.length, label: "Not assigned", tone: "amber" },
        ]}
      />
      <DeskEmpty loading={desk.isPending} error={desk.isError} empty={visits.length === 0}>
        {months.map(([label, rows]) => (
          <Panel key={label} title={label}>
            <DeskTable>
              <thead>
                <tr>
                  <Th>PM date</Th>
                  <Th>Machine</Th>
                  <Th>Customer</Th>
                  <Th>Engineer</Th>
                  <Th>Status</Th>
                  <Th>Reminder</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ contract, pm }) => (
                  <Tr key={`${contract.rowId}:${pm.n}`} onOpen={() => setOpen({ contract, pm })}>
                    <Td accent={pmTone(pm, today)} className="tabular-nums">
                      {showDate(pm.date)}
                    </Td>
                    <Td>
                      <div className="font-medium text-ink">{contract.equip || "—"}</div>
                      <div className="text-[13px] text-ink-2">
                        {contract.serial}
                        {contract.pms.length ? `, PM ${pm.n} of ${contract.pms.length}` : ""}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-ink">{contract.customer || "—"}</div>
                      <div className="text-[13px] text-ink-2">{contract.city}</div>
                    </Td>
                    <Td>{contract.eng || "Unassigned"}</Td>
                    <Td>
                      <StatusPill value={pm.state} />
                    </Td>
                    <Td>
                      <ReminderTag item={pm.reminder} />
                    </Td>
                    <Td onClick={stopRow}>
                      <Select
                        value={desk.data?.engineers.find((item) => item.id === contract.serviceId || item.name === contract.eng)?.id}
                        onValueChange={(value) => void assign(contract, value)}
                      >
                        <SelectTrigger className="w-40" aria-label="Assign engineer">
                          <SelectValue placeholder="Assign" />
                        </SelectTrigger>
                        <SelectContent>
                          {(desk.data?.engineers ?? []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DeskTable>
          </Panel>
        ))}
      </DeskEmpty>
      <ContractModal open={open != null} contract={open?.contract ?? null} today={today} onClose={() => setOpen(null)} />
    </div>
  );
}

function groupByMonth(rows: Array<{ contract: DeskContract; pm: DeskPm }>): Array<[string, Array<{ contract: DeskContract; pm: DeskPm }>]> {
  const map = new Map<string, Array<{ contract: DeskContract; pm: DeskPm }>>();
  for (const row of rows) {
    const key = monthLabel(row.pm.date);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()];
}
