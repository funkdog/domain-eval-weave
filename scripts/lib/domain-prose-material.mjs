import assert from "node:assert/strict";

const labels = {
  module_id: "模块编号",
  release: "版本",
  version: "版本号",
  recorded_at: "记录时间",
  maintainers: "维护者",
  scope: "范围",
  statement: "陈述",
  includes: "包含",
  excludes: "不包含",
  concepts: "概念",
  concept_id: "概念编号",
  kind: "类别",
  definition: "定义",
  relations: "关系",
  relation_id: "关系编号",
  subject_ref: "主体",
  predicate: "关系含义",
  object_ref: "客体",
  claims: "主张",
  claim_id: "主张编号",
  epistemic_state: "知识状态",
  observability: "可观察性",
  applicability: "适用条件",
  source_ids: "来源编号",
  authority_assertions: "权威范围声明",
  valid_time: "有效时间",
  model: "详细模型",
  structures: "结构",
  fields: "字段",
  states: "状态",
  transitions: "状态转换",
  flows: "流程",
  steps: "步骤",
  invariants: "不变量",
  documents: "文档",
  description: "说明",
  name: "名称",
  from: "起点",
  to: "终点",
  type: "类型",
  owner_ref: "所属对象",
};
const escaped = (s) =>
  String(s)
    .replace(/[\\`*_[\]<>|#]/g, "\\$&")
    .replaceAll("\n", "  \n");
const label = (key) => (labels[key] ? `${labels[key]}（${key}）` : key);
const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const token = (key) => String(key).replaceAll("~", "~0").replaceAll("/", "~1");

function inventory(value, pointer = "") {
  const type = kind(value);
  assert.ok(["null", "array", "object", "string", "number", "boolean"].includes(type));
  const children =
    type === "array" ? value.map((v, i) => [i, v]) : type === "object" ? Object.entries(value) : [];
  return [
    {
      pointer,
      kind: type,
      ...(type === "array" || type === "object" ? { count: children.length } : { value }),
    },
    ...children.flatMap(([key, child]) => inventory(child, `${pointer}/${token(key)}`)),
  ];
}

// Lossless field coverage is mechanical evidence, NOT independent semantic review of the prose.
export function renderDomainProse(value) {
  let markdown =
    "# 领域模型（Markdown 清单呈现）\n\n按模块、概念、关系、主张和详细模型组织；保留原字段名便于追溯。\n" +
    "列表保持原顺序；空列表、空对象、null 与未出现字段不互相替代。文字不改写；数字和布尔值明确标示。\n\n";
  const spans = [];
  function render(v, key, depth, pointer) {
    const type = kind(v);
    const indent = "    ".repeat(depth - 2);
    if (type === "object" || type === "array") {
      const children = type === "array" ? v.map((child, i) => [i, child]) : Object.entries(v);
      const start = markdown.length;
      markdown += `${indent}- **${escaped(label(key))}**（${type === "array" ? "有序条目" : "记录字段"}：${children.length} 项）\n`;
      spans.push({ pointer, start, end: markdown.length });
      for (const [childKey, child] of children) {
        let title = childKey;
        if (type === "array") {
          const id =
            child && typeof child === "object" && !Array.isArray(child)
              ? Object.entries(child).find(
                  ([k, val]) => (k.endsWith("_id") || k === "name") && typeof val === "string",
                )?.[1]
              : undefined;
          title = `第 ${Number(childKey) + 1} 项${id ? ` · ${id}` : ""}`;
        }
        render(child, title, depth + 1, `${pointer}/${token(childKey)}`);
      }
    } else {
      const text =
        type === "null"
          ? "空值（null）"
          : type === "number"
            ? `数字：${v}`
            : type === "boolean"
              ? `布尔值：${v}`
              : v === ""
                ? "空字符串"
                : escaped(v);
      const start = markdown.length;
      markdown += `${indent}- **${escaped(label(key))}**：${String(text).replaceAll("\n", `\n${indent}  `)}\n`;
      spans.push({ pointer, start, end: markdown.length });
    }
  }
  render(value, "领域模块", 2, "");
  return { markdown, inventory: inventory(value), spans, offset_unit: "utf16_code_units" };
}

export function verifyDomainProse(value, material) {
  const expected = renderDomainProse(value);
  assert.deepEqual(material.inventory, inventory(value), "source node coverage differs");
  assert.deepEqual(
    material.spans.map((s) => s.pointer),
    material.inventory.map((n) => n.pointer),
  );
  assert.equal(material.markdown, expected.markdown, "prose differs from frozen renderer output");
  assert.deepEqual(material.spans, expected.spans);
  return true;
}
