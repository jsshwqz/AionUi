/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  ProjectExecutorCandidate,
  ProjectExecutorState,
  ProjectExecutorSwitchRecord,
  QueueProjectExecutorSwitchResult,
} from '@/common/projectAgentHandoff';
import { useCallback, useEffect, useMemo } from 'react';
import useSWR from 'swr';

type UseProjectAgentHandoffResult = {
  state?: ProjectExecutorState;
  candidates: ProjectExecutorCandidate[];
  availableCandidates: ProjectExecutorCandidate[];
  history: ProjectExecutorSwitchRecord[];
  pendingCandidate?: ProjectExecutorCandidate;
  isLoading: boolean;
  queueSwitch: (targetExecutorId: string) => Promise<QueueProjectExecutorSwitchResult>;
  cancelPendingSwitch: () => Promise<ProjectExecutorState>;
  refresh: () => Promise<void>;
};

const loadExecutorState = async (conversationId: string): Promise<ProjectExecutorState | undefined> => {
  const result = await ipcBridge.conversation.getProjectExecutorState.invoke({ conversation_id: conversationId });
  if (!result.success) {
    console.warn('[useProjectAgentHandoff] Failed to load executor state:', result.msg);
    return undefined;
  }
  return result.data;
};

const loadExecutorCandidates = async (conversationId: string): Promise<ProjectExecutorCandidate[]> => {
  const result = await ipcBridge.conversation.getProjectExecutorCandidates.invoke({ conversation_id: conversationId });
  if (!result.success || !result.data) {
    console.warn('[useProjectAgentHandoff] Failed to load executor candidates:', result.msg);
    return [];
  }
  return result.data;
};

const loadExecutorHistory = async (conversationId: string): Promise<ProjectExecutorSwitchRecord[]> => {
  const result = await ipcBridge.conversation.getProjectExecutorHistory.invoke({ conversation_id: conversationId });
  if (!result.success || !result.data) {
    console.warn('[useProjectAgentHandoff] Failed to load executor history:', result.msg);
    return [];
  }
  return result.data;
};

export const useProjectAgentHandoff = (conversationId?: string): UseProjectAgentHandoffResult => {
  const {
    data: state,
    isLoading: loadingState,
    mutate: mutateState,
  } = useSWR(
    conversationId ? ['project-agent-handoff', 'state', conversationId] : null,
    async ([, , id]: readonly [string, string, string]) => loadExecutorState(id),
    {
      revalidateOnFocus: false,
    }
  );
  const {
    data: candidates,
    isLoading: loadingCandidates,
    mutate: mutateCandidates,
  } = useSWR(
    conversationId ? ['project-agent-handoff', 'candidates', conversationId] : null,
    async ([, , id]: readonly [string, string, string]) => loadExecutorCandidates(id),
    {
      revalidateOnFocus: false,
    }
  );
  const {
    data: history,
    isLoading: loadingHistory,
    mutate: mutateHistory,
  } = useSWR(
    conversationId ? ['project-agent-handoff', 'history', conversationId] : null,
    async ([, , id]: readonly [string, string, string]) => loadExecutorHistory(id),
    {
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    return ipcBridge.conversation.projectExecutorChanged.on((event) => {
      if (event.conversationId !== conversationId) {
        return;
      }
      void mutateState();
      void mutateCandidates();
      void mutateHistory();
    });
  }, [conversationId, mutateCandidates, mutateHistory, mutateState]);

  const availableCandidates = useMemo(
    () => (candidates || []).filter((candidate) => candidate.available),
    [candidates]
  );

  const pendingCandidate = useMemo(() => {
    if (!state?.pendingExecutorId) {
      return undefined;
    }
    return (candidates || []).find((candidate) => candidate.id === state.pendingExecutorId);
  }, [candidates, state?.pendingExecutorId]);

  const refresh = useCallback(async () => {
    await Promise.all([mutateState(), mutateCandidates(), mutateHistory()]);
  }, [mutateCandidates, mutateHistory, mutateState]);

  const queueSwitch = useCallback(
    async (targetExecutorId: string): Promise<QueueProjectExecutorSwitchResult> => {
      if (!conversationId) {
        throw new Error('Conversation is required');
      }
      const result = await ipcBridge.conversation.queueProjectExecutorSwitch.invoke({
        conversation_id: conversationId,
        targetExecutorId,
      });
      if (!result.success || !result.data) {
        throw new Error(result.msg || 'queue switch failed');
      }
      await refresh();
      return result.data;
    },
    [conversationId, refresh]
  );

  const cancelPendingSwitch = useCallback(async (): Promise<ProjectExecutorState> => {
    if (!conversationId) {
      throw new Error('Conversation is required');
    }
    const result = await ipcBridge.conversation.cancelPendingProjectExecutorSwitch.invoke({
      conversation_id: conversationId,
    });
    if (!result.success || !result.data) {
      throw new Error(result.msg || 'cancel pending switch failed');
    }
    await refresh();
    return result.data;
  }, [conversationId, refresh]);

  return {
    state,
    candidates: candidates || [],
    availableCandidates,
    history: history || [],
    pendingCandidate,
    isLoading: loadingState || loadingCandidates || loadingHistory,
    queueSwitch,
    cancelPendingSwitch,
    refresh,
  };
};
