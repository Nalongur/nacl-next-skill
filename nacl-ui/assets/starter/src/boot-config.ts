import projectJson from "../nacl.project.json";
import pageJson from "./page.json";
import pageSchema from "../schema/page.schema.json";
import projectSchema from "../schema/project.schema.json";

/**
 * The generated project/page configuration this shell was built from.
 * Consumers must run boot-time validation before reading any field of
 * `project`/`page` (see `boot.ts`).
 */
export const bootConfig = {
  project: projectJson,
  page: pageJson,
  projectSchema,
  pageSchema,
};
