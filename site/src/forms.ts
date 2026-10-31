/**
 * Forms generated from a tool's JSON Schema. `fieldsFromSchema` reads the schema the server lists,
 * `valuesFromArgs` fills the form from a preset, and `argsFromFields` turns what the visitor typed
 * back into tool arguments. Every form value is a string (what an input holds), keyed by the
 * field's dotted path. An empty optional field is left out of the arguments.
 */

export interface JSONSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

interface BaseField {
  /** Property name, as sent in the arguments. */
  name: string;
  /** Dotted path from the root, e.g. "weekly_spend.tv". Also the key in the form values. */
  path: string;
  label: string;
  /** Label of the fieldset the field sits in, so messages can say which "visitors" is wrong. */
  context?: string;
  help?: string;
  required: boolean;
}

export interface StringField extends BaseField {
  kind: "string";
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface EnumField extends BaseField {
  kind: "enum";
  options: string[];
}

export interface NumberField extends BaseField {
  kind: "number";
  integer: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
}

export interface BooleanField extends BaseField {
  kind: "boolean";
}

export interface ObjectField extends BaseField {
  kind: "object";
  fields: Field[];
}

/** Arrays (of objects or anything else) and any shape a form cannot express: edited as JSON. */
export interface JsonField extends BaseField {
  kind: "json";
  array: boolean;
  minItems?: number;
  maxItems?: number;
}

export type Field = StringField | EnumField | NumberField | BooleanField | ObjectField | JsonField;

export type FieldValues = Record<string, string>;

export interface FieldIssue {
  path: string;
  message: string;
}

/** The form has values that cannot become valid arguments. `issues` are in form order. */
export class FormError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "FormError";
  }
}

const WORDS: Record<string, string> = {
  tv: "TV",
  ooh: "OOH",
  mde: "MDE",
  id: "ID",
  rfm: "RFM",
  mqls: "MQLs",
  srm: "SRM",
  ci: "CI",
  min: "Minimum",
  max: "Maximum",
};

/** "mde_relative" -> "MDE relative", "weekly_spend" -> "Weekly spend". */
export function humanize(name: string): string {
  const words = name.split("_").filter(Boolean);
  return words
    .map((word, i) => {
      const known = WORDS[word.toLowerCase()];
      if (known) return known;
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

function typeOf(schema: JSONSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((t) => t !== "null");
  return schema.type;
}

function toField(
  name: string,
  schema: JSONSchema,
  prefix: string,
  required: boolean,
  context: string | undefined,
): Field {
  const base: BaseField = {
    name,
    path: prefix ? `${prefix}.${name}` : name,
    label: schema.title ?? humanize(name),
    required,
    ...(context ? { context } : {}),
    ...(schema.description ? { help: schema.description } : {}),
  };
  const type = typeOf(schema);
  if (schema.enum && schema.enum.length > 0 && schema.enum.every((v) => typeof v === "string")) {
    return { ...base, kind: "enum", options: schema.enum as string[] };
  }
  if (type === "number" || type === "integer") {
    return {
      ...base,
      kind: "number",
      integer: type === "integer",
      ...(schema.minimum !== undefined ? { min: schema.minimum } : {}),
      ...(schema.maximum !== undefined ? { max: schema.maximum } : {}),
      ...(schema.exclusiveMinimum !== undefined ? { exclusiveMin: schema.exclusiveMinimum } : {}),
      ...(schema.exclusiveMaximum !== undefined ? { exclusiveMax: schema.exclusiveMaximum } : {}),
    };
  }
  if (type === "string") {
    return {
      ...base,
      kind: "string",
      ...(schema.pattern !== undefined ? { pattern: schema.pattern } : {}),
      ...(schema.minLength !== undefined ? { minLength: schema.minLength } : {}),
      ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}),
    };
  }
  if (type === "boolean") return { ...base, kind: "boolean" };
  if (type === "object" && schema.properties) {
    return { ...base, kind: "object", fields: fieldsFromSchema(schema, base.path, base.label) };
  }
  return {
    ...base,
    kind: "json",
    array: type === "array",
    ...(schema.minItems !== undefined ? { minItems: schema.minItems } : {}),
    ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}),
  };
}

