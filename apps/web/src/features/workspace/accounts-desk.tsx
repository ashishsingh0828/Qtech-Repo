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
  showDate,
  stopRow,
  useDesk,
  type DeskContract,
} from "./desk-kit";
import { useSelectedDataset } from "./use-dataset";

export function AccountsDesk() {
  const selected = useSelectedDataset();
  const desk = useDesk(selected.id);
  const datasetId = desk.data?.datasetId || selected.id || "";
  const [amc, setAmc] = useState<DeskContract | null>(null);
  const [open, setOpen] = useState<DeskContract | null>(null);
  const rows = (desk.data?.contracts ?? []).filter((item) => item.amc.state || (item.end && (item.daysLeft ?? 99) <= 45));
  const accepted = rows.filter((item) => item.amc.state === "Accepted").length;
  const cheque = rows.filter((item) => item.amc.state === "Delayed").length;
  const refused = rows.filter((item) => item.amc.state === "Refusal").length;
  const pending = rows.filter((item) => item.amc.state !== "Accepted" && item.amc.state !== "Refusal").length;

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Accounts" subtitle="Follow AMC outcomes, cheque dates and accepted contracts." />
      <Stats
        items={[
          { value: accepted, label: "AMC accepted" },
          { value: cheque, label: "Awaiting cheque", tone: "amber" },
          { value: refused, label: "Refused", tone: "ruby" },
          { value: pending, label: "Pending" },
        ]}
      />
      <DeskEmpty loading={desk.isPending} error={desk.isError} empty={rows.length === 0}>
        <Panel title="AMC and cheques">
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
              {rows.map((contract) => (
                <Tr key={contract.rowId} onOpen={() => setOpen(contract)}>
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
                    {contract.amc.reason ? (
                      <div className="text-[13px] text-ink-2">
                        {contract.amc.reason}
                        {contract.amc.remark ? `: ${contract.amc.remark}` : ""}
                      </div>
                    ) : null}
                    {contract.amc.date ? <div className="text-[13px] text-ink-2">Cheque date {contract.amc.date}</div> : null}
                    {contract.amc.doc ? <div className="text-[13px] text-ink-2">Attached: {contract.amc.doc}</div> : null}
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
        </Panel>
      </DeskEmpty>
      {desk.data ? (
        <>
          <AmcDialog open={amc != null} datasetId={datasetId} contract={amc} onClose={() => setAmc(null)} />
          <ContractModal open={open != null} contract={open} today={desk.data?.today} onClose={() => setOpen(null)}>
            <Button
              size="sm"
              onClick={() => {
                const current = open;
                setOpen(null);
                if (current) openModal(() => setAmc(current));
              }}
            >
              Update AMC
            </Button>
          </ContractModal>
        </>
      ) : null}
    </div>
  );
}
