import { randomUUID } from "node:crypto";
import type { ColumnType, DatasetSchema } from "@app/shared";
import { addCalendarDays, calendarDaysBetween, GROUP_TINTS, todayInTimeZone } from "@app/shared";
import type { Prisma } from "@prisma/client";
import { env } from "../../env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { syncMirrorFields } from "../datasets/mirrors";
import { applySystemColumns } from "../datasets/systemColumns";

export const DEMO_NAME = "ServiceDesk";

type SeedContract = {
  customer_name: string;
  city: string;
  contact_person: string;
  mobile: string;
  email: string;
  location: string;
  contract_type: string;
  equipment: string;
  serial: string;
  startOff: number;
  endOff: number;
  engineer: string;
  valid: string;
  vby: string;
  vdueOff?: number;
};

const SEED: SeedContract[] = [
  {
    customer_name: "Apex Labs",
    city: "Gurugram",
    contact_person: "Dr. Mehta",
    mobile: "9800000001",
    email: "lab@apex.example",
    location: "Cell Culture, 1st Floor",
    contract_type: "Warranty",
    equipment: "CO2 Incubator",
    serial: "CI-2210",
    startOff: -160,
    endOff: 570,
    engineer: "Ravi Kumar",
    valid: "Yes",
    vby: "Admin",
  },
  {
    customer_name: "City Hospital",
    city: "New Delhi",
    contact_person: "Ms. Rao",
    mobile: "9800000002",
    email: "bio@cityhosp.example",
    location: "Biochemistry",
    contract_type: "Paid AMC",
    equipment: "Centrifuge CF-50",
    serial: "CF50-1187",
    startOff: -330,
    endOff: 35,
    engineer: "Anil Sharma",
    valid: "Yes",
    vby: "Admin",
  },
  {
    customer_name: "BioGen Pharma",
    city: "Faridabad",
    contact_person: "Mr. Singh",
    mobile: "9800000003",
    email: "qa@biogen.example",
    location: "QC Lab",
    contract_type: "Extended CMC",
    equipment: "Spectrometer SP-9",
    serial: "SP9-0098",
    startOff: -100,
    endOff: 265,
    engineer: "Meena Iyer",
    valid: "No",
    vby: "",
    vdueOff: 5,
  },
  {
    customer_name: "Sunrise Clinic",
    city: "Noida",
    contact_person: "Dr. Kapoor",
    mobile: "9800000004",
    email: "admin@sunrise.example",
    location: "Pathology",
    contract_type: "CMC",
    equipment: "Incubator IN-80",
    serial: "IN80-2210",
    startOff: -740,
    endOff: -10,
    engineer: "Meena Iyer",
    valid: "Yes",
    vby: "Admin",
  },
];

export async function ensureDemoDataset(): Promise<{ id: string }> {
  const existing = await prisma.dataset.findFirst({
    where: { name: DEMO_NAME, deletedAt: null },
    select: { id: true, rowCount: true },
  });
  if (existing && existing.rowCount > 0) return { id: existing.id };
  return resetDemoDataset();
}

export async function resetDemoDataset(actor?: { id: string; name: string }): Promise<{ id: string }> {
  const admin =
    actor ??
    (await prisma.user.findFirst({
      where: { role: "admin", active: true },
      select: { id: true, name: true, email: true, role: true, active: true },
    }));
  if (!admin) throw new AppError("INTERNAL", 500, "Admin is missing.");
  const schema = applySystemColumns(demoSchema());
  const today = todayInTimeZone(env.APP_TIMEZONE);
  const engineers = await prisma.user.findMany({
    where: { active: true, role: "service" },
    select: { id: true, name: true },
  });
  const byName = new Map(engineers.map((item) => [item.name, item.id]));

  return prisma.$transaction(
    async (tx) => {
      let dataset = await tx.dataset.findFirst({ where: { name: DEMO_NAME, deletedAt: null } });
      if (!dataset) {
        dataset = await tx.dataset.create({
          data: {
            name: DEMO_NAME,
            sourceFileName: "demo.xlsx",
            schema: schema as unknown as Prisma.InputJsonValue,
            rowCount: 0,
            uploadedById: admin.id,
          },
        });
      } else {
        await tx.dataset.update({
          where: { id: dataset.id },
          data: { schema: schema as unknown as Prisma.InputJsonValue },
        });
        await tx.row.deleteMany({ where: { datasetId: dataset.id } });
      }

      for (const [index, seed] of SEED.entries()) {
        const start = addCalendarDays(today, seed.startOff);
        const end = addCalendarDays(today, seed.endOff);
        const data: Record<string, string> = {
          customer_name: seed.customer_name,
          city: seed.city,
          contact_person: seed.contact_person,
          mobile: seed.mobile,
          email: seed.email,
          location: seed.location,
          contract_type: seed.contract_type,
          equipment: seed.equipment,
          serial: seed.serial,
          start_date: start,
          end_date: end,
          engineer: seed.engineer,
          validated: seed.valid,
          validated_by: seed.vby,
        };
        if (seed.vdueOff != null) data.validation_due = addCalendarDays(today, seed.vdueOff);
        const visits = schedule(start, end);
        visits.forEach((date, offset) => {
          const n = offset + 1;
          data[`pms:${n}`] = date;
          if (date < addCalendarDays(today, -14)) data[`pm_date:${n}`] = date;
        });
        const synced = syncMirrorFields(data, schema);
        await tx.row.create({
          data: {
            datasetId: dataset.id,
            position: index + 1,
            data: synced.data as Prisma.InputJsonValue,
            validated: synced.validated,
            validationDue: synced.validationDue,
            verified: synced.verified,
            endDate: synced.endDate,
            amcStatus: synced.amcStatus,
            nextFollowUp: synced.nextFollowUp,
            nextDuePms: synced.nextDuePms,
            assignedServiceId: byName.get(seed.engineer) ?? null,
            updatedById: admin.id,
            updatedByName: admin.name,
          },
        });
      }

      await tx.dataset.update({ where: { id: dataset.id }, data: { rowCount: SEED.length } });
      return { id: dataset.id };
    },
    { timeout: 30_000 },
  );
}