export function fieldsFromSchema(schema: JSONSchema, prefix = "", context?: string): Field[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) =>
    toField(name, property, prefix, required.has(name), context),
  );
}

/** The field's name in a message: "Conversions (control)". */
function nameOf(field: Field): string {
  return field.context ? `${field.label} (${field.context.toLowerCase()})` : field.label;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Form values for a set of arguments (used to load a preset into the form). */
export function valuesFromArgs(fields: Field[], args: Record<string, unknown>): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    const value = args[field.name];
    if (field.kind === "object") {
      Object.assign(values, valuesFromArgs(field.fields, isPlainObject(value) ? value : {}));
    } else if (value === undefined) {
      values[field.path] = "";
    } else if (field.kind === "json") {
      values[field.path] = JSON.stringify(value, null, 2);
    } else {
      values[field.path] = String(value);
    }
  }
  return values;
}

const bound = new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 });

function formatBound(n: number): string {
  return bound.format(n);
}

function rangeHint(field: NumberField): string {
  const low =
    field.exclusiveMin !== undefined
      ? `more than ${formatBound(field.exclusiveMin)}`
      : field.min !== undefined
        ? `at least ${formatBound(field.min)}`
        : "";
  const high =
    field.exclusiveMax !== undefined
      ? `less than ${formatBound(field.exclusiveMax)}`
      : field.max !== undefined
        ? `at most ${formatBound(field.max)}`
        : "";
  return [low, high].filter(Boolean).join(" and ");
}

function readNumber(field: NumberField, raw: string, issues: FieldIssue[]): number | undefined {
  const text = raw.trim();
  const value = Number(text);
  const range = rangeHint(field);
  const enter = range ? ` Enter a number ${range}.` : "";
  if (text.includes(",")) {
    // "0,5" is a decimal in many locales and "13,914" a thousands separator; both are ambiguous.
    issues.push({
      path: field.path,
      message: `${nameOf(field)} has a comma. Write the number without commas and use a dot for decimals, for example 0.5.`,
    });
    return undefined;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text) || !Number.isFinite(value)) {
    issues.push({ path: field.path, message: `${nameOf(field)} must be a number.${enter}` });
    return undefined;
  }
  if (field.integer && !Number.isInteger(value)) {
    issues.push({ path: field.path, message: `${nameOf(field)} must be a whole number.${enter}` });
    return undefined;
  }
  const tooLow =
    (field.min !== undefined && value < field.min) ||
    (field.exclusiveMin !== undefined && value <= field.exclusiveMin);
  const tooHigh =
    (field.max !== undefined && value > field.max) ||
    (field.exclusiveMax !== undefined && value >= field.exclusiveMax);
  if (tooLow || tooHigh) {
    issues.push({ path: field.path, message: `${nameOf(field)} must be ${range}.` });
    return undefined;
  }
  return value;
}

function readString(field: StringField, raw: string, issues: FieldIssue[]): string | undefined {
  if (field.maxLength !== undefined && raw.length > field.maxLength) {
    issues.push({
      path: field.path,
      message: `${nameOf(field)} can be at most ${field.maxLength} characters long.`,
    });
    return undefined;
  }
  if (field.minLength !== undefined && raw.length < field.minLength) {
    issues.push({
      path: field.path,
      message: `${nameOf(field)} must be at least ${field.minLength} characters long.`,
    });
    return undefined;
  }
  const pattern = compilePattern(field.pattern);
  if (pattern && !pattern.test(raw)) {
    const example = field.help?.match(/\(for example ([^)]+)\)/)?.[1];
    issues.push({
      path: field.path,
      message: `${nameOf(field)} is not in the expected format.${example ? ` For example: ${example}.` : ""}`,
    });
    return undefined;
  }
  return raw;
}

