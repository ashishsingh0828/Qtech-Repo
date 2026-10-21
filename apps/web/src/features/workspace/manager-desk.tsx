import { useState } from "react";
import { Button } from "../../components/ui";
import {
  AmcDialog,
  ContractModal,
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
  Tr,
  amcTone,
  openModal,
  openPms,
  pmTone,
  showDate,
  stopRow,
  useDesk,
  type DeskContract,
  type DeskPm,
} from "./desk-kit";
import { useSelectedDataset } from "./use-dataset";

export function ManagerDesk() {
  const selected = useSelectedDataset();
  const desk = useDesk(selected.id);
  const datasetId = desk.data?.datasetId || selected.id || "";
  const today = desk.data?.today ?? "";
  const [amc, setAmc] = useState<DeskContract | null>(null);
  const [open, setOpen] = useState<{ contract: DeskContract; pm?: DeskPm } | null>(null);
  const visits = (desk.data?.contracts ?? []).flatMap((contract) => openPms(contract).map((pm) => ({ contract, pm })));
  const overdue = visits.filter(({ pm }) => (today ? pm.date < today : false));
  const escalated = visits.filter(({ pm }) => pm.reminder && pm.reminder.lvl !== "");
  const amcRows = (desk.data?.contracts ?? []).filter((item) => item.amc.state);
  const notAccepted = amcRows.filter((item) => item.amc.state !== "Accepted").length;

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Service Manager" subtitle="PMs that reminders have escalated, and the AMC follow-up pipeline." />
      <Stats
        items={[
          { value: visits.length, label: "Open PMs" },
          { value: overdue.length, label: "Overdue PMs", tone: "ruby" },
          { value: escalated.length, label: "Escalated reminders", tone: "amber" },
          { value: notAccepted, label: "AMC not yet accepted", tone: "amber" },
        ]}
      />
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
                  <Tr key={`${contract.rowId}:${pm.n}`} onOpen={() => setOpen({ contract, pm })}>
                    <Td accent={pmTone(pm, today)} className="tabular-nums">
                      {showDate(pm.date)}
                    </Td>
                    <Td>
                      <div className="font-medium text-ink">{contract.equip || "—"}</div>
                      <div className="text-[13px] text-ink-2">{contract.serial}</div>
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
                  </Tr>
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
                  <Tr key={contract.rowId} onOpen={() => setOpen({ contract })}>
                    <Td accent={amcTone(contract)}>
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
                    <Td onClick={stopRow}>
                      <Button size="sm" variant="secondary" onClick={() => openModal(() => setAmc(contract))}>
                        Update
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DeskTable>
          ) : null}
        </Panel>
      </DeskEmpty>
      {desk.data ? (
        <>
          <AmcDialog open={amc != null} datasetId={datasetId} contract={amc} onClose={() => setAmc(null)} />
          <ContractModal open={open != null} contract={open?.contract ?? null} today={today} onClose={() => setOpen(null)}>
            {open && !open.pm ? (
              <Button
                size="sm"
                onClick={() => {
                  const current = open.contract;
                  setOpen(null);
                  openModal(() => setAmc(current));
                }}
              >
                Update AMC
              </Button>
            ) : null}
          </ContractModal>
        </>
      ) : null}
    </div>
  );
}
