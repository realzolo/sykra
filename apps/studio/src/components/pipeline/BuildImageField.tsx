"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Dictionary } from "@/i18n";
import {
  BUILD_IMAGE_PRESETS,
  CUSTOM_BUILD_IMAGE_PRESET_ID,
  describeBuildImagePreset,
  getBuildImagePresetByImage,
} from "@/services/buildImageCatalog";

type Props = {
  dict: Dictionary["pipelines"]["basic"];
  buildImage: string;
  required?: boolean;
  onChange: (patch: { buildImage: string }) => void;
};

export default function BuildImageField({
  dict,
  buildImage,
  required = false,
  onChange,
}: Props) {
  const inferredPreset = getBuildImagePresetByImage(buildImage);
  const [customMode, setCustomMode] = useState(false);
  const selectValue = customMode ? CUSTOM_BUILD_IMAGE_PRESET_ID : inferredPreset?.id ?? CUSTOM_BUILD_IMAGE_PRESET_ID;

  return (
    <div className="max-w-2xl space-y-3">
      <div className="space-y-1.5">
        <label className="text-[13px] font-medium text-foreground">
          {dict.buildImage}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        <Select
          value={selectValue}
          onValueChange={(value) => {
            if (value === CUSTOM_BUILD_IMAGE_PRESET_ID) {
              setCustomMode(true);
              onChange({ buildImage });
              return;
            }
            const preset = BUILD_IMAGE_PRESETS.find((item) => item.id === value);
            if (!preset) return;
            setCustomMode(false);
            onChange({
              buildImage: preset.image,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={dict.buildImagePresetPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {BUILD_IMAGE_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_BUILD_IMAGE_PRESET_ID}>
              {dict.buildImagePresetCustom}
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
          {dict.buildImagePresetHelp}
        </div>
      </div>

      {selectValue === CUSTOM_BUILD_IMAGE_PRESET_ID ? (
        <div className="space-y-1.5">
          <Input
            value={buildImage}
            onChange={(event) =>
              onChange({
                buildImage: event.target.value,
              })
            }
            placeholder={dict.buildImagePlaceholder}
          />
          <div className="text-[12px] text-[hsl(var(--ds-text-2))]">
            {dict.buildImageHelp}
          </div>
        </div>
      ) : inferredPreset ? (
        <div className="rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-muted/20 px-3 py-2">
          <div className="text-[13px] font-medium text-foreground">
            {describeBuildImagePreset(inferredPreset)}
          </div>
          <div className="mt-0.5 text-[12px] text-[hsl(var(--ds-text-2))]">
            {inferredPreset.description}
          </div>
        </div>
      ) : null}
    </div>
  );
}