/** The schema's pattern as a RegExp, or undefined when there is none or it does not compile. */
function compilePattern(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  try {
    return new RegExp(pattern, "u");
  } catch {
    // The server checks the pattern anyway; a form that cannot compile it just skips the check.
    return undefined;
  }
}

function items(n: number): string {
  return `${bound.format(n)} ${n === 1 ? "item" : "items"}`;
}

function readJson(field: JsonField, raw: string, issues: FieldIssue[]): unknown {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    issues.push({
      path: field.path,
      message: `${nameOf(field)} is not valid JSON. Check the brackets, quotes and commas.`,
    });
    return undefined;
  }
  if (field.array && !Array.isArray(value)) {
    issues.push({
      path: field.path,
      message: `${nameOf(field)} must be a JSON list, written between [ and ].`,
    });
    return undefined;
  }
  if (Array.isArray(value)) {
    if (field.minItems !== undefined && value.length < field.minItems) {
      issues.push({
        path: field.path,
        message: `${nameOf(field)} needs at least ${items(field.minItems)}; it has ${value.length}.`,
      });
      return undefined;
    }
    if (field.maxItems !== undefined && value.length > field.maxItems) {
      issues.push({
        path: field.path,
        message: `${nameOf(field)} can have at most ${items(field.maxItems)}; it has ${bound.format(value.length)}.`,
      });
      return undefined;
    }
  }
  return value;
}

function readFields(
  fields: Field[],
  values: FieldValues,
  issues: FieldIssue[],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind === "object") {
      const filled = hasAnyValue(field.fields, values);
      if (!filled && !field.required) continue;
      args[field.name] = readFields(field.fields, values, issues);
      continue;
    }
    const raw = values[field.path] ?? "";
    if (raw.trim() === "") {
      if (field.required) {
        const hint = field.kind === "number" ? rangeHint(field) : "";
        issues.push({
          path: field.path,
          message: `${nameOf(field)} is required.${hint ? ` Enter a number ${hint}.` : ""}`,
        });
      }
      continue;
    }
    let value: unknown;
    switch (field.kind) {
      case "number":
        value = readNumber(field, raw, issues);
        break;
      case "string":
        value = readString(field, raw, issues);
        break;
      case "enum":
        if (field.options.includes(raw)) value = raw;
        else
          issues.push({
            path: field.path,
            message: `${nameOf(field)} must be one of: ${field.options.join(", ")}.`,
          });
        break;
      case "boolean":
        value = raw === "true";
        break;
      case "json":
        value = readJson(field, raw, issues);
        break;
    }
    if (value !== undefined) args[field.name] = value;
  }
  return args;
}

function hasAnyValue(fields: Field[], values: FieldValues): boolean {
  return fields.some((field) =>
    field.kind === "object"
      ? hasAnyValue(field.fields, values)
      : (values[field.path] ?? "").trim() !== "",
  );
}

/** Tool arguments from the form values. Throws `FormError` listing every field that is wrong. */
export function argsFromFields(fields: Field[], values: FieldValues): Record<string, unknown> {
  const issues: FieldIssue[] = [];
  const args = readFields(fields, values, issues);
  if (issues.length > 0) throw new FormError(issues);
  return args;
}

// DOM ---------------------------------------------------------------------------------------------

