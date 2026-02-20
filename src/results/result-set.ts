import type { ReportResultEntry, SchemaField } from "../types.js";

export class DatalatheResultSet {
  private readonly data: (string | null)[][];
  private readonly schema: SchemaField[];
  private currentRow = -1;
  private _wasNull = false;

  constructor(result: ReportResultEntry) {
    this.data = result.result ?? result.data ?? [];
    this.schema = result.schema ?? [];
  }

  // --- Cursor Navigation ---

  next(): boolean {
    return ++this.currentRow < this.data.length;
  }

  previous(): boolean {
    if (this.currentRow <= 0) {
      return false;
    }
    this.currentRow--;
    return true;
  }

  first(): boolean {
    if (this.data.length === 0) {
      return false;
    }
    this.currentRow = 0;
    return true;
  }

  last(): boolean {
    if (this.data.length === 0) {
      return false;
    }
    this.currentRow = this.data.length - 1;
    return true;
  }

  beforeFirst(): void {
    this.currentRow = -1;
  }

  afterLast(): void {
    this.currentRow = this.data.length;
  }

  absolute(row: number): boolean {
    if (row < 0) {
      row = this.data.length + row + 1;
    }
    if (row < 1 || row > this.data.length) {
      this.currentRow = this.data.length;
      return false;
    }
    this.currentRow = row - 1;
    return true;
  }

  relative(rows: number): boolean {
    return this.absolute(this.currentRow + 1 + rows);
  }

  // --- Position Checks ---

  isBeforeFirst(): boolean {
    return this.data.length > 0 && this.currentRow === -1;
  }

  isAfterLast(): boolean {
    return this.data.length > 0 && this.currentRow >= this.data.length;
  }

  isFirst(): boolean {
    return this.data.length > 0 && this.currentRow === 0;
  }

  isLast(): boolean {
    return (
      this.data.length > 0 && this.currentRow === this.data.length - 1
    );
  }

  getRow(): number {
    if (this.currentRow < 0 || this.currentRow >= this.data.length) {
      return 0;
    }
    return this.currentRow + 1;
  }

  // --- Value Accessors (1-based column index) ---

  getString(column: number | string): string | null {
    const value = this.getValue(this.resolveColumn(column));
    this._wasNull = value === null;
    return value;
  }

  getInt(column: number | string): number {
    const value = this.getValue(this.resolveColumn(column));
    this._wasNull = value === null;
    return value === null ? 0 : parseInt(value, 10);
  }

  getFloat(column: number | string): number {
    const value = this.getValue(this.resolveColumn(column));
    this._wasNull = value === null;
    return value === null ? 0 : parseFloat(value);
  }

  getDouble(column: number | string): number {
    return this.getFloat(column);
  }

  getBoolean(column: number | string): boolean {
    const value = this.getValue(this.resolveColumn(column));
    this._wasNull = value === null;
    return value !== null && value.toLowerCase() === "true";
  }

  getObject(
    column: number | string,
  ): string | number | boolean | null {
    const columnIndex = this.resolveColumn(column);
    const value = this.getValue(columnIndex);
    this._wasNull = value === null;
    if (value === null) {
      return null;
    }

    const dataType = this.schema[columnIndex - 1].data_type;
    switch (dataType) {
      case "Int32":
      case "Int64":
        return parseInt(value, 10);
      case "Float32":
      case "Float64":
        return parseFloat(value);
      case "Boolean":
        return value.toLowerCase() === "true";
      default:
        return value;
    }
  }

  wasNull(): boolean {
    return this._wasNull;
  }

  // --- Column Lookup ---

  findColumn(columnLabel: string): number {
    const idx = this.schema.findIndex(
      (s) => s.name.toLowerCase() === columnLabel.toLowerCase(),
    );
    if (idx === -1) {
      throw new Error(`Column not found: ${columnLabel}`);
    }
    return idx + 1;
  }

  // --- Metadata ---

  getColumnCount(): number {
    return this.schema.length;
  }

  getColumnName(columnIndex: number): string {
    return this.schema[columnIndex - 1].name;
  }

  getColumnType(columnIndex: number): string {
    return this.schema[columnIndex - 1].data_type;
  }

  getSchema(): SchemaField[] {
    return [...this.schema];
  }

  // --- JS-idiomatic extras ---

  get rowCount(): number {
    return this.data.length;
  }

  toArray(): Record<string, string | number | boolean | null>[] {
    const saved = this.currentRow;
    const rows: Record<string, string | number | boolean | null>[] = [];
    this.beforeFirst();
    while (this.next()) {
      const row: Record<string, string | number | boolean | null> = {};
      for (let i = 1; i <= this.schema.length; i++) {
        row[this.schema[i - 1].name] = this.getObject(i);
      }
      rows.push(row);
    }
    this.currentRow = saved;
    return rows;
  }

  [Symbol.iterator](): Iterator<
    Record<string, string | number | boolean | null>
  > {
    this.beforeFirst();
    return {
      next: (): IteratorResult<
        Record<string, string | number | boolean | null>
      > => {
        if (this.next()) {
          const row: Record<string, string | number | boolean | null> =
            {};
          for (let i = 1; i <= this.schema.length; i++) {
            row[this.schema[i - 1].name] = this.getObject(i);
          }
          return { value: row, done: false };
        }
        return { value: undefined as never, done: true };
      },
    };
  }

  // --- Private ---

  private resolveColumn(column: number | string): number {
    return typeof column === "string" ? this.findColumn(column) : column;
  }

  private getValue(columnIndex: number): string | null {
    if (this.currentRow < 0 || this.currentRow >= this.data.length) {
      throw new Error("No current row");
    }
    if (columnIndex < 1 || columnIndex > this.schema.length) {
      throw new Error(`Invalid column index: ${columnIndex}`);
    }
    return this.data[this.currentRow][columnIndex - 1];
  }
}
