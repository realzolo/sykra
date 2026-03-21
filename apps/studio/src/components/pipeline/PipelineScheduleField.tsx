"use client";

import { useMemo } from "react";
import { Clock3, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClientDictionary } from "@/i18n/client";
import { formatLocalDateTime } from "@/lib/dateFormat";
import {
  detectPipelineSchedulePreset,
  getPipelineScheduleExpression,
  type PipelineSchedulePreset,
} from "@/services/pipelineTypes";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  nextScheduledAt?: string | null;
};

const PRESET_ORDER: PipelineSchedulePreset[] = ["hourly", "daily", "weekdays", "weekly"];
const DEFAULT_PRESET: PipelineSchedulePreset = "daily";

export default function PipelineScheduleField({
  value,
  onChange,
  disabled = false,
  nextScheduledAt,
}: Props) {
  const dict = useClientDictionary();
  const p = dict.pipelines;
  const enabled = value.trim().length > 0;
  const activePreset = useMemo(() => detectPipelineSchedulePreset(value), [value]);
  const isCustom = activePreset === "custom";

  function setSchedule(nextValue: string) {
    if (disabled) return;
    onChange(nextValue);
  }

  function toggleEnabled(nextEnabled: boolean) {
    if (disabled) return;
    if (!nextEnabled) {
      onChange("");
      return;
    }
    onChange(value.trim() || getPipelineScheduleExpression(DEFAULT_PRESET));
  }

  function applyPreset(preset: PipelineSchedulePreset) {
    setSchedule(getPipelineScheduleExpression(preset));
  }

  const scheduleLabel = p.schedule.disabled;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-4 rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-[13px] font-medium text-foreground">{p.basic.schedule}</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[hsl(var(--ds-text-2))] transition-colors hover:text-foreground"
                    aria-label={p.schedule.cronHelp}
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{p.schedule.cronHelp}</TooltipContent>
              </Tooltip>
            </div>
            <div className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.schedule.description}</div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-2.5 py-1.5">
            <span className="text-[12px] text-[hsl(var(--ds-text-2))]">{p.schedule.enabledLabel}</span>
            <Switch
              checked={enabled}
              onCheckedChange={toggleEnabled}
              disabled={disabled}
              aria-label={p.schedule.enabledLabel}
            />
          </div>
        </div>

        {!enabled ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-surface-1))] px-3 py-2 text-[12px] text-[hsl(var(--ds-text-2))]">
            <Clock3 className="size-3.5 shrink-0" />
            <span>{scheduleLabel}</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-foreground">{p.schedule.quickPresets}</div>
              <div className="flex flex-wrap gap-2">
                {PRESET_ORDER.map((preset) => {
                  const active = activePreset === preset;
                  return (
                    <Button
                      key={preset}
                      type="button"
                      variant={active ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => applyPreset(preset)}
                      disabled={disabled}
                      className={active ? "border-[hsl(var(--ds-border-2))]" : ""}
                    >
                      {p.schedule.presets[preset]}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-[13px] font-medium text-foreground">{p.schedule.cronLabel}</label>
                <div className="flex items-center gap-2">
                  {isCustom && (
                    <Badge variant="muted" size="sm">
                      {p.schedule.customPreset}
                    </Badge>
                  )}
                  <Badge variant="muted" size="sm">
                    {p.schedule.utc}
                  </Badge>
                </div>
              </div>
              <Input
                value={value}
                onChange={(event) => setSchedule(event.target.value)}
                placeholder={p.schedule.cronPlaceholder}
                disabled={disabled}
                className="font-mono"
              />
              <div className="flex items-start justify-between gap-3 text-[12px] text-[hsl(var(--ds-text-2))]">
                <span>{p.schedule.cronHelp}</span>
                {nextScheduledAt && (
                  <span className="shrink-0 whitespace-nowrap">
                    {p.detail.nextRun}:{" "}
                    <span className="text-foreground">{formatLocalDateTime(nextScheduledAt)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
