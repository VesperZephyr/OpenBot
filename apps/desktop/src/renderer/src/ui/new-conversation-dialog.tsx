import { Button } from "./boardui/components/base/buttons/button";
import { OpenBotDialog } from "./dialog";

export function NewConversationDialog({
	open,
	title,
	closeLabel,
	createBot,
	createBotDetail,
	createGroup,
	createGroupDetail,
	importTemplate,
	onClose,
	onCreateBot,
	onCreateGroup,
	onImport,
}: {
	open: boolean;
	title: string;
	closeLabel: string;
	createBot: string;
	createBotDetail: string;
	createGroup: string;
	createGroupDetail: string;
	importTemplate: string;
	onClose: () => void;
	onCreateBot: () => void;
	onCreateGroup: () => void;
	onImport: () => void;
}) {
	return (
		<OpenBotDialog open={open} title={title} closeLabel={closeLabel} onClose={onClose}>
			<Button size="choice" onClick={onCreateBot}>
				{createBot}
				<small>{createBotDetail}</small>
			</Button>
			<Button size="choice" onClick={onCreateGroup}>
				{createGroup}
				<small>{createGroupDetail}</small>
			</Button>
			<Button size="choice" onClick={onImport}>
				{importTemplate}
			</Button>
		</OpenBotDialog>
	);
}
