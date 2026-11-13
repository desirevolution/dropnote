import { translate } from "../src/translations.ts";

export const language = () => document.documentElement.lang;
export const t = (message, values) => translate(language(), message, values);