export interface FormControls {
  /** The generated fields, ready to append inside a <form>. */
  element: HTMLElement;
  read(): FieldValues;
  write(values: FieldValues): void;
  /** Marks the fields with issues (or clears the marks with an empty list). */
  showIssues(issues: FieldIssue[]): void;
  /** The control for a field path, to move focus to it. */
  control(path: string): HTMLElement | undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9_-]/g, "-");
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Builds labelled inputs for `fields`. Ids start with `idPrefix` so several forms can coexist. */
export function buildFields(fields: Field[], idPrefix: string): FormControls {
  const controls = new Map<string, Control>();
  const errors = new Map<string, HTMLElement>();
  const helps = new Map<string, string>();

  function labelFor(field: Field, id: string): HTMLLabelElement {
    const label = el("label", "field__label");
    label.htmlFor = id;
    label.append(field.label);
    const key = el("code", "field__key", field.name);
    key.setAttribute("aria-hidden", "true");
    label.append(" ", key);
    if (!field.required) label.append(" ", el("span", "field__optional", "optional"));
    return label;
  }

  function build(field: Field): HTMLElement {
    const id = `${idPrefix}-${slug(field.path)}`;
    if (field.kind === "object") {
      const set = el("fieldset", "fieldset");
      const legend = el("legend", "fieldset__legend", field.label);
      if (!field.required) legend.append(" ", el("span", "field__optional", "optional"));
      set.append(legend);
      if (field.help) {
        const help = el("p", "field__help", field.help);
        help.id = `${id}-help`;
        set.setAttribute("aria-describedby", help.id);
        set.append(help);
      }
      const grid = el("div", "fieldset__fields");
      for (const child of field.fields) grid.append(build(child));
      set.append(grid);
      return set;
    }

    const wrap = el("div", `field field--${field.kind}`);
    let control: Control;
    if (field.kind === "enum" || (field.kind === "boolean" && !field.required)) {
      const select = el("select", "field__control");
      const options =
        field.kind === "enum"
          ? field.options.map((o) => [o, o] as const)
          : ([
              ["true", "Yes"],
              ["false", "No"],
            ] as const);
      const option = (value: string, text: string) => {
        const node = el("option", "", text);
        node.value = value;
        return node;
      };
      select.append(option("", field.required ? "Choose one" : "Default"));
      for (const [value, text] of options) select.append(option(value, text));
      control = select;
    } else if (field.kind === "boolean") {
      const box = el("input", "field__check");
      box.type = "checkbox";
      control = box;
    } else if (field.kind === "json") {
      const area = el("textarea", "field__control field__control--json");
      area.rows = 8;
      area.spellcheck = false;
      control = area;
    } else {
      const input = el("input", "field__control");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      if (field.kind === "number") input.inputMode = field.integer ? "numeric" : "decimal";
      control = input;
    }
    control.id = id;
    control.name = field.path;
    if (field.required) control.setAttribute("aria-required", "true");

    const described: string[] = [];
    if (field.help) {
      const help = el("p", "field__help", field.help);
      help.id = `${id}-help`;
      described.push(help.id);
      wrap.append(labelFor(field, id), control, help);
    } else {
      wrap.append(labelFor(field, id), control);
    }
    const error = el("p", "field__error");
    error.id = `${id}-error`;
    error.hidden = true;
    wrap.append(error);
    if (described.length > 0) control.setAttribute("aria-describedby", described.join(" "));
    helps.set(field.path, described.join(" "));
    controls.set(field.path, control);
    errors.set(field.path, error);
    return wrap;
  }

  const element = el("div", "fields");
  for (const field of fields) element.append(build(field));

  return {
    element,
    read() {
      const values: FieldValues = {};
      for (const [path, control] of controls) {
        values[path] =
          control instanceof HTMLInputElement && control.type === "checkbox"
            ? String(control.checked)
            : control.value;
      }
      return values;
    },
    write(values) {
      for (const [path, control] of controls) {
        const value = values[path] ?? "";
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          control.checked = value === "true";
        } else {
          control.value = value;
        }
      }
    },
    showIssues(issues) {
      const byPath = new Map(issues.map((issue) => [issue.path, issue.message]));
      for (const [path, control] of controls) {
        const error = errors.get(path);
        const message = byPath.get(path);
        const help = helps.get(path) ?? "";
        if (!error) continue;
        if (message) {
          error.textContent = message;
          error.hidden = false;
          control.setAttribute("aria-invalid", "true");
          control.setAttribute("aria-describedby", [error.id, help].filter(Boolean).join(" "));
        } else {
          error.textContent = "";
          error.hidden = true;
          control.removeAttribute("aria-invalid");
          if (help) control.setAttribute("aria-describedby", help);
          else control.removeAttribute("aria-describedby");
        }
      }
    },
    control(path) {
      return controls.get(path);
    },
  };
}
