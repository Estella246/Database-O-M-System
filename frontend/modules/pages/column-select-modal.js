import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import {
  buildColumnGroups,
  getDefaultSelectedColumns,
  loadColumnConfigFromStorage,
  saveColumnConfigToStorage,
  validateColumnConfig,
  countSelectedInGroup,
  getGroupTotalCount,
  getAllSelectableColumnCount,
  MAX_COLUMN_COUNT,
} from "../constants/column-fields.js";
import { countSelectedFields, getDefaultSelectedFields } from "../constants/export-fields.js";

/**
 * 根据关键词过滤分组
 * @param {Array} groups 分组列表
 * @param {string} keyword 搜索关键词（已转小写）
 * @returns {Array} 过滤后的分组列表（只保留有匹配字段的分组）
 */
function filterGroupsByKeyword(groups, keyword) {
  if (!keyword) return groups;
  return groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((f) => f.label.toLowerCase().includes(keyword)),
    }))
    .filter((group) => group.fields.length > 0);
}

/**
 * 计算过滤后的字段总数
 * @param {Array} filteredGroups 过滤后的分组列表
 * @returns {number}
 */
function countMatchedFields(filteredGroups) {
  let total = 0;
  filteredGroups.forEach((g) => {
    total += g.fields.length;
  });
  return total;
}

/**
 * 渲染列选择弹窗 HTML
 * @param {string} namespace `list` | `home` | `patch`
 * @returns {string} 弹窗 HTML 字符串
 */
