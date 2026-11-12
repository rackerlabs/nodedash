/*
Copyright 2026 Rackspace Technology.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { useQuery } from '@tanstack/react-query';
import {
  SENSOR_TYPES,
  healthTone,
  isHealthStale,
  isSensorFault,
  logSeverityTone,
  type NodeHealth,
  type SensorReading,
} from '@nodedash/shared';
import { Activity, HeartPulse, ScrollText, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, Progress, Skeleton } from '@/components/ui/misc';
import { Hint } from '@/components/ui/tooltip';
import { api } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { formatTimestamp, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';
import { ErrorPanel } from '../status';
import { useNodeContext } from './context';

/** Health is read from the BMC and cached, so it is polled gently. */
const HEALTH_POLL_MS = 60_000;

export function NodeHealthPage() {
  const { node, row } = useNodeContext();

  const query = useQuery({
    queryKey: qk.health(row.uuid),
    queryFn: () => api.health(row.uuid),
    refetchInterval: HEALTH_POLL_MS,
    staleTime: 30_000,
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <Empty
        icon={<HeartPulse />}
        title="Health is not available on this deployment"
        description="Ironic reads BMC sensor data but does not expose it over REST yet. See docs/ironic-api-gaps.md item 6."
      />
    );
  }

  const health = query.data!;
  if (!health.supported) {
    return (
      <Empty
        icon={<HeartPulse />}
        title="This node cannot report structured health"
        description={`Health readings come from Redfish. This node uses the ${
          node.driver ?? 'unknown'
        } driver, which cannot report them.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <HealthSummary health={health} />
      <SensorGrid sensors={health.sensors} />
      <EventLogs uuid={row.uuid} />
    </div>
  );
}

function HealthSummary({ health }: { health: NodeHealth }) {
  const now = useNow(30_000);
  const stale = isHealthStale(health.collected_at, now);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="size-4" />
          Overall
          <Badge tone={healthTone(health.status)}>{health.status}</Badge>
        </CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">
          {health.source ? <span className="font-mono">{health.source}</span> : null}
          {health.collected_at ? (
            // Say when this was read: presenting a cached BMC reading as live is
            // worse than presenting a stale one honestly.
            <Hint label={formatTimestamp(health.collected_at)}>
              <span className={cn('ml-2', stale && 'text-warning')}>
                read {relativeTime(health.collected_at, now)}
                {stale ? ' — stale' : ''}
              </span>
            </Hint>
          ) : (
            <span className="ml-2">never read</span>
          )}
        </span>
      </CardHeader>
      <CardContent>
        {health.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">The conductor reported no individual checks.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.checks.map((check) => (
              <div
                key={check.id}
                className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
              >
                <Badge tone={healthTone(check.status)} className="shrink-0">
                  {check.status}
                </Badge>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{check.label}</span>
                  {check.detail ? (
                    <span className="block text-xs text-muted-foreground">{check.detail}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SensorGrid({ sensors }: { sensors: SensorReading[] }) {
  const grouped = useMemo(() => {
    const byType = new Map<string, SensorReading[]>();
    for (const sensor of sensors) {
      const list = byType.get(sensor.type) ?? [];
      list.push(sensor);
      byType.set(sensor.type, list);
    }
    // Known Redfish categories first, in a stable order, then anything unexpected.
    const ordered = [...SENSOR_TYPES].filter((type) => byType.has(type));
    for (const type of byType.keys()) {
      if (!ordered.includes(type as (typeof SENSOR_TYPES)[number])) {
        ordered.push(type as (typeof SENSOR_TYPES)[number]);
      }
    }
    return ordered.map((type) => [type, byType.get(type)!] as const);
  }, [sensors]);

  if (sensors.length === 0) {
    return (
      <Empty
        icon={<Activity />}
        title="No sensor readings"
        description="The conductor has no cached sensor data for this node."
      />
    );
  }

  const faults = sensors.filter((sensor) => isSensorFault(sensor.state));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" />
          Sensors
        </CardTitle>
        {faults.length > 0 ? (
          <Badge tone="error" className="gap-1">
            <TriangleAlert className="size-3" />
            {faults.length} out of range
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {grouped.map(([type, readings]) => (
          <div key={type} className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{type}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {readings.map((sensor) => (
                <SensorCard key={sensor.name} sensor={sensor} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SensorCard({ sensor }: { sensor: SensorReading }) {
  const absent = sensor.state === 'absent';
  const fault = isSensorFault(sensor.state);

  // Fans fail low and everything else fails high, so the bar is scaled against
  // whichever threshold actually means trouble.
  const ceiling = sensor.threshold_critical ?? sensor.threshold_warning ?? null;
  const isLowFail = sensor.type === 'Fan';
  const percent =
    sensor.reading === null || sensor.reading === undefined || ceiling === null || isLowFail
      ? null
      : Math.min(100, (sensor.reading / ceiling) * 100);

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        fault ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card/40',
        absent && 'opacity-60',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium" title={sensor.name}>
          {sensor.name}
        </span>
        <span className={cn('tabular text-sm', fault && 'text-destructive')}>
          {absent || sensor.reading === null || sensor.reading === undefined
            ? '—'
            : `${sensor.reading}${sensor.units ? ` ${sensor.units}` : ''}`}
        </span>
      </div>

      {percent !== null ? <Progress value={percent} className="mt-2 h-1" label={sensor.name} /> : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {absent ? (
          // Not a fault: an empty bay reporting absent is normal, and flagging it
          // as a problem teaches operators to ignore this page.
          <span>not present</span>
        ) : fault ? (
          <Badge tone={sensor.state === 'critical' ? 'error' : 'transient'}>{sensor.state}</Badge>
        ) : null}
        {sensor.physical_context ? <span>{sensor.physical_context}</span> : null}
        {sensor.threshold_critical !== null && sensor.threshold_critical !== undefined && !absent ? (
          <span>
            {isLowFail ? 'min' : 'max'} {sensor.threshold_critical}
            {sensor.units ? ` ${sensor.units}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const SEVERITY_OPTIONS = ['All', 'Critical', 'Warning', 'OK'] as const;

/**
 * The BMC's own event logs — Dell's SEL and Lifecycle Controller log. Read-only on
 * purpose: clearing a SEL destroys the hardware's record of what went wrong.
 */
function EventLogs({ uuid }: { uuid: string }) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<(typeof SEVERITY_OPTIONS)[number]>('All');
  const now = useNow(30_000);

  const services = useQuery({
    queryKey: qk.logServices(uuid),
    queryFn: () => api.logServices(uuid),
    staleTime: 5 * 60_000,
  });

  const active = serviceId ?? services.data?.log_services[0]?.id ?? null;

  const entries = useQuery({
    queryKey: qk.logEntries(uuid, active ?? '', severity === 'All' ? null : severity),
    queryFn: () => api.logEntries(uuid, active!, { severity: severity === 'All' ? undefined : severity }),
    enabled: active !== null,
    staleTime: 60_000,
  });

  if (services.isPending) return <Skeleton className="h-48 w-full" />;
  if (services.isError || !services.data?.supported || services.data.log_services.length === 0) {
    return (
      <Empty
        icon={<ScrollText />}
        title="BMC event logs are not available"
        description="The Redfish LogService resources are not exposed through Ironic yet. See docs/ironic-api-gaps.md items 7 and 8."
      />
    );
  }

  const service = services.data.log_services.find((candidate) => candidate.id === active);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4" />
          BMC event log
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {services.data.log_services.map((candidate) => (
              <Button
                key={candidate.id}
                size="sm"
                variant={candidate.id === active ? 'secondary' : 'ghost'}
                onClick={() => setServiceId(candidate.id)}
              >
                {candidate.name}
                {candidate.entry_count ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{candidate.entry_count}</span>
                ) : null}
              </Button>
            ))}
          </div>
          <div className="ml-auto">
            <SegmentedFilter
              options={SEVERITY_OPTIONS}
              value={severity}
              onChange={setSeverity}
              label="Filter by severity"
            />
          </div>
        </div>
        {service?.description ? (
          <p className="text-xs text-muted-foreground">{service.description}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {entries.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : entries.isError ? (
          <ErrorPanel
            title="Could not read the event log"
            error={entries.error}
            onRetry={() => void entries.refetch()}
          />
        ) : entries.data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries match this filter.</p>
        ) : (
          <ol className="space-y-1.5">
            {entries.data.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-card/40 px-3 py-2 text-sm"
              >
                <Badge tone={logSeverityTone(entry.severity)} className="shrink-0">
                  {entry.severity ?? 'unknown'}
                </Badge>
                <span className="min-w-0 flex-1">{entry.message}</span>
                {entry.message_id ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {entry.message_id}
                  </span>
                ) : null}
                {/* Absent means the BMC did not say, which is not the same as unresolved. */}
                {entry.resolved === true ? <Badge tone="active">resolved</Badge> : null}
                <Hint label={formatTimestamp(entry.created)}>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(entry.created, now)}
                  </span>
                </Hint>
              </li>
            ))}
          </ol>
        )}
        {entries.data?.next ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the most recent {entries.data.entries.length} entries; the log holds more.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
