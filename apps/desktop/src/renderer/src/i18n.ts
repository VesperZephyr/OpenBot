import { translate } from "../../shared/i18n";
import { useStore } from "./store";

/** App subscribes to language so existing controls rerender without remounting drafts. */
export function t(message: string, values?: Readonly<Record<string, string | number>>): string {
 return translate(useStore.getState().settings?.language ?? "en", message, values);
}
