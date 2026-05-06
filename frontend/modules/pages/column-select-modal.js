import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import {
  buildColumnGroups,
  getDefaultSelectedColumns,
  loadColumnConfigFromStorage,
  saveColumnConfigToStorage,
  validateColumnKeys,
  countSelectedInGroup,
  getGroupTotalCount,
  getAllSelectableColumnKeys,
  MAX_COLUMN_COUNT,
} from "../constants/column-fields.js";

/**
 * 渲染列选择弹窗 HTML
 * @param {string} namespace "list" 或 "home"
 * @returns {string} 弹窗 HTML 字符串
 */
export function renderColumnSelectModalHtml(namespace) {
  if (!state.columnSelectModalOpen || state.columnSelectNamespace !== namespace) {
    return "";
  }

  // 使用 state 中的临时选中状态
  let selectedKeys = state.columnSelectedKeys;
  if (!selectedKeys || selectedKeys.length === 0) {
    // 如果 state 中没有，从 localStorage 或默认加载
    selectedKeys = loadColumnConfigFromStorage(namespace);
    if (!selectedKeys) {
      selectedKeys = getDefaultSelectedColumns();
    }
    selectedKeys = validateColumnKeys(selectedKeys);
    state.columnSelectedKeys = selectedKeys;
  }

  const groups = buildColumnGroups();
  const totalColumns = getAllSelectableColumnKeys().size;
  const selectedCount = selectedKeys.length;
  const allSelected = selectedCount === totalColumns;

  // 渲染各分组
  const groupsHtml = groups
    .map((group) => renderColumnGroup(group, selectedKeys))
    .join("");

  return `
    <div class="perm-modal-mask column-select-modal-mask" id="column-select-modal-mask"
         role="dialog" aria-modal="true" aria-labelledby="column-select-modal-title">
      <div class="perm-modal column-select-modal column-select-modal--wide">
        <div class="perm-modal-head">
          <h3 id="column-select-modal-title">选择展示列</h3>
        </div>
        <div class="perm-modal-body column-select-modal-body">
          <div class="column-select-section">
            <div class="column-select-global-control">
              <label class="export-checkbox-opt">
                <input type="checkbox" id="column-select-all" ${allSelected ? "checked" : ""} />
                <span>全选全部字段 (${selectedCount}/${totalColumns})</span>
              </label>
            </div>
            <div class="column-select-groups">
              ${groupsHtml}
            </div>
            <p class="column-select-hint">
              选择完成后点击"应用"，列配置将自动保存。最多可选 ${MAX_COLUMN_COUNT} 列。
            </p>
          </div>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="column-select-cancel-btn">取消</button>
          <button type="button" class="action" id="column-select-reset-btn">恢复默认</button>
          <button type="button" class="action primary" id="column-select-confirm-btn">应用</button>
        </div>
      </div>
    </div>`;
}

/**
 * 渲染单个分组
 * @param {Object} group { nodeKey, nodeLabel, fields }
 * @param {Array<string>} selectedKeys 选中的列 keys
 * @returns {string} 分组 HTML
 */
function renderColumnGroup(group, selectedKeys) {
  const { nodeKey, nodeLabel, fields } = group;
  const groupSelected = countSelectedInGroup(selectedKeys, nodeKey);
  const groupTotal = getGroupTotalCount(nodeKey);
  const groupAllSelected = groupSelected === groupTotal;
  const expanded = state.columnSelectExpandedNodes?.[nodeKey] || false;

  const fieldListHtml = fields
    .map((f) => {
      const checked = selectedKeys.includes(f.key) ? "checked" : "";
      return `
        <label class="export-checkbox-opt export-field-item">
          <input type="checkbox" data-column-field="${escapeAttr(nodeKey)}:${escapeAttr(f.key)}" ${checked} />
          <span>${escapeHtml(f.label)}</span>
        </label>`;
    })
    .join("");

  return `
    <details class="export-field-group" ${expanded ? "open" : ""} data-column-node="${escapeAttr(nodeKey)}">
      <summary class="export-field-group-summary">
        <label class="export-checkbox-opt export-node-checkbox">
          <input type="checkbox" data-column-node-select-all="${escapeAttr(nodeKey)}" ${groupAllSelected ? "checked" : ""} />
          <span>${escapeHtml(nodeLabel)} (${groupSelected}/${groupTotal})</span>
        </label>
        <span class="export-field-expand-icon">${expanded ? "▼" : "▶"}</span>
      </summary>
      <div class="export-field-list">
        ${fieldListHtml}
      </div>
    </details>`;
}

/**
 * 绑定列选择弹窗事件
 * @param {string} namespace "list" 或 "home"
 * @param {Function} onApply 应用列配置后的回调（可选）
 */
