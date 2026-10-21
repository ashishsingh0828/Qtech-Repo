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
  showDate,
  useDesk,
  type DeskContract,
} from "./desk-kit";
import { QuietEmpty } from "./parts";
import { useSelectedDataset } from "./use-dataset";

export function AccountsDesk() {
  const selected = useSelectedDataset();
  const datasetId = selected.id;
  const desk = useDesk(datasetId);
  const [amc, setAmc] = useState<DeskContract | null>(null);
  const rows = (desk.data?.contracts ?? []).filter((item) => item.amc.state || (item.end && (item.daysLeft ?? 99) <= 45));
  const accepted = rows.filter((item) => item.amc.state === "Accepted").length;
  const cheque = rows.filter((item) => item.amc.state === "Accepted" && !item.amc.date).length;
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
      {!selected.loading && !datasetId ? <QuietEmpty /> : null}
      {datasetId ? (
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
                  <tr key={contract.rowId}>
                    <Td>
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
                    <Td>
                      <Button size="sm" variant="secondary" onClick={() => setAmc(contract)}>
                        Update
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DeskTable>
          </Panel>
        </DeskEmpty>
      ) : null}
      {datasetId ? <AmcDialog open={amc != null} datasetId={datasetId} contract={amc} onClose={() => setAmc(null)} /> : null}
    </div>
  );
}
