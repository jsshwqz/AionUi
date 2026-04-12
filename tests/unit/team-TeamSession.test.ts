// tests/unit/team-TeamSession.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before any imports
// ---------------------------------------------------------------------------
const mockIpcBridge = vi.hoisted(() => ({
  team: {
    agentSpawned: { emit: vi.fn() },
    agentStatusChanged: { emit: vi.fn() },
    agentRemoved: { emit: vi.fn() },
    agentRenamed: { emit: vi.fn() },
  },
  acpConversation: {
    responseStream: { emit: vi.fn() },
  },
  conversation: {
    responseStream: { emit: vi.fn() },
  },
}));

const mockAddMessage = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({ ipcBridge: mockIpcBridge }));
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp') } }));
vi.mock('@process/utils/message', () => ({ addMessage: mockAddMessage }));
vi.mock('@process/agent/acp/AcpDetector', () => ({
  acpDetector: { getDetectedAgents: vi.fn(() => []) },
}));

import { TeamSession } from '@process/team/TeamSession';
import type { ITeamRepository } from '@process/team/repository/ITeamRepository';
import type { TTeam } from '@process/team/types';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(): ITeamRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMailboxByTeam: vi.fn(),
    deleteTasksByTeam: vi.fn(),
    writeMessage: vi.fn(),
    readUnread: vi.fn(),
    readUnreadAndMark: vi.fn(),
    markRead: vi.fn(),
    getMailboxHistory: vi.fn(),
    createTask: vi.fn(),
    findTaskById: vi.fn(),
    updateTask: vi.fn(),
    findTasksByTeam: vi.fn(),
    findTasksByOwner: vi.fn(),
    deleteTask: vi.fn(),
    appendToBlocks: vi.fn(),
    removeFromBlockedBy: vi.fn(),
  } as unknown as ITeamRepository;
}

function makeWorkerTaskManager(): IWorkerTaskManager {
  return {
    getOrBuildTask: vi.fn(),
    kill: vi.fn(),
  } as unknown as IWorkerTaskManager;
}

function makeTeam(overrides: Partial<TTeam> = {}): TTeam {
  return {
    id: 'team-1',
    name: 'Test Team',
    leadAgentId: 'slot-lead',
    agents: [
      {
        slotId: 'slot-lead',
        conversationId: 'conv-lead',
        role: 'lead',
        agentType: 'acp',
        agentName: 'Leader',
        conversationType: 'acp',
        status: 'idle',
      },
      {
        slotId: 'slot-member',
        conversationId: 'conv-member',
        role: 'teammate',
        agentType: 'acp',
        agentName: 'Worker',
        conversationType: 'acp',
        status: 'idle',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as TTeam;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dispose()', () => {
    it('kills all agent processes during dispose', async () => {
      const workerTaskManager = makeWorkerTaskManager();
      const session = new TeamSession(makeTeam(), makeRepo(), workerTaskManager);

      await session.dispose();

      // Both agents should have their processes killed
      expect(workerTaskManager.kill).toHaveBeenCalledWith('conv-lead');
      expect(workerTaskManager.kill).toHaveBeenCalledWith('conv-member');
      expect(workerTaskManager.kill).toHaveBeenCalledTimes(2);
    });

    it('cleans up listeners even if mcpServer.stop() throws', async () => {
      const workerTaskManager = makeWorkerTaskManager();
      const session = new TeamSession(makeTeam(), makeRepo(), workerTaskManager);

      // Start MCP server so mcpStdioConfig is set, then make stop() throw
      // Access private mcpServer via prototype trick
      const mcpServer = (session as unknown as { mcpServer: { stop: () => Promise<void>; start: () => Promise<unknown> } })
        .mcpServer;
      const originalStop = mcpServer.stop.bind(mcpServer);
      mcpServer.stop = vi.fn().mockRejectedValue(new Error('MCP stop failed'));

      // Listen for removeAllListeners being called
      const removeListenersSpy = vi.spyOn(session, 'removeAllListeners');

      // dispose should not throw even when mcpServer.stop fails
      await expect(session.dispose()).resolves.toBeUndefined();

      // removeAllListeners should still be called (try/finally)
      expect(removeListenersSpy).toHaveBeenCalled();

      removeListenersSpy.mockRestore();
    });

    it('skips kill for agents without conversationId', async () => {
      const workerTaskManager = makeWorkerTaskManager();
      const team = makeTeam({
        agents: [
          {
            slotId: 'slot-lead',
            conversationId: 'conv-lead',
            role: 'lead' as const,
            agentType: 'acp',
            agentName: 'Leader',
            conversationType: 'acp',
            status: 'idle' as const,
          },
          {
            slotId: 'slot-pending',
            conversationId: '',
            role: 'teammate' as const,
            agentType: 'acp',
            agentName: 'Pending',
            conversationType: 'acp',
            status: 'pending' as const,
          },
        ],
      });
      const session = new TeamSession(team, makeRepo(), workerTaskManager);

      await session.dispose();

      // Only the agent with conversationId should be killed
      expect(workerTaskManager.kill).toHaveBeenCalledWith('conv-lead');
      expect(workerTaskManager.kill).toHaveBeenCalledTimes(1);
    });
  });
});
