/** The message of `value` and of every cause under it, outermost first. */
export function describeError(value: unknown): string;

/** One error of a chain: its name, message and own system fields. */
export type CauseLevel = {
  name: string;
  message: string;
  fields: Record<string, string | number>;
};

/** Every error under `value`, outermost first, as data. */
export function causeChain(value: unknown): CauseLevel[];
