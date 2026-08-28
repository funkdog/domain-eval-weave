import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { assertCurrentPhase3AuthorProfile, resolvePhase2Instance } from "../instance.js";

const SKILL_NAME = "design-domain-grader";
const SKILL_ROOT_URL = new URL(`../../skills/${SKILL_NAME}/`, import.meta.url);
const SKILL_FILE_URL = new URL("SKILL.md", SKILL_ROOT_URL);

interface SkillRegistration {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly resourceBase: { readonly kind: "directory"; readonly path: string };
  readonly content: string;
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean };
}

interface DomainSkillContext {
  readonly root: { readonly baseUrl?: string };
  readonly skills: { register(skill: SkillRegistration): () => void };
  effect(callback: () => () => void, label?: string): () => void;
}

export interface DomainSkillConfig {
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function splitSkillSource(source: string): {
  readonly metadata: unknown;
  readonly content: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (match === null) throw new Error("bundled domain Skill is missing YAML frontmatter");
  return { metadata: parse(match[1] ?? ""), content: (match[2] ?? "").trim() };
}

export async function loadBundledDomainSkill(): Promise<SkillRegistration> {
  const source = await readFile(SKILL_FILE_URL, "utf8");
  const { metadata, content } = splitSkillSource(source);
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("bundled domain Skill frontmatter must be an object");
  }
  const frontmatter = metadata as Record<string, unknown>;
  if (
    frontmatter.name !== SKILL_NAME ||
    typeof frontmatter.description !== "string" ||
    frontmatter.description.length === 0 ||
    Object.keys(frontmatter).sort().join("\n") !== "description\nname"
  ) {
    throw new Error("bundled domain Skill frontmatter drifted");
  }
  return {
    name: SKILL_NAME,
    description: frontmatter.description,
    source: "bundled",
    resourceBase: { kind: "directory", path: fileURLToPath(SKILL_ROOT_URL).replace(/\/$/, "") },
    content,
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

export const name = "dsh-eval-domain-skill";
export const inject = ["skills"] as const;

async function applyDomainSkill(
  context: DomainSkillContext,
  config: DomainSkillConfig = {},
): Promise<void> {
  resolvePhase2Instance(config.env ?? process.env);
  assertCurrentPhase3AuthorProfile(context.root.baseUrl);
  const skill = await loadBundledDomainSkill();
  context.effect(() => context.skills.register(skill), "dsh-eval-domain-skill registration");
}

export default Object.assign(applyDomainSkill, { inject });
