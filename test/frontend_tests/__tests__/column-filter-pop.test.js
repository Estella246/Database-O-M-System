import { positionColumnFilterPop } from "../../../frontend/modules/ui/column-filter-pop.js";

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
