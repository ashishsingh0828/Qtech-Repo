import { hasCapability } from "@app/shared";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, isUnauthenticated } from "../../lib/errors";
import { queryClient } from "../../lib/query";
import { useAuth } from "../auth/auth-gate";
import { downloadWorkbook } from "../records/download";
import { rememberDataset } from "../records/storage";
import {
  AddContractDialog,
  ContractModal,
  DeskEmpty,
  DeskHeader,
  DeskTable,
  Panel,
  Stats,
  StatusPill,
  Td,
  Th,
  Tr,
  ValidateDialog,
  openModal,
  showDate,
  stopRow,
  useDesk,
  validTone,
  type DeskContract,
} from "./desk-kit";
import { useSelectedDataset } from "./use-dataset";

export function AdminDesk() {
  const { user } = useAuth();
  const selected = useSelectedDataset();
  const desk = useDesk(selected.id);
  const datasetId = desk.data?.datasetId || selected.id || "";
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [validate, setValidate] = useState<DeskContract | null>(null);
  const [open, setOpen] = useState<DeskContract | null>(null);
  const contracts = desk.data?.contracts ?? [];
  const notValidated = contracts.filter((item) => item.valid !== "Yes").length;
  const scheduled = contracts.reduce((sum, item) => sum + item.pms.filter((pm) => pm.state !== "Closed").length, 0);

  return (
    <div className="flex flex-col gap-4">
      <DeskHeader title="Admin" subtitle="Upload or download the Excel sheet, add contracts and validate data." />
      <Stats
        items={[
          { value: contracts.length, label: "Contracts" },
          { value: notValidated, label: "Not validated", tone: "amber" },
          { value: scheduled, label: "PM visits scheduled" },
        ]}
      />
      <Panel>
        <div className="flex flex-wrap items-end gap-2">
          {hasCapability(user.role, "importData") ? (
            <Button disabled={uploading} onClick={() => document.getElementById("admin-excel-upload")?.click()}>
              {uploading ? <Spinner className="border-canvas border-t-transparent" /> : null}
              Upload Excel
            </Button>
          ) : null}
          {datasetId ? (
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                void downloadWorkbook(datasetId, "Engineer_Service_Data")
                  .then(() => toast.success("Workbook exported."))
                  .catch((error: unknown) => {
                    if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not export the workbook."));
                  })
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? <Spinner /> : null}
              Download Excel
            </Button>
          ) : null}
          {datasetId && hasCapability(user.role, "manageRows") ? (
            <Button variant="secondary" onClick={() => openModal(() => setAdding(true))}>
              Add contract
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={resetting}
            onClick={() => {
              setResetting(true);
              void api<{ id: string }>("/api/workspace/demo-reset", { method: "POST" })
                .then(async (result) => {
                  rememberDataset(user.id, result.id);
                  await queryClient.invalidateQueries({ queryKey: ["datasets"] });
                  await queryClient.invalidateQueries({ queryKey: ["desk"] });
                  toast.success("Demo data restored.");
                })
                .catch((error: unknown) => {
                  if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not reset demo data."));
                })
                .finally(() => setResetting(false));
            }}
          >
            {resetting ? <Spinner /> : null}
            Reset demo data
          </Button>
        </div>
        <p className="mt-3 text-[13px] text-ink-2">
          Upload reads the same columns as your data handling sheet, with PMS 1 to 15 as scheduled dates and PM Date as the date done. Download writes the same layout plus an Engineer column.
        </p>
        <input
          id="admin-excel-upload"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;
            if (!file.name.toLowerCase().endsWith(".xlsx")) {
              toast.error("Please save the file as .xlsx");
              return;
            }
            const body = new FormData();
            body.append("file", file);
            setUploading(true);
            void api<{ dataset: { id: string } }>("/api/datasets/import", { method: "POST", body })
              .then(async (result) => {
                rememberDataset(user.id, result.dataset.id);
                await queryClient.invalidateQueries({ queryKey: ["datasets"] });
                await queryClient.invalidateQueries({ queryKey: ["desk"] });
                toast.success("Workbook imported.");
              })
              .catch((error: unknown) => {
                if (!isUnauthenticated(error)) toast.error(errorText(error, "Could not import the workbook."));
              })
              .finally(() => setUploading(false));
          }}
        />
      </Panel>
      <DeskEmpty loading={desk.isPending} error={desk.isError} empty={contracts.length === 0}>
        <Panel title="Contracts and data validation">
          <DeskTable>
            <thead>
              <tr>
                <Th>Sr</Th>
                <Th>Customer</Th>
                <Th>Machine</Th>
                <Th>Contract</Th>
                <Th>PMs</Th>
                <Th>Validated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract, index) => (
                <Tr key={contract.rowId} onOpen={() => setOpen(contract)}>
                  <Td accent={validTone(contract)} className="tabular-nums text-ink-2">
                    {index + 1}
                  </Td>
                  <Td>
                    <div className="font-medium text-ink">{contract.customer || "—"}</div>
                    <div className="text-[13px] text-ink-2">{contract.city}</div>
                  </Td>
                  <Td>
                    <div className="font-medium text-ink">{contract.equip || "—"}</div>
                    <div className="text-[13px] text-ink-2">{contract.serial}</div>
                  </Td>
                  <Td>
                    <div>{contract.type || "—"}</div>
                    <div className="text-[13px] text-ink-2">
                      {contract.start || contract.end ? `${showDate(contract.start)} to ${showDate(contract.end)}` : "—"}
                    </div>
                  </Td>
                  <Td className="tabular-nums">{contract.pms.length}</Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <StatusPill value={contract.valid === "Yes" ? "Yes" : "No"} />
                      {contract.valid === "Yes" && contract.vby ? <span className="text-[12px] text-ink-2">by {contract.vby}</span> : null}
                      {contract.valid !== "Yes" && contract.vdue ? <span className="text-[12px] text-ink-2">due {showDate(contract.vdue)}</span> : null}
                    </div>
                  </Td>
                  <Td onClick={stopRow}>
                    <Button size="sm" variant="secondary" onClick={() => openModal(() => setValidate(contract))}>
                      Validate
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
          <ValidateDialog open={validate != null} datasetId={datasetId} contract={validate} onClose={() => setValidate(null)} />
          <AddContractDialog
            open={adding}
            datasetId={datasetId}
            engineers={desk.data?.engineers}
            onClose={() => setAdding(false)}
          />
          <ContractModal open={open != null} contract={open} today={desk.data?.today} onClose={() => setOpen(null)}>
            <Button
              size="sm"
              onClick={() => {
                const current = open;
                setOpen(null);
                if (current) openModal(() => setValidate(current));
              }}
            >
              Validate
            </Button>
          </ContractModal>
        </>
      ) : null}
    </div>
  );
}
