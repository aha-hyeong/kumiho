/**
 * Safely converts an unknown value to a number.
 * Returns NaN if the value is null, undefined, empty string, or invalid.
 */
export const getValidNumber = (val: unknown): number => {
  if (val === undefined || val === null || val === "") return NaN;
  return Number(val);
};
