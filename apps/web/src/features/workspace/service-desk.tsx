import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "../../components/ui";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { useAuth } from "../auth/auth-gate";
import { rowAction } from "./actions";
import {
  AmcDialog,
  CloseDialog,
  ContractModal,
  DelayDialog,
  DeskEmpty,
  DeskHeader,
  DeskTable,
  DaysTag,
  Panel,
  ReminderTag,
  StatusPill,
  Td,
  Th,
  Tr,
  amcTone,
  mineContract,
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

export function ServiceDesk() {
  const { user } = useAuth();
  const selected = useSelectedDataset();
  const desk = useDesk(selected.id);
  const datasetId = desk.data?.datasetId || selected.id || "";
  const today = desk.data?.today ?? "";
  const [delay, setDelay] = useState<{ contract: DeskContract; pm: DeskPm } | null>(null);
  const [close, setClose] = useState<{ contract: DeskContract; pm: DeskPm } | null>(null);
  const [amc, setAmc] = useState<DeskContract | null>(null);
  const [open, setOpen] = useState<{ contract: DeskContract; pm?: DeskPm } | null>(null);
  const mine = (desk.data?.contracts ?? []).filter((item) => mineContract(item, user));
  const visits = mine.flatMap((contract) => openPms(contract).map((pm) => ({ contract, pm })));
  const amcRows = mine.filter((item) => item.amc.state);
  const inspectPm = open?.pm ?? null;

  async function acknowledge(contract: DeskContract, pm: DeskPm) {
    if (!datasetId) return;
    try {
      await rowAction(datasetId, contract.rowId, "/actions/pms", { action: "acknowledge", n: pm.n });
    } catch (error) {
      if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not acknowledge this visit."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Service Engineer" subtitle="Acknowledge, delay or close your PM visits. Closing needs a report and the customer OTP." />
      <label className="flex max-w-xs flex-col gap-1 text-sm text-ink-2">
        Signed in as
        <Input value={user.name} readOnly />
      </label>
      <DeskEmpty loading={desk.isPending} error={desk.isError} empty={false}>
        <Panel title="My PM visits">
          {visits.length === 0 ? <p className="text-sm text-ink-2">No open visits assigned to you.</p> : null}
          {visits.length > 0 ? (
            <DeskTable>
              <thead>
                <tr>
                  <Th>PM date</Th>
                  <Th>Machine</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Reminder</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visits.map(({ contract, pm }) => (
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
                    <Td>
                      <StatusPill value={pm.state} />
                      {pm.reason ? <div className="text-[13px] text-ink-2">{pm.reason}{pm.plan ? `, new date ${pm.plan}` : ""}</div> : null}
                    </Td>
                    <Td>
                      <ReminderTag item={pm.reminder} />
                    </Td>
                    <Td onClick={stopRow}>
                      <div className="flex flex-wrap gap-2">
                        {pm.state !== "Acknowledged" ? (
                          <Button size="sm" variant="secondary" onClick={() => void acknowledge(contract, pm)}>
                            Acknowledge
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => openModal(() => setDelay({ contract, pm }))}>
                          Delay
                        </Button>
                        <Button size="sm" onClick={() => openModal(() => setClose({ contract, pm }))}>
                          Close
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DeskTable>
          ) : null}
        </Panel>
        <Panel title="My AMC follow-ups">
          {amcRows.length === 0 ? <p className="text-sm text-ink-2">No AMC calls on your contracts.</p> : null}
          {amcRows.length > 0 ? (
            <DeskTable>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Machine</Th>
                  <Th>Contract ends</Th>
                  <Th>AMC follow-up</Th>
                  <Th>Reminder</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {amcRows.map((contract) => (
                  <Tr key={contract.rowId} onOpen={() => setOpen({ contract })}>
                    <Td accent={amcTone(contract)}>
                      <div className="font-medium text-ink">{contract.customer || "—"}</div>
                      <div className="text-[13px] text-ink-2">
                        {contract.contact}
                        {contract.mobile ? `, ${contract.mobile}` : ""}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-ink">{contract.equip || "—"}</div>
                      <div className="text-[13px] text-ink-2">
                        {contract.type}
                        {contract.eng ? `, ${contract.eng}` : ""}
                      </div>
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
          <DelayDialog open={delay != null} datasetId={datasetId} contract={delay?.contract ?? null} pm={delay?.pm ?? null} onClose={() => setDelay(null)} />
          <CloseDialog open={close != null} datasetId={datasetId} contract={close?.contract ?? null} pm={close?.pm ?? null} onClose={() => setClose(null)} />
          <AmcDialog open={amc != null} datasetId={datasetId} contract={amc} onClose={() => setAmc(null)} />
          <ContractModal open={open != null} contract={open?.contract ?? null} today={today} onClose={() => setOpen(null)}>
            {open && inspectPm && inspectPm.state !== "Acknowledged" ? (
              <Button size="sm" variant="secondary" onClick={() => void acknowledge(open.contract, inspectPm)}>
                Acknowledge
              </Button>
            ) : null}
            {open && inspectPm ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const visit = { contract: open.contract, pm: inspectPm };
                  setOpen(null);
                  openModal(() => setDelay(visit));
                }}
              >
                Delay
              </Button>
            ) : null}
            {open && inspectPm ? (
              <Button
                size="sm"
                onClick={() => {
                  const visit = { contract: open.contract, pm: inspectPm };
                  setOpen(null);
                  openModal(() => setClose(visit));
                }}
              >
                Close
              </Button>
            ) : null}
            {open && !inspectPm && open.contract.amc.state ? (
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
