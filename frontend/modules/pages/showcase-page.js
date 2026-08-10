import { getCurrentOperator } from "../core/auth.js";
import { API_BASE_URL, parseApiError } from "../services/api.js";
import { escapeHtml } from "../utils/escape.js";

let activeDispose = null;
let mountVersion = 0;
let showcaseItems = [];

function sanitizeDetailHtml(value) {
  const raw = String(value || "");
  const purify = typeof window !== "undefined" ? window.DOMPurify : null;
  return purify && typeof purify.sanitize === "function"
    ? purify.sanitize(raw, {
        ALLOWED_TAGS: ["p", "div", "br", "b", "strong", "i", "em", "u", "h2", "h3", "ul", "ol", "li", "span", "font", "img"],
        ALLOWED_ATTR: ["style", "color", "face", "size", "src", "alt", "title", "width", "height"],
      })
    : escapeHtml(raw);
}

async function fetchShowcaseItems() {
  const response = await fetch(`${API_BASE_URL}/api/showcase`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (_) {
    throw new Error("展示接口未返回 JSON，请重启后端服务");
  }
  showcaseItems = Array.isArray(data.items) ? data.items : [];
  return showcaseItems;
}

export function ensureShowcaseTab(state) {
  const key = "stats:showcase";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "GaussDB大事件", closable: true });
  }
  return key;
}

