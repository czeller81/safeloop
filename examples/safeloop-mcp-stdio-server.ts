#!/usr/bin/env node
/**
 * SafeLoop MCP stdio Server Entrypoint
 *
 * Start this server for MCP host integration:
 *   npx ts-node examples/safeloop-mcp-stdio-server.ts
 *
 * MCP host config (mcpServers):
 *   {
 *     "safeloop": {
 *       "command": "npx",
 *       "args": ["ts-node", "examples/safeloop-mcp-stdio-server.ts"],
 *       "cwd": "/path/to/safeloop"
 *     }
 *   }
 */

import { startStdioServer } from '../src/mcp/stdioServer';
import { createMcpGateway } from '../src/mcp';

const gateway = createMcpGateway({
  defaultAgentId: 'mcp-host',
  defaultAgentName: 'MCP Host',
  defaultCaseId: 'mcp-session',
});

startStdioServer(gateway);
