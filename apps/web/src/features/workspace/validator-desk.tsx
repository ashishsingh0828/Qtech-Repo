import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { rowAction } from "./actions";
import {
  DeskEmpty,
  DeskHeader,
  DeskTable,
  Panel,
  ReminderTag,
  Stats,
  StatusPill,
  Td,
  Th,
  monthLabel,
  openPms,
  showDate,
  useDesk,
  type DeskContract,
  type DeskPm,
} from "./desk-kit";
import { QuietEmpty } from "./parts";
import { useSelectedDataset } from "./use-dataset";

export function ValidatorDesk() {
  const selected = useSelectedDataset();
  const datasetId = selected.id;
  const desk = useDesk(datasetId);
  const visits = (desk.data?.contracts ?? []).flatMap((contract) => openPms(contract).map((pm) => ({ contract, pm })));
  const overdue = visits.filter(({ pm, contract }) => {
    void contract;
    return desk.data ? pm.date < desk.data.today : false;
  });
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
      {!selected.loading && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
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
                    <tr key={`${contract.rowId}:${pm.n}`}>
                      <Td className="tabular-nums">{showDate(pm.date)}</Td>
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
                      <Td>{contract.eng || "—"}</Td>
                      <Td>
                        <StatusPill value={pm.state} />
                      </Td>
                      <Td>
                        <ReminderTag item={pm.reminder} />
                      </Td>
                      <Td>
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
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            </Panel>
          ))}
        </DeskEmpty>
      ) : null}
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
