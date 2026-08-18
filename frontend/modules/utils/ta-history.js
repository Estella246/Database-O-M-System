/** 是否含可展示的用户气泡。 */
export function taMessagesHaveUser(messages) {
  return (Array.isArray(messages) ? messages : []).some(
    (m) => m && m.role === "user" && String(m.content || "").trim()
  );
}

/**
 * 决定 history.get 结果是否覆盖本地消息。
 * 空历史 / 流式中不覆盖；历史有用户气泡时以历史为准（即使更短）。
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
  if (localHasUser && !nextHasUser) return local;
  if (nextHasUser) return next;
  if (local.length && next.length < local.length) return local;
  return next;
}