export function renderShowcasePage({ canManage = false, canAdd = canManage } = {}) {
  const showManageActions = Boolean(canManage || canAdd);
  return `
    <section class="showcase-page" id="showcase-page" aria-label="GaussDB大事件">
      ${showManageActions ? '<button type="button" class="showcase-add-button" data-showcase-add>Add</button>' : ""}
      <canvas class="showcase-canvas" id="showcase-canvas" aria-label="可滚动的卡片轮播"></canvas>
      <h2 class="showcase-active-title" id="showcase-active-title" aria-live="polite"></h2>
      <div class="showcase-controls" aria-label="轮播控制">
        <button type="button" data-showcase-step="-1" aria-label="上一个项目">‹</button>
        <span id="showcase-counter">-- / --</span>
        <button type="button" data-showcase-step="1" aria-label="下一个项目">›</button>
      </div>
      <article class="showcase-detail-page" id="showcase-detail-page" hidden>
        <div class="showcase-detail-header">
          <button type="button" class="showcase-detail-back" data-showcase-back>← 返回展示</button>
          ${showManageActions ? '<button type="button" class="showcase-detail-delete" data-showcase-delete>Delete</button>' : ""}
        </div>
        <div class="showcase-detail-layout">
          <figure class="showcase-detail-media">
            <img id="showcase-detail-image" alt="">
          </figure>
          <div class="showcase-detail-content">
            <span class="showcase-detail-index" id="showcase-detail-index"></span>
            <h2 id="showcase-detail-title"></h2>
            <div class="showcase-detail-description" id="showcase-detail-description"></div>
          </div>
        </div>
      </article>
      <article class="showcase-editor-page" id="showcase-editor-page" hidden>
        <form class="showcase-editor-form" id="showcase-editor-form">
          <div class="showcase-editor-header">
            <button type="button" class="showcase-detail-back" data-showcase-editor-cancel>← 返回展示</button>
            <div class="showcase-editor-actions">
              <span class="showcase-editor-status" data-showcase-editor-status></span>
              <button type="submit" class="showcase-editor-save">保存</button>
            </div>
          </div>
          <div class="showcase-detail-layout showcase-editor-layout">
            <div class="showcase-editor-image-field">
              <input type="hidden" name="image_url" data-showcase-image-url>
              <input type="hidden" name="image_object_name" data-showcase-image-object>
              <label class="showcase-editor-image-upload">
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" data-showcase-image-input>
                <span data-showcase-image-placeholder>点击上传展示图片</span>
                <img data-showcase-image-preview alt="展示图片预览" hidden>
              </label>
            </div>
            <div class="showcase-editor-fields">
              <label for="showcase-editor-title">标题</label>
              <input id="showcase-editor-title" name="title" type="text" maxlength="160" placeholder="请输入标题" autocomplete="off">
              <label for="showcase-editor-content">正文</label>
              <div class="showcase-rich-editor">
                <div class="showcase-rich-toolbar" aria-label="正文编辑工具栏">
                  <button type="button" data-showcase-rich-cmd="bold"><b>B</b></button>
                  <button type="button" data-showcase-rich-cmd="italic"><i>I</i></button>
                  <button type="button" data-showcase-rich-cmd="underline"><u>U</u></button>
                  <button type="button" data-showcase-rich-cmd="insertUnorderedList">• List</button>
                  <button type="button" data-showcase-rich-cmd="insertOrderedList">1. List</button>
                  <label class="showcase-rich-image">图片<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" data-showcase-rich-image></label>
                </div>
                <div id="showcase-editor-content" class="showcase-rich-content" contenteditable="true" data-placeholder="请输入正文，可在正文中插入图片"></div>
              </div>
            </div>
          </div>
        </form>
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
  // 编辑入口不能依赖数据接口或 WebGL；任一初始化步骤失败时 Add 仍应可用。
  const editorDispose = bindShowcaseEditor(page, () => {
    const detail = page.querySelector("#showcase-detail-page");
    detail?.classList.remove("is-visible");
    page.classList.remove("is-showing-detail");
    if (detail) detail.hidden = true;
  });
  let itemsLoaded = false;
  try {
    const items = await fetchShowcaseItems();
    itemsLoaded = true;
    if (version !== mountVersion || !canvas.isConnected) {
      editorDispose?.();
      return null;
    }
    if (!items.length) {
      page.querySelector("#showcase-counter").textContent = "00 / 00";
      page.querySelector("#showcase-fallback").textContent = page.querySelector("[data-showcase-add]")
        ? "暂无展示内容，请点击 Add 添加。"
        : "暂无展示内容。";
      page.querySelector("#showcase-fallback")?.removeAttribute("hidden");
      return editorDispose;
    }
    const { createCarousel } = await import("../showcase-carousel/scene.js");
    if (version !== mountVersion || !canvas.isConnected) {
      editorDispose?.();
      return null;
    }

    const counter = page.querySelector("#showcase-counter");
    const activeTitle = page.querySelector("#showcase-active-title");
    const stepButtons = [...page.querySelectorAll("[data-showcase-step]")];
    const detail = page.querySelector("#showcase-detail-page");
    const backButton = page.querySelector("[data-showcase-back]");
    const detailImage = page.querySelector("#showcase-detail-image");
    const detailIndex = page.querySelector("#showcase-detail-index");
    const detailTitle = page.querySelector("#showcase-detail-title");
    const detailDescription = page.querySelector("#showcase-detail-description");
    const deleteButton = page.querySelector("[data-showcase-delete]");
    const totalLabel = String(items.length).padStart(2, "0");
    let detailItem = null;
    counter.textContent = `01 / ${totalLabel}`;

    const showDetail = (index) => {
      const item = items[index];
      if (!item) return;
      detailItem = item;
      detailImage.src = item.image_url;
      detailImage.alt = item.title;
      detailIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${totalLabel}`;
      detailTitle.textContent = item.title;
      detailDescription.innerHTML = sanitizeDetailHtml(item.detail_html);
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
    const onDelete = async () => {
      if (!detailItem || !deleteButton) return;
      if (!window.confirm(`确认删除“${detailItem.title}”吗？此操作不可恢复。`)) return;
      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting...";
      try {
        const operator = getCurrentOperator();
        const response = await fetch(
          `${API_BASE_URL}/api/showcase/${encodeURIComponent(detailItem.id)}?operator_id=${encodeURIComponent(operator.account)}`,
          { method: "DELETE" }
        );
        if (!response.ok) throw new Error(await parseApiError(response));
        window.location.reload();
      } catch (error) {
        window.alert(error?.message || "删除失败");
        deleteButton.disabled = false;
        deleteButton.textContent = "Delete";
      }
    };

    const carouselDispose = createCarousel(canvas, {
      images: items.map((item) => item.image_url),
      onActiveChange(index, isNearCenter) {
        counter.textContent = `${String(index + 1).padStart(2, "0")} / ${totalLabel}`;
        activeTitle.textContent = items[index]?.title || "";
        activeTitle.classList.toggle("is-visible", Boolean(isNearCenter));
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
    deleteButton?.addEventListener("click", onDelete);
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !detail.hidden) hideDetail();
    };
    page.addEventListener("keydown", onKeyDown);

    return () => {
      stepButtons.forEach((button) => button.removeEventListener("click", onStep));
      backButton.removeEventListener("click", hideDetail);
      deleteButton?.removeEventListener("click", onDelete);
      page.removeEventListener("keydown", onKeyDown);
      editorDispose?.();
      carouselDispose();
    };
  } catch (error) {
    const fallback = page.querySelector("#showcase-fallback");
    if (fallback) {
      fallback.textContent = itemsLoaded
        ? `当前浏览器无法启动 WebGL${page.querySelector("[data-showcase-add]") ? "，仍可点击 Add 添加展示内容" : ""}。`
        : `展示数据加载失败：${error?.message || "请检查后端服务和数据库迁移"}。${page.querySelector("[data-showcase-add]") ? "仍可点击 Add 添加内容。" : ""}`;
      fallback.removeAttribute("hidden");
    }
    console.error("GaussDB大事件初始化失败", error);
    return editorDispose;
  }
}

