import { createRequire } from "node:module";
import type { Cell, ValueType as ExcelValueType, Workbook as ExcelWorkbook, Worksheet } from "exceljs";

const require = createRequire(import.meta.url);

type ExcelJsModule = {
  Workbook: typeof ExcelWorkbook;
  ValueType: typeof ExcelValueType;
};

const exceljs = require("exceljs") as ExcelJsModule;

export const Workbook = exceljs.Workbook;
export type Workbook = ExcelWorkbook;
export const ValueType = exceljs.ValueType;
export type { Cell, Worksheet };
