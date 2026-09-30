export type Tone = "emerald" | "amber" | "ruby" | "sapphire" | "stone";

export type KpiCard = {
  key: string;
  label: string;
  value: number;
  hint: string;
  href: string | null;
  target?: number;
};

export type WorkCardItem = {
  rowId: string;
  version: number;
  customer: string;
  equipment: string;
  serial: string;
  summary: string;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  contractType: string;
  pills: Array<{ label: string; tone: Tone }>;
  scheduled: string | null;
  pmsN: number | null;
  pmsLabel: string | null;
  bucket: "overdue" | "today" | "week" | "later" | null;
  validationDue: string | null;
  callId: string | null;
  callType: string | null;
  callDescription: string | null;
};

export type CardsPage = {
  total: number;
  items: WorkCardItem[];
  cities: string[];
  contracts: string[];
};

export const CALL_TYPES = ["Complaint", "Breakdown", "Emergency", "CourtesyVisit"] as const;