async function uploadShowcaseImage(file) {
  if (!file) throw new Error("请选择图片");
  if (file.size > 5 * 1024 * 1024) throw new Error("图片大小不能超过 5MB");
  const operator = getCurrentOperator();
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(
    `${API_BASE_URL}/api/richtext/upload-image?operator_id=${encodeURIComponent(operator.account)}`,
    { method: "POST", body: formData }
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const data = await response.json();
  if (!data.url) throw new Error("图片上传未返回地址");
  return { url: String(data.url), objectName: String(data.object_name || "") };
}

function bindShowcaseEditor(page, hideDetail) {
  const addButton = page.querySelector("[data-showcase-add]");
  const editor = page.querySelector("#showcase-editor-page");
  const form = page.querySelector("#showcase-editor-form");
  const cancelButton = page.querySelector("[data-showcase-editor-cancel]");
  const imageInput = page.querySelector("[data-showcase-image-input]");
  const imageUrl = page.querySelector("[data-showcase-image-url]");
  const imageObject = page.querySelector("[data-showcase-image-object]");
  const preview = page.querySelector("[data-showcase-image-preview]");
  const placeholder = page.querySelector("[data-showcase-image-placeholder]");
  const content = page.querySelector("#showcase-editor-content");
  const richImageInput = page.querySelector("[data-showcase-rich-image]");
  const status = page.querySelector("[data-showcase-editor-status]");
  const saveButton = page.querySelector(".showcase-editor-save");
  const fallback = page.querySelector("#showcase-fallback");
  if (!addButton || !editor || !form || !content) return null;

  const setStatus = (message, isError = false) => {
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  };
  const reset = () => {
    form.reset();
    content.innerHTML = "";
    imageUrl.value = "";
    imageObject.value = "";
    preview.src = "";
    preview.hidden = true;
    placeholder.hidden = false;
    setStatus("");
  };
  const open = () => {
    hideDetail?.();
    reset();
    if (fallback) {
      fallback.dataset.wasVisible = fallback.hidden ? "0" : "1";
      fallback.hidden = true;
    }
    editor.hidden = false;
    page.classList.add("is-editing");
    requestAnimationFrame(() => editor.classList.add("is-visible"));
    window.setTimeout(() => form.elements.title?.focus(), 80);
  };
  const close = () => {
    editor.classList.remove("is-visible");
    page.classList.remove("is-editing");
    window.setTimeout(() => {
      if (!editor.classList.contains("is-visible")) {
        editor.hidden = true;
        if (fallback?.dataset.wasVisible === "1") fallback.hidden = false;
      }
    }, 260);
  };
  const onCoverChange = async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    imageInput.disabled = true;
    setStatus("图片上传中...");
    try {
      const uploaded = await uploadShowcaseImage(file);
      imageUrl.value = uploaded.url;
      imageObject.value = uploaded.objectName;
      preview.src = uploaded.url;
      preview.hidden = false;
      placeholder.hidden = true;
      setStatus("图片已上传");
    } catch (error) {
      setStatus(error?.message || "图片上传失败", true);
    } finally {
      imageInput.disabled = false;
      imageInput.value = "";
    }
  };
  const insertBodyImage = async (file) => {
    try {
      setStatus("正文图片上传中...");
      const uploaded = await uploadShowcaseImage(file);
      content.focus();
      document.execCommand("insertImage", false, uploaded.url);
      setStatus("正文图片已上传");
    } catch (error) {
      setStatus(error?.message || "正文图片上传失败", true);
    }
  };
  const onRichImageChange = () => {
    const file = richImageInput.files?.[0];
    if (file) void insertBodyImage(file);
    richImageInput.value = "";
  };
  const onPaste = (event) => {
    const file = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void insertBodyImage(file);
  };
  const onToolbarClick = (event) => {
    const button = event.target.closest("[data-showcase-rich-cmd]");
    if (!button) return;
    event.preventDefault();
    content.focus();
    document.execCommand(button.dataset.showcaseRichCmd, false, null);
  };
  const onSubmit = async (event) => {
    event.preventDefault();
    const title = String(form.elements.title?.value || "").trim();
    const detailHtml = content.innerHTML.trim();
    if (!imageUrl.value) return setStatus("请先上传展示图片", true);
    if (!title) return setStatus("请填写标题", true);
    if (!content.textContent.trim() && !content.querySelector("img")) return setStatus("请填写正文", true);
    saveButton.disabled = true;
    setStatus("保存中...");
    try {
      const operator = getCurrentOperator();
      const response = await fetch(`${API_BASE_URL}/api/showcase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operator.account,
          title,
          detail_html: detailHtml,
          image_url: imageUrl.value,
          image_object_name: imageObject.value,
        }),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      setStatus("保存成功，正在刷新...");
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus(error?.message || "保存失败", true);
      saveButton.disabled = false;
    }
  };

  addButton.addEventListener("click", open);
  cancelButton.addEventListener("click", close);
  imageInput.addEventListener("change", onCoverChange);
  richImageInput.addEventListener("change", onRichImageChange);
  content.addEventListener("paste", onPaste);
  page.querySelector(".showcase-rich-toolbar")?.addEventListener("click", onToolbarClick);
  form.addEventListener("submit", onSubmit);
  return () => {
    addButton.removeEventListener("click", open);
    cancelButton.removeEventListener("click", close);
    imageInput.removeEventListener("change", onCoverChange);
    richImageInput.removeEventListener("change", onRichImageChange);
    content.removeEventListener("paste", onPaste);
    page.querySelector(".showcase-rich-toolbar")?.removeEventListener("click", onToolbarClick);
    form.removeEventListener("submit", onSubmit);
  };
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
