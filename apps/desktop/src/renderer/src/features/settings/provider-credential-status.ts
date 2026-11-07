import { translate, type Language } from "../../../../shared/i18n";

export function providerCredentialStatus(keyStored: boolean, language: Language): string {
	return translate(language, keyStored ? "Key stored" : "Key from models.json");
}
