import { describe, it, expect, beforeEach } from "vitest";
import { DatalatheResultSet } from "../src/results/result-set.js";
import type { ReportResultEntry } from "../src/types.js";

describe("DatalatheResultSet", () => {
  let resultSet: DatalatheResultSet;

  beforeEach(() => {
    const result: ReportResultEntry = {
      idx: "0",
      error: null,
      schema: [
        { name: "id", data_type: "Int32" },
        { name: "name", data_type: "Utf8" },
        { name: "age", data_type: "Int32" },
        { name: "active", data_type: "Boolean" },
        { name: "score", data_type: "Float64" },
      ],
      result: [
        ["1", "John", "30", "true", "95.5"],
        ["2", "Jane", "25", "false", "88.0"],
        ["3", null, "35", "true", null],
      ],
    };

    resultSet = new DatalatheResultSet(result);
  });

  it("testNext", () => {
    expect(resultSet.next()).toBe(true);
    expect(resultSet.getInt(1)).toBe(1);
    expect(resultSet.getString(2)).toBe("John");

    expect(resultSet.next()).toBe(true);
    expect(resultSet.getInt(1)).toBe(2);
    expect(resultSet.getString(2)).toBe("Jane");

    expect(resultSet.next()).toBe(true);
    expect(resultSet.getInt(1)).toBe(3);
    expect(resultSet.getString(2)).toBeNull();

    expect(resultSet.next()).toBe(false);
  });

  it("testGetString", () => {
    resultSet.next();
    expect(resultSet.getString(2)).toBe("John");
    expect(resultSet.getString("name")).toBe("John");

    resultSet.next();
    expect(resultSet.getString(2)).toBe("Jane");
    expect(resultSet.getString("name")).toBe("Jane");

    resultSet.next();
    expect(resultSet.getString(2)).toBeNull();
    expect(resultSet.getString("name")).toBeNull();
  });

  it("testGetInt", () => {
    resultSet.next();
    expect(resultSet.getInt(1)).toBe(1);
    expect(resultSet.getInt("id")).toBe(1);
    expect(resultSet.getInt(3)).toBe(30);
    expect(resultSet.getInt("age")).toBe(30);
  });

  it("testGetBoolean", () => {
    resultSet.next();
    expect(resultSet.getBoolean(4)).toBe(true);
    expect(resultSet.getBoolean("active")).toBe(true);

    resultSet.next();
    expect(resultSet.getBoolean(4)).toBe(false);
    expect(resultSet.getBoolean("active")).toBe(false);
  });

  it("testGetDouble", () => {
    resultSet.next();
    expect(resultSet.getDouble(5)).toBeCloseTo(95.5, 3);
    expect(resultSet.getDouble("score")).toBeCloseTo(95.5, 3);
    expect(resultSet.wasNull()).toBe(false);

    resultSet.next();
    expect(resultSet.getDouble(5)).toBeCloseTo(88.0, 3);
    expect(resultSet.getDouble("score")).toBeCloseTo(88.0, 3);
    expect(resultSet.wasNull()).toBe(false);

    resultSet.next();
    expect(resultSet.getDouble(5)).toBeCloseTo(0.0, 3);
    expect(resultSet.getDouble("score")).toBeCloseTo(0.0, 3);
    expect(resultSet.wasNull()).toBe(true);
  });

  it("testWasNull", () => {
    resultSet.next();
    expect(resultSet.wasNull()).toBe(false);
    resultSet.getString(2);
    expect(resultSet.wasNull()).toBe(false);

    resultSet.next();
    expect(resultSet.wasNull()).toBe(false);
    resultSet.getString(2);
    expect(resultSet.wasNull()).toBe(false);

    resultSet.next();
    expect(resultSet.wasNull()).toBe(false);
    resultSet.getString(2);
    expect(resultSet.wasNull()).toBe(true);
  });

  it("testGetMetaData", () => {
    expect(resultSet.getColumnCount()).toBe(5);
    expect(resultSet.getColumnName(1)).toBe("id");
    expect(resultSet.getColumnName(2)).toBe("name");
    expect(resultSet.getColumnName(3)).toBe("age");
    expect(resultSet.getColumnName(4)).toBe("active");
    expect(resultSet.getColumnName(5)).toBe("score");

    expect(resultSet.getColumnType(1)).toBe("Int32");
    expect(resultSet.getColumnType(2)).toBe("Utf8");
    expect(resultSet.getColumnType(5)).toBe("Float64");
  });

  it("testNavigation", () => {
    expect(resultSet.isBeforeFirst()).toBe(true);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.isFirst()).toBe(true);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.isFirst()).toBe(false);
    expect(resultSet.isLast()).toBe(false);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.isLast()).toBe(true);

    expect(resultSet.next()).toBe(false);
    expect(resultSet.isAfterLast()).toBe(true);

    resultSet.beforeFirst();
    expect(resultSet.isBeforeFirst()).toBe(true);

    expect(resultSet.first()).toBe(true);
    expect(resultSet.getInt(1)).toBe(1);

    expect(resultSet.last()).toBe(true);
    expect(resultSet.getInt(1)).toBe(3);

    expect(resultSet.absolute(2)).toBe(true);
    expect(resultSet.getInt(1)).toBe(2);

    expect(resultSet.relative(-1)).toBe(true);
    expect(resultSet.getInt(1)).toBe(1);

    expect(resultSet.relative(1)).toBe(true);
    expect(resultSet.getInt(1)).toBe(2);

    expect(resultSet.previous()).toBe(true);
    expect(resultSet.getInt(1)).toBe(1);
  });

  it("testGetRow", () => {
    expect(resultSet.getRow()).toBe(0);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.getRow()).toBe(1);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.getRow()).toBe(2);

    expect(resultSet.next()).toBe(true);
    expect(resultSet.getRow()).toBe(3);
  });

  it("testFindColumn", () => {
    expect(resultSet.findColumn("id")).toBe(1);
    expect(resultSet.findColumn("name")).toBe(2);
    expect(resultSet.findColumn("age")).toBe(3);
    expect(resultSet.findColumn("active")).toBe(4);
    expect(resultSet.findColumn("score")).toBe(5);

    // Case-insensitive
    expect(resultSet.findColumn("ID")).toBe(1);
    expect(resultSet.findColumn("Name")).toBe(2);

    expect(() => resultSet.findColumn("nonexistent")).toThrow(
      "Column not found: nonexistent",
    );
  });

  it("testGetObject", () => {
    resultSet.next();

    expect(resultSet.getObject(1)).toBe(1);
    expect(resultSet.getObject(2)).toBe("John");
    expect(resultSet.getObject(3)).toBe(30);
    expect(resultSet.getObject(4)).toBe(true);
    expect(resultSet.getObject(5)).toBe(95.5);

    expect(resultSet.getObject("id")).toBe(1);
    expect(resultSet.getObject("name")).toBe("John");
    expect(resultSet.getObject("age")).toBe(30);
    expect(resultSet.getObject("active")).toBe(true);
    expect(resultSet.getObject("score")).toBe(95.5);
  });

  it("testEmptyResultSet", () => {
    const emptyResult: ReportResultEntry = {
      idx: "0",
      error: null,
      schema: [],
      result: [],
    };

    const emptyResultSet = new DatalatheResultSet(emptyResult);

    expect(emptyResultSet.next()).toBe(false);
    expect(emptyResultSet.isBeforeFirst()).toBe(false);
    expect(emptyResultSet.isFirst()).toBe(false);
    expect(emptyResultSet.isLast()).toBe(false);
    expect(emptyResultSet.isAfterLast()).toBe(false);

    expect(emptyResultSet.getColumnCount()).toBe(0);
  });

  it("testToArray", () => {
    const rows = resultSet.toArray();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      id: 1,
      name: "John",
      age: 30,
      active: true,
      score: 95.5,
    });
    expect(rows[1]).toEqual({
      id: 2,
      name: "Jane",
      age: 25,
      active: false,
      score: 88.0,
    });
    expect(rows[2]).toEqual({
      id: 3,
      name: null,
      age: 35,
      active: true,
      score: null,
    });
  });

  it("testIterator", () => {
    const rows = [...resultSet];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      id: 1,
      name: "John",
      age: 30,
      active: true,
      score: 95.5,
    });
  });

  it("testNullResultFallsBackToData", () => {
    const result: ReportResultEntry = {
      idx: "0",
      error: null,
      schema: [{ name: "id", data_type: "Int32" }],
      result: null,
      data: [["42"]],
    };

    const rs = new DatalatheResultSet(result);
    expect(rs.next()).toBe(true);
    expect(rs.getInt(1)).toBe(42);
  });
});
