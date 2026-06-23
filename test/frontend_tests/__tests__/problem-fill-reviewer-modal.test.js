const fs = require("fs");
const path = require("path");

const PERSON_ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_.-]+$/;

function parsePersonDisplay(raw) {
  const s = String(raw || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { name: "", account: "" };
  const parts = s.split(" ");
  if (parts.length >= 2) {
    const account = String(parts[parts.length - 1] || "").trim();
    if (PERSON_ACCOUNT_RE.test(account)) {
      const name = parts.slice(0, -1).join(" ").trim();
      return { name, account };
    }
  }
  if (PERSON_ACCOUNT_RE.test(s)) return { name: "", account: s };
  return { name: s, account: "" };
}

function formatPersonCopyText(person) {
  const name = String(person?.name || "").trim();
  const account = String(person?.account || "").trim();
  if (name && account) return `${name} ${account}`;
  return name || account;
}

const TICKET_PAGE = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const MODAL_PAGE = path.resolve(__dirname, "../../../frontend/modules/pages/problem-fill-reviewer-modal.js");
const PERSON_DISPLAY = path.resolve(__dirname, "../../../frontend/modules/utils/person-display.js");
const ticketPageSrc = fs.readFileSync(TICKET_PAGE, "utf8");
const modalPageSrc = fs.readFileSync(MODAL_PAGE, "utf8");
const personDisplaySrc = fs.readFileSync(PERSON_DISPLAY, "utf8");

describe("person display parse", () => {
  test("解析「姓名 工号」", () => {
    expect(parsePersonDisplay("李潇雨 l30030745")).toEqual({
      name: "李潇雨",
      account: "l30030745",
    });
  });

  test("仅工号", () => {
    expect(parsePersonDisplay("l30030745")).toEqual({
      name: "",
      account: "l30030745",
    });
  });

  test("仅姓名", () => {
    expect(parsePersonDisplay("李潇雨")).toEqual({
      name: "李潇雨",
      account: "",
    });
  });

  test("复制文本为「姓名 工号」", () => {
    expect(
      formatPersonCopyText({ name: "李潇雨", account: "l30030745" }),
    ).toBe("李潇雨 l30030745");
    expect(formatPersonCopyText({ name: "李潇雨", account: "" })).toBe("李潇雨");
    expect(formatPersonCopyText({ name: "", account: "l30030745" })).toBe("l30030745");
  });

  test("person-display.js 导出解析与复制函数", () => {
    expect(personDisplaySrc).toMatch(/export function parsePersonDisplay/);
    expect(personDisplaySrc).toMatch(/export function formatPersonCopyText/);
  });
});

describe("problem fill reviewer modal integration", () => {
  test("问题填写创建弹窗提交成功后打开审核人弹窗", () => {
    expect(ticketPageSrc).toMatch(/openProblemFillReviewerModal/);
    expect(ticketPageSrc).toMatch(/nodeKey === "problem_fill"/);
    expect(ticketPageSrc).toMatch(/saved\.values\?\.next_handler/);
  });

  test("弹窗展示姓名、工号与复制按钮", () => {
    expect(modalPageSrc).toMatch(/问题审核人/);
    expect(modalPageSrc).toMatch(/姓名/);
    expect(modalPageSrc).toMatch(/工号/);
    expect(modalPageSrc).toMatch(/copy-problem-fill-reviewer-btn/);
    expect(modalPageSrc).toMatch(/formatPersonCopyText/);
  });
});
