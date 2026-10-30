import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AgendaEvent, BillingSection, Circuit, CircuitSummary, Client, Driver, Settings } from '@taxi-crm/domain';
import { useMemo } from 'react';
import { useSession } from '../session.tsx';
import { api } from './client.ts';

const REFRESH_MS = 30_000;

export const useDrivers = () =>
  useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get<Driver[]>('/api/drivers'),
    initialData: [] as Driver[],
    initialDataUpdatedAt: 0,
  });

export const useEvents = (from: string, to: string) =>
  useQuery({
    queryKey: ['events', from, to],
    queryFn: () => api.get<AgendaEvent[]>(`/api/events?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });

export function useFlagged() {
  const { isAdmin } = useSession();
  return useQuery({
    queryKey: ['events', 'flagged'],
    queryFn: () => api.get<AgendaEvent[]>('/api/events/flagged'),
    enabled: isAdmin,
    refetchInterval: REFRESH_MS,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Partial<Settings> & { companyName: string }>('/api/settings'),
  });
}

export function useCircuits() {
  return useQuery({
    queryKey: ['circuits'],
    queryFn: () => api.get<(Circuit | CircuitSummary)[]>('/api/circuits'),
    refetchInterval: REFRESH_MS,
  });
}

export const isFullCircuit = (c: Circuit | CircuitSummary): c is Circuit => 'config' in c;

export function useFullCircuits(): Circuit[] {
  const { data } = useCircuits();
  return useMemo(() => (data ?? []).filter(isFullCircuit), [data]);
}

export interface CircuitInfo extends CircuitSummary {
  full?: Circuit;
}
export type CircuitIndex = Map<string, CircuitInfo>;

/** Informations communes aux deux rôles ; `full` n'existe que pour le gérant. */
export function useCircuitIndex(): CircuitIndex {
  const { data } = useCircuits();
  return useMemo(() => {
    const index: CircuitIndex = new Map();
    for (const c of data ?? []) {
      if (isFullCircuit(c)) {
        index.set(c.id, {
          id: c.id,
          name: c.name,
          mode: c.mode,
          color: c.color,
          stops: c.config.stops,
          source: c.config.source,
          notes: c.config.notes,
          full: c,
        });
      } else {
        index.set(c.id, c);
      }
    }
    return index;
  }, [data]);
}

export function useClients() {
  const { isAdmin } = useSession();
  return useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<Client[]>('/api/clients'),
    enabled: isAdmin,
  });
}

export const useBilling = (month: string) =>
  useQuery({
    queryKey: ['billing', month],
    queryFn: () => api.get<BillingSection[]>(`/api/billing/${month}`),
    enabled: !!month,
  });
