import { workspace, type ExtensionContext } from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
    const override = workspace.getConfiguration("propsec").get<string>("serverPath");
    const serverModule = override && override.trim().length > 0
        ? override
        : context.asAbsolutePath("dist/server.js");

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.stdio },
        debug: { module: serverModule, transport: TransportKind.stdio },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "markdown" }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher("**/propsec.config.json"),
        },
    };

    client = new LanguageClient("propsec", "Propsec", serverOptions, clientOptions);
    void client.start();

    // Disposing the client stops the server (v9 start/stop are async).
    context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
