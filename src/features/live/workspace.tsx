"use client";
import { useEffect, useState, useCallback } from "react";
import { z } from "zod";
import { workspaceSchema, type LiveWorkspace } from "./contracts";
const responseError = z.object({ error: z.object({ message: z.string() }) });
export async function request(
  path: string,
  method = "GET",
  input?: unknown,
): Promise<unknown> {
  const response = await fetch(`/api/v1/${path}/`, {
    method,
    headers: input ? { "Content-Type": "application/json" } : undefined,
    body: input ? JSON.stringify(input) : undefined,
    cache: "no-store",
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/login/");
    throw new Error(
      responseError.safeParse(value).data?.error.message ||
        "ไม่สามารถบันทึกข้อมูลได้",
    );
  }
  return z.object({ data: z.unknown() }).parse(value).data;
}
export function useLiveWorkspace() {
  const [data, setData] = useState<LiveWorkspace | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const [rooms, tenants, leases, floors, properties] = await Promise.all(
        ["rooms", "tenants", "leases", "floors", "properties"].map((path) =>
          request(path),
        ),
      );
      setData(
        workspaceSchema.parse({ rooms, tenants, leases, floors, properties }),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สามารถโหลดข้อมูลได้");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}
export const baht = (value: string) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