export function bindColumnSelectModal(namespace, onApply) {
  const mask = document.getElementById("column-select-modal-mask");
  if (!mask) return;

  // 点击遮罩层关闭
  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) {
      closeColumnSelectModal();
    }
  });

  // 取消按钮
  document.getElementById("column-select-cancel-btn")?.addEventListener("click", closeColumnSelectModal);

  // 恢复默认按钮
  document.getElementById("column-select-reset-btn")?.addEventListener("click", () => {
    const defaultKeys = getDefaultSelectedColumns();
    state.columnSelectedKeys = defaultKeys;
    saveColumnConfigToStorage(namespace, defaultKeys);
    closeColumnSelectModal();
    if (onApply) onApply(defaultKeys);
  });

  // 应用按钮
  document.getElementById("column-select-confirm-btn")?.addEventListener("click", () => {
    const selectedKeys = state.columnSelectedKeys || [];
    if (selectedKeys.length > MAX_COLUMN_COUNT) {
      window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${selectedKeys.length} 列`);
      return;
    }
    if (selectedKeys.length === 0) {
      window.alert("请至少选择一列");
      return;
    }
    saveColumnConfigToStorage(namespace, selectedKeys);
    closeColumnSelectModal();
    if (onApply) onApply(selectedKeys);
  });

  // 全选全部字段
  const selectAllCheckbox = document.getElementById("column-select-all");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
      const checked = selectAllCheckbox.checked;
      if (checked) {
        // 检查是否会超出限制
        const totalColumns = getAllSelectableColumnKeys().size;
        if (totalColumns > MAX_COLUMN_COUNT) {
          window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前字段总数 ${totalColumns} 列`);
          selectAllCheckbox.checked = false;
          return;
        }
        // 全选
        state.columnSelectedKeys = Array.from(getAllSelectableColumnKeys());
      } else {
        // 全不选：保留流程ID列（至少一列）
        state.columnSelectedKeys = ["processId"];
      }
      requestRender();
    });
  }

  // 节点级全选
  mask.querySelectorAll("[data-column-node-select-all]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      // 阻止事件冒泡到 summary（避免触发 details toggle）
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const nodeKey = checkbox.getAttribute("data-column-node-select-all");
      if (!nodeKey) return;
      const checked = checkbox.checked;
      const currentSelected = state.columnSelectedKeys || [];
      // 获取分组内所有字段 keys
      const groups = buildColumnGroups();
      const group = groups.find((g) => g.nodeKey === nodeKey);
      if (!group) return;
      const groupKeys = group.fields.map((f) => f.key);
      // 检查是否会超出限制
      if (checked) {
        const toAdd = groupKeys.filter((k) => !currentSelected.includes(k)).length;
        if (currentSelected.length + toAdd > MAX_COLUMN_COUNT) {
          window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${currentSelected.length} 列`);
          checkbox.checked = false;
          return;
        }
        // 添加分组内所有字段
        const newSelected = new Set(currentSelected);
        groupKeys.forEach((k) => newSelected.add(k));
        state.columnSelectedKeys = Array.from(newSelected);
      } else {
        // 移除分组内所有字段
        const newSelected = currentSelected.filter((k) => !groupKeys.includes(k));
        // 至少保留一列
        if (newSelected.length === 0) {
          newSelected.push("processId");
        }
        state.columnSelectedKeys = newSelected;
      }
      requestRender();
    });
  });

  // 单个列 checkbox
  mask.querySelectorAll("[data-column-field]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      // 阻止事件冒泡（避免触发 details toggle 或其他父元素事件）
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const data = checkbox.getAttribute("data-column-field") || "";
      const [nodeKey, fieldKey] = data.split(":");
      if (!fieldKey) return;
      const currentSelected = state.columnSelectedKeys || [];
      // 检查是否会超出限制
      if (checkbox.checked) {
        if (!currentSelected.includes(fieldKey)) {
          if (currentSelected.length + 1 > MAX_COLUMN_COUNT) {
            window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${currentSelected.length} 列`);
            checkbox.checked = false;
            return;
          }
          // 添加字段
          state.columnSelectedKeys = [...currentSelected, fieldKey];
        }
      } else {
        // 移除字段
        const newSelected = currentSelected.filter((k) => k !== fieldKey);
        // 至少保留一列
        if (newSelected.length === 0) {
          window.alert("请至少选择一列");
          checkbox.checked = true;
          return;
        }
        state.columnSelectedKeys = newSelected;
      }
      requestRender();
    });
  });

  // 折叠/展开节点分组
  mask.querySelectorAll(".export-field-group").forEach((details) => {
    details.addEventListener("toggle", () => {
      const nodeKey = details.getAttribute("data-column-node");
      if (!nodeKey) return;
      const expanded = state.columnSelectExpandedNodes || {};
      expanded[nodeKey] = details.open;
      state.columnSelectExpandedNodes = expanded;
    });
  });
}

/**
 * 收集选中的列 keys
 * @param {HTMLElement} mask 弹窗容器
 * @returns {Array<string>} 选中的列 keys
 */
function collectSelectedColumnKeys(mask) {
  const keys = [];
  mask.querySelectorAll("[data-column-field]:checked").forEach((checkbox) => {
    const data = checkbox.getAttribute("data-column-field") || "";
    const [nodeKey, fieldKey] = data.split(":");
    if (fieldKey) keys.push(fieldKey);
  });
  return keys;
}

/**
 * 关闭列选择弹窗
 */
function closeColumnSelectModal() {
  state.columnSelectModalOpen = false;
  state.columnSelectNamespace = "";
  state.columnSelectedKeys = [];
  requestRender();
}

/**
 * 打开列选择弹窗
 * @param {string} namespace "list" 或 "home"
 */
export function openColumnSelectModal(namespace) {
  state.columnSelectModalOpen = true;
  state.columnSelectNamespace = namespace;
  state.columnSelectExpandedNodes = {};
  // 初始化选中状态：从 localStorage 或默认加载
  let selectedKeys = loadColumnConfigFromStorage(namespace);
  if (!selectedKeys) {
    selectedKeys = getDefaultSelectedColumns();
  }
  selectedKeys = validateColumnKeys(selectedKeys);
  state.columnSelectedKeys = selectedKeys;
  requestRender();
}