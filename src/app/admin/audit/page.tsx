"use client";

import { useEffect, useState } from "react";

import { apiFetch, readPublicMessage } from "@/lib/api/browser";

type AuditEvent = {
  id: string;
  action: string;
  outcome: string;
  endpoint: string;
  userId: string | null;
  createdAt: string | null;
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/admin/audit", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(readPublicMessage(body) ?? "Kayıtlar alınamadı.");
          return;
        }
        setEvents(Array.isArray(body?.events) ? body.events : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-500">Rol, fiyat ve sağlayıcı bakiye olayları.</p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {events.map((event) => (
          <li key={event.id} className="px-4 py-3 text-sm">
            <p className="font-medium text-slate-950">
              {event.action} · {event.outcome}
            </p>
            <p className="text-xs text-slate-500">
              {event.createdAt ?? "—"} · {event.endpoint}
            </p>
          </li>
        ))}
        {events.length === 0 && !error ? <li className="px-4 py-6 text-sm text-slate-500">Kayıt yok.</li> : null}
      </ul>
    </section>
  );
}
