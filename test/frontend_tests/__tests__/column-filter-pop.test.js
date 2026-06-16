import {
  bindColumnFilterSearchInput,
  flushColumnFilterSearchApply,
  positionColumnFilterPop,
  scheduleColumnFilterSearchApply,
} from "../../../frontend/modules/ui/column-filter-pop.js";

describe("positionColumnFilterPop", () => {
  beforeEach(() => {
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    window.requestAnimationFrame.mockRestore();
  });

  test("aligns pop below anchor with right inset", () => {
    const pop = document.createElement("div");
    document.body.appendChild(pop);
    const anchor = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 130,
        left: 200,
        right: 320,
        width: 120,
        height: 30,
      }),
    };

    positionColumnFilterPop(pop, anchor);

    expect(pop.style.position).toBe("fixed");
    expect(pop.style.left).toBe("94px");
    expect(pop.style.top).toBe("134px");
    expect(pop.style.width).toBe("220px");
    expect(pop.style.zIndex).toBe("10060");

    pop.remove();
  });
});

describe("bindColumnFilterSearchInput", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("debounces apply until typing pauses", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const onValue = jest.fn();
    const onApply = jest.fn();
    bindColumnFilterSearchInput(input, onValue, onApply);

    input.value = "a";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onValue).toHaveBeenCalledWith("a");
    expect(onApply).not.toHaveBeenCalled();

    jest.advanceTimersByTime(399);
    expect(onApply).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onApply).toHaveBeenCalledTimes(1);

    input.remove();
  });

  test("Enter flushes pending apply immediately", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const onValue = jest.fn();
    const onApply = jest.fn();
    bindColumnFilterSearchInput(input, onValue, onApply);

    input.value = "ab";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onApply).toHaveBeenCalledTimes(1);
    input.remove();
  });

  test("schedule and flush helpers share one debounce timer", () => {
    const apply = jest.fn();
    scheduleColumnFilterSearchApply(apply);
    jest.advanceTimersByTime(200);
    flushColumnFilterSearchApply(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(400);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
