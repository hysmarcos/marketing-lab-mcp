import { z } from "zod";

/** Optional YYYY-MM input field shared by the tools that filter by month. */
export const monthField = (what: string, example: string, coverage: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .describe(`${what} month to include, as YYYY-MM (for example ${example}). ${coverage}`);
