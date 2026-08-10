import { SHOWCASE_ITEMS } from "../showcase-carousel/content.js";

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
  return `
    <section class="showcase-page" id="showcase-page" aria-label="S形卡片展示效果">
      <canvas class="showcase-canvas" id="showcase-canvas" aria-label="可滚动的卡片轮播"></canvas>
      <div class="showcase-controls" aria-label="轮播控制">
        <button type="button" data-showcase-step="-1" aria-label="上一个项目">‹</button>
        <span id="showcase-counter">01 / ${String(SHOWCASE_ITEMS.length).padStart(2, "0")}</span>
        <button type="button" data-showcase-step="1" aria-label="下一个项目">›</button>
      </div>
      <article class="showcase-detail-page" id="showcase-detail-page" hidden>
        <button type="button" class="showcase-detail-back" data-showcase-back>← 返回展示</button>
        <div class="showcase-detail-layout">
          <figure class="showcase-detail-media">
            <img id="showcase-detail-image" alt="">
          </figure>
          <div class="showcase-detail-content">
            <span class="showcase-detail-index" id="showcase-detail-index"></span>
            <h2 id="showcase-detail-title"></h2>
            <p id="showcase-detail-description"></p>
          </div>
        </div>
      </article>
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

    const counter = page.querySelector("#showcase-counter");
    const stepButtons = [...page.querySelectorAll("[data-showcase-step]")];
    const detail = page.querySelector("#showcase-detail-page");
    const backButton = page.querySelector("[data-showcase-back]");
    const detailImage = page.querySelector("#showcase-detail-image");
    const detailIndex = page.querySelector("#showcase-detail-index");
    const detailTitle = page.querySelector("#showcase-detail-title");
    const detailDescription = page.querySelector("#showcase-detail-description");

    const showDetail = (index) => {
      const item = SHOWCASE_ITEMS[index];
      if (!item) return;
      detailImage.src = item.image;
      detailImage.alt = item.title;
      detailIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${String(SHOWCASE_ITEMS.length).padStart(2, "0")}`;
      detailTitle.textContent = item.title;
      detailDescription.textContent = item.description;
      detail.hidden = false;
      page.classList.add("is-showing-detail");
      requestAnimationFrame(() => detail.classList.add("is-visible"));
    };
    const hideDetail = () => {
      detail.classList.remove("is-visible");
      page.classList.remove("is-showing-detail");
      window.setTimeout(() => {
        if (!detail.classList.contains("is-visible")) detail.hidden = true;
      }, 320);
    };

    const carouselDispose = createCarousel(canvas, {
      onActiveChange(index) {
        counter.textContent = `${String(index + 1).padStart(2, "0")} / ${String(SHOWCASE_ITEMS.length).padStart(2, "0")}`;
      },
      onCardSelect: showDetail,
    });
    const onStep = (event) => {
      canvas.dispatchEvent(new CustomEvent("showcase:step", {
        detail: Number(event.currentTarget.dataset.showcaseStep) || 0,
      }));
    };
    stepButtons.forEach((button) => button.addEventListener("click", onStep));
    backButton.addEventListener("click", hideDetail);
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !detail.hidden) hideDetail();
    };
    page.addEventListener("keydown", onKeyDown);

    return () => {
      stepButtons.forEach((button) => button.removeEventListener("click", onStep));
      backButton.removeEventListener("click", hideDetail);
      page.removeEventListener("keydown", onKeyDown);
      carouselDispose();
    };
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
