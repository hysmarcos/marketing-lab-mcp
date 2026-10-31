import type { z } from "zod";

/** Domain error: its message is returned to the caller as a tool error. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** Maximum length of the plain-English summary returned in `content`. */
export const MAX_SUMMARY_LENGTH = 1200;

export interface ToolSpec<
  I extends z.ZodObject = z.ZodObject,
  O extends Record<string, unknown> = Record<string, unknown>,
> {
  /** snake_case, e.g. "ab_test_evaluate". */
  name: string;
  /** Human title for the page. */
  title: string;
  /** For the LLM: what it answers, when to use it, data source, limits. */
  description: string;
  /** Zod schema (strict); every field has `.describe()`. */
  input: I;
  /** Pure and synchronous. */
  run(args: z.infer<I>): O;
  /** Plain-English summary for the LLM, at most `MAX_SUMMARY_LENGTH` characters. */
  summarize(out: O): string;
  /** At least one; used by tests and playground presets. */
  examples: { label: string; args: z.infer<I> }[];
}
