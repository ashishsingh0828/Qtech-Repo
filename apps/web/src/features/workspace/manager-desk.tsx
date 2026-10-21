import { useState } from "react";
import { Button } from "../../components/ui";
import {
  AmcDialog,
  DeskEmpty,
  DeskHeader,
  DeskTable,
  DaysTag,
  Panel,
  ReminderTag,
  Stats,
  StatusPill,
  Td,
  Th,
  openPms,
  showDate,
  useDesk,
  type DeskContract,
} from "./desk-kit";
import { QuietEmpty } from "./parts";
import { useSelectedDataset } from "./use-dataset";

export function ManagerDesk() {
  const selected = useSelectedDataset();
  const datasetId = selected.id;
  const desk = useDesk(datasetId);
  const [amc, setAmc] = useState<DeskContract | null>(null);
  const visits = (desk.data?.contracts ?? []).flatMap((contract) => openPms(contract).map((pm) => ({ contract, pm })));
  const escalated = visits.filter(({ pm }) => pm.reminder && pm.reminder.lvl !== "");
  const amcRows = (desk.data?.contracts ?? []).filter((item) => item.amc.state);
  const openPmsCount = visits.length;
  const notAccepted = amcRows.filter((item) => item.amc.state !== "Accepted").length;

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Service Manager" subtitle="PMs that reminders have escalated, and the AMC follow-up pipeline." />
      <Stats
        items={[
          { value: openPmsCount, label: "Open PMs" },
          { value: escalated.length, label: "Escalated reminders", tone: "ruby" },
          { value: notAccepted, label: "AMC not yet accepted", tone: "amber" },
        ]}
      />
      {!selected.loading && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
        <DeskEmpty loading={desk.isPending} error={desk.isError} empty={false}>
          <Panel title="PMs escalated beyond the engineer">
            {escalated.length === 0 ? <p className="text-sm text-ink-2">No escalated PMs.</p> : null}
            {escalated.length > 0 ? (
              <DeskTable>
                <thead>
                  <tr>
                    <Th>PM date</Th>
                    <Th>Machine</Th>
                    <Th>Customer</Th>
                    <Th>Engineer</Th>
                    <Th>Status</Th>
                    <Th>Reminder</Th>
                  </tr>
                </thead>
                <tbody>
                  {escalated.map(({ contract, pm }) => (
                    <tr key={`${contract.rowId}:${pm.n}`}>
                      <Td className="tabular-nums">{showDate(pm.date)}</Td>
                      <Td>
                        <div className="font-medium text-ink">{contract.equip || "—"}</div>
                        <div className="text-[13px] text-ink-2">{contract.serial}</div>
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
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            ) : null}
          </Panel>
          <Panel title="AMC follow-up">
            {amcRows.length === 0 ? <p className="text-sm text-ink-2">No AMC follow-ups in the 45-day window.</p> : null}
            {amcRows.length > 0 ? (
              <DeskTable>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Machine</Th>
                    <Th>Contract ends</Th>
                    <Th>Status</Th>
                    <Th>Reminder</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {amcRows.map((contract) => (
                    <tr key={contract.rowId}>
                      <Td>
                        <div className="font-medium text-ink">{contract.customer || "—"}</div>
                        <div className="text-[13px] text-ink-2">{contract.mobile}</div>
                      </Td>
                      <Td>
                        <div className="font-medium text-ink">{contract.equip || "—"}</div>
                        <div className="text-[13px] text-ink-2">{contract.type}</div>
                      </Td>
                      <Td>
                        <div>{showDate(contract.end)}</div>
                        <DaysTag days={contract.daysLeft} />
                      </Td>
                      <Td>
                        <StatusPill value={contract.amc.state || "Pending"} />
                      </Td>
                      <Td>
                        <ReminderTag item={contract.amc.reminder} />
                      </Td>
                      <Td>
                        <Button size="sm" variant="secondary" onClick={() => setAmc(contract)}>
                          Update
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            ) : null}
          </Panel>
        </DeskEmpty>
      ) : null}
      {datasetId ? <AmcDialog open={amc != null} datasetId={datasetId} contract={amc} onClose={() => setAmc(null)} /> : null}
    </div>
  );
}
