import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

export async function lockLiveRow(tx: Prisma.TransactionClient, datasetId: string, rowId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Row"
    WHERE id = ${rowId}::uuid AND "datasetId" = ${datasetId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError("NOT_FOUND", 404, "Row not found.");
}
