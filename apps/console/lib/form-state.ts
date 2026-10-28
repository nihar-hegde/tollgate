// What a server action reports back to its form.
export type FormState = { error: string | null; message: string | null };

export const EMPTY_FORM: FormState = { error: null, message: null };