function schedule(start: string, end: string): string[] {
  const count = Math.min(15, Math.max(1, Math.round(calendarDaysBetween(start, end) / 182.5)));
  return Array.from({ length: count }, (_, index) => addCalendarDays(start, 150 + 183 * index)).filter((date) => date <= end);
}

function demoSchema(): DatasetSchema {
  const groups = [
    group("customer_detail", "Customer detail", 0),
    group("instrument_details", "Instrument details", 1),
    group("data_validation", "Data validation", 2),
    group("schedule_services", "Schedule services", 3),
    group("amc", "AMC", 4),
  ];
  const byKey = Object.fromEntries(groups.map((item) => [item.groupKey, item.id]));
  const columns = [
    col(byKey.customer_detail, "customer_name", "Customer Name", "text", "customer_name", 0),
    col(byKey.customer_detail, "city", "City", "text", "city", 1),
    col(byKey.customer_detail, "contact_person", "Name", "text", "contact_person", 2),
    col(byKey.customer_detail, "mobile", "Mobile No", "phone", "mobile", 3),
    col(byKey.customer_detail, "email", "Mail", "email", "email", 4),
    col(byKey.customer_detail, "location", "Location", "text", "location", 5),
    col(byKey.instrument_details, "contract_type", "Contract Type", "category", "contract_type", 6),
    col(byKey.instrument_details, "equipment", "Euipment Name", "text", "equipment", 7),
    col(byKey.instrument_details, "serial", "Serial NO:", "text", "serial", 8),
    col(byKey.instrument_details, "start_date", "Start Date", "date", "start_date", 9),
    col(byKey.instrument_details, "end_date", "End Date", "date", "end_date", 10),
    col(byKey.instrument_details, "engineer", "Engineer", "text", "engineer", 11),
    col(byKey.data_validation, "validated", "Validated (Yes/No)", "yesno", "validated", 12, true),
    col(byKey.data_validation, "validated_by", "Validated by", "text", "validated_by", 13, true),
    col(byKey.data_validation, "validation_due", "By when Data will be validated", "date", "validation_due", 14, true),
  ];
  for (let n = 1; n <= 15; n += 1) {
    columns.push(col(byKey.schedule_services, `pms:${n}`, `PMS ${n}`, "date", `pms:${n}`, 20 + n * 2));
    columns.push(
      col(byKey.schedule_services, `pm_date:${n}`, n === 1 ? "PM Date" : `PM Date${n}`, "date", `pm_date:${n}`, 21 + n * 2),
    );
  }
  columns.push(col(byKey.amc, "cheque_date", "Cheque date", "date", "cheque_date", 60));
  columns.push(col(byKey.amc, "amc_document", "AMC document", "text", "amc_document", 61));
  return { version: 1, groups, columns };
}

function group(groupKey: string, label: string, order: number) {
  return {
    id: randomUUID(),
    label,
    groupKey,
    order,
    tint: GROUP_TINTS[order % GROUP_TINTS.length] ?? "#E8E4DD",
    deletedAt: null,
  };
}

function col(
  groupId: string,
  key: string,
  label: string,
  type: ColumnType,
  semantic: string,
  order: number,
  system = false,
) {
  return {
    key,
    label,
    originalLabel: label,
    autoNamed: false,
    groupId,
    order,
    type,
    semantic,
    system,
    width: 160,
    hidden: false,
    options: [] as string[],
    deletedAt: null,
  };
}
