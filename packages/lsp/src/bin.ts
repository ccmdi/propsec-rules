#!/usr/bin/env -S npx tsx
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "./server.js";

// Stdio transport (reads --stdio etc. from argv). The editor launches this binary.
const connection = createConnection(ProposedFeatures.all);
startServer(connection);
