export function fieldVisible(field, vals) {
  if (field.key === "next_handler" && String(vals.handle_mode || "") === "问题解决关闭") {
    return false;
  }
  const c = field.constraints || {};
  const rules = c.visible_when_all;
  if (!rules || !rules.length) return true;
  return rules.every((r) => {
    const v = vals[r.field];
    return (r.values || []).includes(v);
  });
}

export function matchesRequiredIf(requiredIf, vals) {
  if (!requiredIf || typeof requiredIf !== "object") return false;
  return Object.entries(requiredIf).every(([depKey, expected]) => {
    const actual = vals[depKey];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

export function optionalWhenAllMatches(c, vals) {
  const rules = c.optional_when_all;
  if (!rules || !rules.length) return false;
  return rules.every((r) => (r.values || []).includes(vals[r.field]));
}

export function optionalWhenAnyMatches(c, vals) {
  const rules = c.optional_when_any;
  if (!rules || !rules.length) return false;
  return rules.some((r) => (r.values || []).includes(vals[r.field]));
}

export function fieldEffectiveRequired(field, vals) {
  const c = field.constraints || {};
  if (!fieldVisible(field, vals)) return false;
  if (optionalWhenAnyMatches(c, vals) || optionalWhenAllMatches(c, vals)) return false;
  if (c.required_when_visible) return true;
  if (c.required_if && Object.keys(c.required_if).length) {
    return matchesRequiredIf(c.required_if, vals);
  }
  return !!field.required;
}
