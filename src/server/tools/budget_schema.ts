import { z } from "zod";

/**
 * Object with one optional dollar-per-week field per channel. Declared key by key (instead of
 * a record) so the JSON Schema lists the channels and clients can build forms from it.
 * `what` names the number, e.g. "Planned spend"; it starts each field description.
 */
export function channelAmounts(what: string) {
  const field = (label: string) =>
    z.number().min(0).optional().describe(`${what} for ${label}, in dollars per week (0 or more).`);
  return z.strictObject({
    tv: field("TV"),
    ooh: field("ooh (out-of-home: billboards and street ads)"),
    print: field("print (newspapers and magazines)"),
    facebook: field("Facebook"),
    search: field("search (paid search ads)"),
  });
}
