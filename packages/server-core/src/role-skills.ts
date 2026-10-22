import { ProtocolError, SKILL_LIMITS, validSkillRef, type SkillRef } from "@openbot/protocol";

/** Compose deliberate pins without silently dropping, replacing or upgrading a method. */
export function composeRoleSkills(defaults: readonly SkillRef[], explicit: readonly SkillRef[]): readonly SkillRef[] {
	for (const selection of [defaults, explicit]) if (selection.length > SKILL_LIMITS.attachments || new Set(selection.map(ref => ref.name)).size !== selection.length)
	 throw new ProtocolError("invalid_request", "Select up to two distinct skills");
	const refs = new Map<string, SkillRef>();
	for (const ref of [...defaults, ...explicit]) {
	 if (!validSkillRef(ref)) throw new ProtocolError("invalid_request", "Choose an exact skill reference");
	 const previous = refs.get(ref.name);
	 if (previous && (previous.revision !== ref.revision || previous.sha256 !== ref.sha256))
	  throw new ProtocolError("invalid_request", "Role and message skills select different versions. Edit the role defaults or message attachments.");
	 refs.set(ref.name, ref);
	}
	if (refs.size > SKILL_LIMITS.attachments)
	 throw new ProtocolError("invalid_request", "Role and message skills exceed two methods. Edit the role defaults or message attachments.");
	return [...refs.values()];
}
