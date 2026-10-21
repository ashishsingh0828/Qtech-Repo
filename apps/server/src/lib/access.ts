import { Role } from "@prisma/client";
import { DEFAULT_ROLE_GROUP_ACCESS } from "@app/shared";
import { prisma } from "./prisma";

const ROLE_BY_NAME = {
  validator: Role.validator,
  service: Role.service,
} as const;

export async function ensureDefaultGroupAccess(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.roleGroupAccess.count();
    if (existing === 0) {
      await tx.roleGroupAccess.createMany({
        data: DEFAULT_ROLE_GROUP_ACCESS.map((entry) => ({
          role: ROLE_BY_NAME[entry.role],
          groupKey: entry.groupKey,
          canView: entry.canView,
          canEdit: entry.canEdit,
        })),
      });
    }
    await tx.roleGroupAccess.upsert({
      where: { role_groupKey: { role: Role.validator, groupKey: "schedule_services" } },
      create: { role: Role.validator, groupKey: "schedule_services", canView: true, canEdit: false },
      update: { canView: true, canEdit: false },
    });
  });
}
