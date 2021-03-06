/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {OmnisharpServer} from '../omnisharp/server';
import * as serverUtils from '../omnisharp/utils';
import findLaunchTargets from '../omnisharp/launchTargetFinder';
import * as cp from 'child_process';
import * as fs from 'fs-extra-promise';
import * as path from 'path';
import * as protocol from '../omnisharp/protocol';
import * as vscode from 'vscode';
import * as dotnetTest from './dotnetTest'
import {DotNetAttachItemsProviderFactory, AttachPicker} from './processPicker'

let channel = vscode.window.createOutputChannel('.NET');

export default function registerCommands(server: OmnisharpServer, extensionPath: string) {
    let d1 = vscode.commands.registerCommand('o.restart', () => server.restart());
    let d2 = vscode.commands.registerCommand('o.pickProjectAndStart', () => pickProjectAndStart(server));
    let d3 = vscode.commands.registerCommand('o.showOutput', () => server.getChannel().show(vscode.ViewColumn.Three));
    let d4 = vscode.commands.registerCommand('dotnet.restore', () => dotnetRestoreAllProjects(server));

    // register empty handler for csharp.installDebugger
    // running the command activates the extension, which is all we need for installation to kickoff
    let d5 = vscode.commands.registerCommand('csharp.downloadDebugger', () => { });

    // register two commands for running and debugging xunit tests
    let d6 = dotnetTest.registerDotNetTestRunCommand(server);
    let d7 = dotnetTest.registerDotNetTestDebugCommand(server);    
    
    // register process picker for attach
    let attachItemsProvider = DotNetAttachItemsProviderFactory.Get();
    let attacher = new AttachPicker(attachItemsProvider);
    let d8 = vscode.commands.registerCommand('csharp.listProcess', () => attacher.ShowAttachEntries());

    return vscode.Disposable.from(d1, d2, d3, d4, d5, d6, d7, d8);
}

function pickProjectAndStart(server: OmnisharpServer) {

    return findLaunchTargets().then(targets => {

        let currentPath = server.getSolutionPathOrFolder();
        if (currentPath) {
            for (let target of targets) {
                if (target.target.fsPath === currentPath) {
                    target.label = `\u2713 ${target.label}`;
                }
            }
        }

        return vscode.window.showQuickPick(targets, {
            matchOnDescription: true,
            placeHolder: `Select 1 of ${targets.length} projects`
        }).then(target => {
            if (target) {
                return server.restart(target.target.fsPath);
            }
        });
    });
}

interface Command {
    label: string;
    description: string;
    execute(): Thenable<any>;
}

function projectsToCommands(projects: protocol.DotNetProject[]): Promise<Command>[] {
    return projects.map(project => {
        let projectDirectory = project.Path;

        return fs.lstatAsync(projectDirectory).then(stats => {
            if (stats.isFile()) {
                projectDirectory = path.dirname(projectDirectory);
            }

            return {
                label: `dotnet restore - (${project.Name || path.basename(project.Path)})`,
                description: projectDirectory,
                execute() {
                    return runDotnetRestore(projectDirectory);
                }
            };
        });
    });
}

export function dotnetRestoreAllProjects(server: OmnisharpServer) {

    if (!server.isRunning()) {
        return Promise.reject('OmniSharp server is not running.');
    }

    return serverUtils.requestWorkspaceInformation(server).then(info => {

        if (!('DotNet in info') || info.DotNet.Projects.length < 1) {
            return Promise.reject("No .NET Core projects found");
        }

        let commandPromises = projectsToCommands(info.DotNet.Projects);

        return Promise.all(commandPromises).then(commands => {
            return vscode.window.showQuickPick(commands);
        }).then(command => {
            if (command) {
                return command.execute();
            }
        });
    });
}

export function dotnetRestoreForProject(server: OmnisharpServer, fileName: string) {

    if (!server.isRunning()) {
        return Promise.reject('OmniSharp server is not running.');
    }

    return serverUtils.requestWorkspaceInformation(server).then(info => {

        if (!('DotNet in info') || info.DotNet.Projects.length < 1) {
            return Promise.reject("No .NET Core projects found");
        }

        let directory = path.dirname(fileName);

        for (let project of info.DotNet.Projects) {
            if (project.Path === directory) {
                return runDotnetRestore(directory, fileName);
            }
        }
    });
}

function runDotnetRestore(cwd: string, fileName?: string) {
    return new Promise<cp.ChildProcess>((resolve, reject) => {
        channel.clear();
        channel.show();

        let cmd = 'dotnet restore';
        if (fileName) {
            cmd = `${cmd} "${fileName}"`
        }

        return cp.exec(cmd, { cwd: cwd, env: process.env }, (err, stdout, stderr) => {
            channel.append(stdout.toString());
            channel.append(stderr.toString());
            if (err) {
                channel.append('ERROR: ' + err);
            }
        });
    });
}