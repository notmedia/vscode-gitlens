'use strict';
import { Strings } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { GitLog, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesQuickPick, BranchHistoryQuickPick, CommandQuickPickItem } from '../quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

export interface ShowQuickBranchHistoryCommandArgs {
    branch?: string;
    log?: GitLog;
    maxCount?: number;

    goBackCommand?: CommandQuickPickItem;
    nextPageCommand?: CommandQuickPickItem;
}

export class ShowQuickBranchHistoryCommand extends ActiveEditorCachedCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.ShowQuickBranchHistory);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickBranchHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        args = { ...args };
        if (args.maxCount == null) {
            args.maxCount = this.git.config.advanced.maxQuickHistory;
        }

        let progressCancellation = args.branch === undefined ? undefined : BranchHistoryQuickPick.showProgress(args.branch);
        try {
            const repoPath = gitUri === undefined ? this.git.getHighlanderRepoPath() : gitUri.repoPath;
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to show branch history`);

            if (args.branch === undefined) {
                const branches = await this.git.getBranches(repoPath);

                const pick = await BranchesQuickPick.show(branches, `Show history for branch${GlyphChars.Ellipsis}`);
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                args.branch = pick.branch.name;
                if (args.branch === undefined) return undefined;

                progressCancellation = BranchHistoryQuickPick.showProgress(args.branch);
            }

            if (args.log === undefined) {
                args.log = await this.git.getLogForRepo(repoPath, (gitUri && gitUri.sha) || args.branch, args.maxCount);
                if (args.log === undefined) return window.showWarningMessage(`Unable to show branch history`);
            }

            if (progressCancellation !== undefined && progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await BranchHistoryQuickPick.show(this.git, args.log, gitUri, args.branch, progressCancellation!, args.goBackCommand, args.nextPageCommand);
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            // Create a command to get back to here
            const currentCommand = new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to ${GlyphChars.Space}$(git-branch) ${args.branch} history`
            }, Commands.ShowQuickBranchHistory, [
                    uri,
                    args
                ]);

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                pick.commit.toGitUri(),
                {
                    sha: pick.commit.sha,
                    commit: pick.commit,
                    repoLog: args.log,
                    goBackCommand: currentCommand
                } as ShowQuickCommitDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickBranchHistoryCommand');
            return window.showErrorMessage(`Unable to show branch history. See output channel for more details`);
        }
        finally {
            progressCancellation && progressCancellation.dispose();
        }
    }
}