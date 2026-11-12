import type { PageDefinition, ProjectConfig, ValidationIssue } from "./contract/page";
import { validateProject } from "./validation/validate-page.mjs";

export interface BootConfigInput {
  project: unknown;
  page: unknown;
  projectSchema: unknown;
  pageSchema: unknown;
}

export type BootDecision =
  | { ok: true; project: ProjectConfig; page: PageDefinition }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Runs the full two-gate validation (JSON Schema + semantic registry)
 * before the shell reads any project/page field. Callers must not touch
 * page fields unless the decision is `ok`; loading and error screens use
 * safe defaults instead (review S3-R2).
 */
export function decideBoot(config: BootConfigInput): BootDecision {
  const result = validateProject(config as Parameters<typeof validateProject>[0]) as {
    ok: boolean;
    errors: ValidationIssue[];
  };
  if (result.ok) {
    return {
      ok: true,
      project: config.project as ProjectConfig,
      page: config.page as PageDefinition,
    };
  }
  return { ok: false, issues: result.errors };
}
