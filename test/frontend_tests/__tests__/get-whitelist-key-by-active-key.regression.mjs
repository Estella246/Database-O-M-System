/**
 * 深链权限键映射回归：report:improvement / report:improvement-archive 必须映射到
 * improvement_report 白名单键（后端 8 个改进报告接口均按该键 403 鉴权，
 * 映射缺失会导致无权限用户深链直达改进报告页）。
 * 运行：node --experimental-vm-modules --test test/frontend_tests/__tests__/get-whitelist-key-by-active-key.regression.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/normalize.js")
).href;

test("report:generate 系列映射 monthly_report（既有行为不回归）", async () => {
  const { getWhitelistKeyByActiveKey } = await import(moduleUrl);
  assert.equal(getWhitelistKeyByActiveKey("report:issue"), "monthly_report");
  assert.equal(getWhitelistKeyByActiveKey("report:generate"), "monthly_report");
  assert.equal(getWhitelistKeyByActiveKey("report:archive"), "monthly_report");
});

test("report:improvement 系列映射 improvement_report", async () => {
  const { getWhitelistKeyByActiveKey } = await import(moduleUrl);
  assert.equal(getWhitelistKeyByActiveKey("report:improvement"), "improvement_report");
  assert.equal(getWhitelistKeyByActiveKey("report:improvement-archive"), "improvement_report");
});
