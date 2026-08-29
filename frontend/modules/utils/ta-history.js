/** 是否含可展示的用户气泡。 */
export function taMessagesHaveUser(messages) {
  return (Array.isArray(messages) ? messages : []).some(
    (m) => m && m.role === "user" && String(m.content || "").trim()
  );
}

/** 后台流只有在用户仍停留于对应提单助手会话时才允许修改页面 DOM。 */
export function shouldPatchTicketAssistantStream(activeKey, activeSessionId, streamSessionId) {
  const activeSid = Number(activeSessionId);
  const streamSid = Number(streamSessionId);
  return activeKey === "assistant:ticket" && !!streamSid && activeSid === streamSid;
}

/**
 * 决定 history.get 结果是否覆盖本地消息。
 * 空历史 / 流式中不覆盖；历史有用户气泡时以历史为准（即使更短），
 * 但流结束后的立即回拉不能用更短的旧历史冲掉刚提交的选择回显。
 */
export function resolveFetchedTaMessages(prev, items, options = {}) {
  const local = Array.isArray(prev) ? prev : [];
  const next = Array.isArray(items) ? items : [];
  const chatLoading = !!options.chatLoading;
  const streamingLocal = local.some((m) => m && m.streaming);
  if (chatLoading && streamingLocal) return local;
  if (!next.length) return local.length ? local : next;

  const nextHasUser = taMessagesHaveUser(next);
  const localHasUser = taMessagesHaveUser(local);
  const localHasFinalizedTurn = local.some(
    (m) => m?.role === "assistant" && m.final_content != null && !m.streaming
  );
  // 流结束后的立即回拉用于补齐缺失消息，不能用九问原始 history
  // 覆盖刚按 chat.final 折叠好的本地最终形态。
  if (options.preserveFinalizedLocal && localHasUser && localHasFinalizedTurn) return local;
  if (localHasUser && !nextHasUser) return local;
  if (nextHasUser) {
    // 提交选项后续流刚结束时，九问 history 可能还没有本轮回复。
    // 若用更短的旧历史覆盖，本地「已选择」回显和新回复都会被冲掉，看起来像没反应。
    if (options.preserveFinalizedLocal && local.length > next.length) return local;
    return next;
  }
  if (local.length && next.length < local.length) return local;
  return next;
}

function normalizedMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 对齐九问 chat.final 的 replace-turn 语义：流式 delta 是本轮临时展示，
 * final 才是最终回答。两者不同时，把 delta 收进工作过程，避免过程话术
 * （例如“让我搜索一下”）在对话结束后继续留在最终回答气泡里。
 */
export function finalizeTaAssistantTurn(messages, streamedContent, finalContent, existingWork = "") {
  const list = Array.isArray(messages) ? [...messages] : [];
  const finalText = String(finalContent || "").trim();
  if (!finalText) return list;

  let targetIndex = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "assistant") {
      targetIndex = i;
      break;
    }
    if (list[i]?.role === "user") break;
  }
  if (targetIndex < 0) return list;

  const streamed = String(streamedContent || "").trim();
  let processText = "";
  if (streamed && normalizedMessageText(streamed) !== normalizedMessageText(finalText)) {
    const suffixAt = streamed.lastIndexOf(finalText);
    processText = suffixAt >= 0 && !streamed.slice(suffixAt + finalText.length).trim()
      ? streamed.slice(0, suffixAt).trim()
      : streamed;
  }
  const workParts = [String(existingWork || "").trim(), processText]
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index);
  const target = list[targetIndex];
  list[targetIndex] = {
    ...target,
    content: finalText,
    final_content: finalText,
    ...(workParts.length ? { work_content: workParts.join("\n\n") } : {}),
  };
  return list;
}
