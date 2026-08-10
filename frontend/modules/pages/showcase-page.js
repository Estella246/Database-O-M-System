const PROJECTS = [
  "全域运行态势",
  "工单流转脉络",
  "风险感知中心",
  "容量趋势预测",
  "质量改进图谱",
  "值班能量网络",
  "智能分析引擎",
  "月度洞察报告",
  "变更发布追踪",
  "资源成本分析",
  "服务健康画像",
  "事故复盘档案",
];

let activeDispose = null;
let mountVersion = 0;

export function ensureShowcaseTab(state) {
  const key = "stats:showcase";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "展示效果", closable: true });
  }
  return key;
}

export function renderShowcasePage() {
  const labels = PROJECTS.map((project, index) => `
    <div class="showcase-project${index === 0 ? " is-active" : ""}" data-showcase-project="${index}">${project}</div>`).join("");

  return `
    <section class="showcase-page" id="showcase-page" aria-label="S形卡片展示效果">
      <canvas class="showcase-canvas" id="showcase-canvas" aria-label="可滚动的卡片轮播"></canvas>
      <nav class="showcase-projects" aria-label="展示项目">${labels}</nav>
      <div class="showcase-fallback" id="showcase-fallback" hidden>当前浏览器无法启动 WebGL。</div>
    </section>`;
}

export function disposeShowcasePage() {
  mountVersion += 1;
  activeDispose?.();
  activeDispose = null;
}

async function mountShowcase(page, canvas, version) {
  try {
    const { createCarousel } = await import("../showcase-carousel/scene.js");
    if (version !== mountVersion || !canvas.isConnected) return null;

    const labels = [...page.querySelectorAll("[data-showcase-project]")];
    return createCarousel(canvas, {
      onActiveChange(index) {
        labels.forEach((label, labelIndex) => {
          label.classList.toggle("is-active", labelIndex === index);
        });
      },
    });
  } catch (error) {
    page.querySelector("#showcase-fallback")?.removeAttribute("hidden");
    console.error("展示效果初始化失败", error);
    return null;
  }
}

export function bindShowcasePage() {
  disposeShowcasePage();
  const page = document.querySelector("#showcase-page");
  const canvas = document.querySelector("#showcase-canvas");
  if (!page || !canvas) return;

  const version = mountVersion;
  void mountShowcase(page, canvas, version).then((dispose) => {
    if (!dispose) return;
    if (version !== mountVersion || !page.isConnected) {
      dispose();
      return;
    }
    activeDispose = dispose;
  });
}