export function renderColumnSelectModalHtml(namespace) {
  if (!state.columnSelectModalOpen || state.columnSelectNamespace !== namespace) {
    return "";
  }

  // 使用 state 中的临时选中状态（按节点存储，与导出功能一致）
  let selectedFields = state.columnSelectedFields;
  if (!selectedFields || Object.keys(selectedFields).length === 0) {
    // 如果 state 中没有，从 localStorage 加载列配置并转换为按节点格式
    const columnConfig = loadColumnConfigFromStorage(namespace) || getDefaultSelectedColumns(namespace);
    const validConfig = validateColumnConfig(columnConfig);
    // 将配置数组转换为按节点的格式
    selectedFields = convertConfigToFieldsFormat(validConfig);
    state.columnSelectedFields = selectedFields;
  }

  const groups = buildColumnGroups();
  const totalColumns = getAllSelectableColumnCount();
  const selectedCount = countSelectedFields(selectedFields);
  const allSelected = selectedCount === totalColumns;

  // 搜索过滤
  const searchKeyword = (state.columnSelectSearchKeyword || "").trim().toLowerCase();
  const filteredGroups = filterGroupsByKeyword(groups, searchKeyword);
  const matchCount = countMatchedFields(filteredGroups);

  // 渲染各分组
  const groupsHtml = filteredGroups.length > 0
    ? filteredGroups.map((group) => renderColumnGroup(group, selectedFields, searchKeyword)).join("")
    : `<p class="column-select-empty-hint">未找到匹配的列名</p>`;

  return `
    <div class="perm-modal-mask column-select-modal-mask" id="column-select-modal-mask"
         role="dialog" aria-modal="true" aria-labelledby="column-select-modal-title">
      <div class="perm-modal column-select-modal column-select-modal--wide">
        <div class="perm-modal-head">
          <h3 id="column-select-modal-title">选择展示列</h3>
        </div>
        <div class="perm-modal-body column-select-modal-body">
          <div class="column-select-section">
            <div class="column-select-search-wrap">
              <input type="search" id="column-select-search-input"
                     class="column-select-search-input"
                     placeholder="搜索列名..."
                     value="${escapeAttr(state.columnSelectSearchKeyword || "")}" />
              <span class="column-select-search-count">${matchCount} 个匹配</span>
            </div>
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
 * 将配置数组转换为按节点的格式
 * @param {Array<{nodeKey, fieldKey}>} columnConfig 列配置数组
 * @returns {Object} { nodeKey: [fieldKeys] }
 */
function convertConfigToFieldsFormat(columnConfig) {
  const result = {};
  columnConfig.forEach((item) => {
    if (!result[item.nodeKey]) {
      result[item.nodeKey] = [];
    }
    if (!result[item.nodeKey].includes(item.fieldKey)) {
      result[item.nodeKey].push(item.fieldKey);
    }
  });
  return result;
}

/**
 * 从按节点的格式提取配置数组（带节点信息）
 * @param {Object} selectedFields { nodeKey: [fieldKeys] }
 * @returns {Array<{nodeKey, fieldKey}>} 配置数组
 */
function extractColumnConfig(selectedFields) {
  const config = [];
  Object.entries(selectedFields || {}).forEach(([nodeKey, fieldKeys]) => {
    (fieldKeys || []).forEach((fieldKey) => {
      config.push({ nodeKey, fieldKey });
    });
  });
  return config;
}

/**
 * 计算配置数组的唯一列数（用于限制检查）
 * @param {Array<{nodeKey, fieldKey}>} columnConfig 配置数组
 * @returns {number} 列数
 */
function countColumnConfig(columnConfig) {
  return columnConfig.length;
}

/**
 * 渲染单个分组
 * @param {Object} group { nodeKey, nodeLabel, fields }
 * @param {Object} selectedFields { nodeKey: [fieldKeys] }
 * @param {string} searchKeyword 搜索关键词（用于高亮匹配文字）
 * @returns {string} 分组 HTML
 */
function renderColumnGroup(group, selectedFields, searchKeyword = "") {
  const { nodeKey, nodeLabel, fields } = group;
  const selectedInNode = selectedFields[nodeKey] || [];
  const groupSelected = selectedInNode.length;
  const groupTotal = getGroupTotalCount(nodeKey);
  const groupAllSelected = groupSelected === groupTotal;
  // 有搜索关键词时强制展开，否则使用折叠状态
  const expanded = searchKeyword ? true : (state.columnSelectExpandedNodes?.[nodeKey] || false);

  const fieldListHtml = fields
    .map((f) => {
      const checked = selectedInNode.includes(f.key) ? "checked" : "";
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
 * @param {string} namespace `list` | `home` | `patch`
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

  // 搜索输入框事件（防抖1000ms + Enter 立即触发）
  const searchInput = document.getElementById("column-select-search-input");
  if (searchInput) {
    let searchDebounceTimer = null;
    searchInput.addEventListener("input", () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.columnSelectSearchKeyword = searchInput.value;
        requestRender();
      }, 1000);
    });
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        state.columnSelectSearchKeyword = searchInput.value;
        requestRender();
      }
    });
  }

  // 取消按钮
  document.getElementById("column-select-cancel-btn")?.addEventListener("click", closeColumnSelectModal);

  // 恢复默认按钮
  document.getElementById("column-select-reset-btn")?.addEventListener("click", () => {
    const defaultConfig = getDefaultSelectedColumns(namespace);
    const defaultFields = convertConfigToFieldsFormat(defaultConfig);
    state.columnSelectedFields = defaultFields;
    saveColumnConfigToStorage(namespace, defaultConfig);
    closeColumnSelectModal();
    if (onApply) onApply(defaultConfig);
  });

  // 应用按钮
  document.getElementById("column-select-confirm-btn")?.addEventListener("click", () => {
    const selectedFields = state.columnSelectedFields || {};
    const columnConfig = extractColumnConfig(selectedFields);
    if (columnConfig.length > MAX_COLUMN_COUNT) {
      window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${columnConfig.length} 列`);
      return;
    }
    if (columnConfig.length === 0) {
      window.alert("请至少选择一列");
      return;
    }
    saveColumnConfigToStorage(namespace, columnConfig);
    closeColumnSelectModal();
    if (onApply) onApply(columnConfig);
  });

  // 全选全部字段
  const selectAllCheckbox = document.getElementById("column-select-all");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
      const checked = selectAllCheckbox.checked;
      if (checked) {
        // 检查是否会超出限制（所有可选列总数）
        const totalColumns = getAllSelectableColumnCount();
        if (totalColumns > MAX_COLUMN_COUNT) {
          window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前可选字段总数 ${totalColumns} 列`);
          selectAllCheckbox.checked = false;
          return;
        }
        // 全选所有节点的所有字段
        state.columnSelectedFields = getDefaultSelectedFields();
      } else {
        // 全不选：清空所有节点
        const empty = {};
        buildColumnGroups().forEach((g) => {
          empty[g.nodeKey] = [];
        });
        state.columnSelectedFields = empty;
      }
      requestRender();
    });
  }

  // 节点级全选
  mask.querySelectorAll("[data-column-node-select-all]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const nodeKey = checkbox.getAttribute("data-column-node-select-all");
      if (!nodeKey) return;
      const checked = checkbox.checked;
      const groups = buildColumnGroups();
      const group = groups.find((g) => g.nodeKey === nodeKey);
      if (!group) return;
      const groupKeys = group.fields.map((f) => f.key);

      const currentFields = state.columnSelectedFields || {};
      if (checked) {
        // 检查是否会超出限制（计算当前列数）
        const currentConfig = extractColumnConfig(currentFields);
        const toAdd = groupKeys.filter((k) => !currentFields[nodeKey]?.includes(k)).length;
        if (currentConfig.length + toAdd > MAX_COLUMN_COUNT) {
          window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${currentConfig.length} 列`);
          checkbox.checked = false;
          return;
        }
        // 选中分组内所有字段
        currentFields[nodeKey] = groupKeys;
      } else {
        // 取消选中分组内所有字段
        currentFields[nodeKey] = [];
      }
      state.columnSelectedFields = currentFields;
      requestRender();
    });
  });

  // 单个列 checkbox
  mask.querySelectorAll("[data-column-field]").forEach((checkbox) => {
    checkbox.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", (ev) => {
      ev.stopPropagation();
      const data = checkbox.getAttribute("data-column-field") || "";
      const [nodeKey, fieldKey] = data.split(":");
      if (!nodeKey || !fieldKey) return;

      const currentFields = state.columnSelectedFields || {};
      const nodeSelected = currentFields[nodeKey] || [];

      if (checkbox.checked) {
        // 检查是否会超出限制
        const currentConfig = extractColumnConfig(currentFields);
        if (!nodeSelected.includes(fieldKey)) {
          if (currentConfig.length + 1 > MAX_COLUMN_COUNT) {
            window.alert(`最多只能选择 ${MAX_COLUMN_COUNT} 列，当前已选 ${currentConfig.length} 列`);
            checkbox.checked = false;
            return;
          }
        }
        // 添加字段
        if (!nodeSelected.includes(fieldKey)) {
          currentFields[nodeKey] = [...nodeSelected, fieldKey];
        }
      } else {
        // 移除字段
        currentFields[nodeKey] = nodeSelected.filter((k) => k !== fieldKey);
      }
      state.columnSelectedFields = currentFields;
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
 * 关闭列选择弹窗
 */
function closeColumnSelectModal() {
  state.columnSelectModalOpen = false;
  state.columnSelectNamespace = "";
  state.columnSelectedFields = {};
  state.columnSelectSearchKeyword = "";
  requestRender();
}

/**
 * 打开列选择弹窗
 * @param {string} namespace `list` | `home` | `patch`
 */
export function openColumnSelectModal(namespace) {
  state.columnSelectModalOpen = true;
  state.columnSelectNamespace = namespace;
  state.columnSelectExpandedNodes = {};
  state.columnSelectSearchKeyword = "";
  // 初始化选中状态：从 localStorage 加载列配置并转换为按节点格式
  const columnConfig = loadColumnConfigFromStorage(namespace) || getDefaultSelectedColumns(namespace);
  const validConfig = validateColumnConfig(columnConfig);
  state.columnSelectedFields = convertConfigToFieldsFormat(validConfig);
  requestRender();
}