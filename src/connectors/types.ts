/**
 * SafeLoop Agent Connector Types
 *
 * Defines the interface for connecting external agents to SafeLoop.
 * Any agent can connect by implementing or using a connector.
 *
 * Core idea: Connect your agent. Guard its actions. Prove what happened.
 */

export type ConnectorId = 'hermes' | 'generic-cli' | string;

export interface AgentConnector {
  id: ConnectorId;
  name: string;
  /** Detect whether the agent runtime is present on this system */
  detect(): ConnectorDetectionResult;
  /** Report current connection status/mode */
  status(): ConnectorStatus;
  /** Verify the integration is working */
  verify(): ConnectorVerifyResult;
}

export interface ConnectorDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
  notes: string[];
}

export type ConnectorMode = 'observer' | 'preflight' | 'execute-wrapper' | 'unknown';

export interface ConnectorStatus {
  connected: boolean;
  mode: ConnectorMode;
  notes: string[];
}

export interface ConnectorVerifyResult {
  ok: boolean;
  checks: ConnectorCheck[];
}

export interface ConnectorCheck {
  name: string;
  ok: boolean;
  message: string;
}
