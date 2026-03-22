export type BuildImagePreset = {
  id: string;
  label: string;
  description: string;
  image: string;
  runtime: 'node' | 'python' | 'go' | 'java';
  version: string;
  os: string;
};

export const BUILD_IMAGE_PRESETS: BuildImagePreset[] = [
  {
    id: 'node-20',
    label: 'Node 20',
    description: 'LTS Node.js with Debian Bookworm base',
    image: 'node:20-bookworm',
    runtime: 'node',
    version: '20',
    os: 'bookworm',
  },
  {
    id: 'node-22',
    label: 'Node 22',
    description: 'Current Node.js with Debian Bookworm base',
    image: 'node:22-bookworm',
    runtime: 'node',
    version: '22',
    os: 'bookworm',
  },
  {
    id: 'python-3.11',
    label: 'Python 3.11',
    description: 'CPython 3.11 with Debian Bookworm base',
    image: 'python:3.11-bookworm',
    runtime: 'python',
    version: '3.11',
    os: 'bookworm',
  },
  {
    id: 'python-3.12',
    label: 'Python 3.12',
    description: 'CPython 3.12 with Debian Bookworm base',
    image: 'python:3.12-bookworm',
    runtime: 'python',
    version: '3.12',
    os: 'bookworm',
  },
  {
    id: 'go-1.23',
    label: 'Go 1.23',
    description: 'Go toolchain with Debian Bookworm base',
    image: 'golang:1.23-bookworm',
    runtime: 'go',
    version: '1.23',
    os: 'bookworm',
  },
  {
    id: 'go-1.24',
    label: 'Go 1.24',
    description: 'Go toolchain with Debian Bookworm base',
    image: 'golang:1.24-bookworm',
    runtime: 'go',
    version: '1.24',
    os: 'bookworm',
  },
  {
    id: 'java-17',
    label: 'Java 17',
    description: 'Temurin JDK 17 with Ubuntu Jammy base',
    image: 'eclipse-temurin:17-jdk-jammy',
    runtime: 'java',
    version: '17',
    os: 'jammy',
  },
  {
    id: 'java-21',
    label: 'Java 21',
    description: 'Temurin JDK 21 with Ubuntu Jammy base',
    image: 'eclipse-temurin:21-jdk-jammy',
    runtime: 'java',
    version: '21',
    os: 'jammy',
  },
];

export const CUSTOM_BUILD_IMAGE_PRESET_ID = 'custom';

export function getBuildImagePresetById(id?: string | null): BuildImagePreset | null {
  if (!id) return null;
  return BUILD_IMAGE_PRESETS.find((item) => item.id === id) ?? null;
}

export function getBuildImagePresetByImage(image?: string | null): BuildImagePreset | null {
  const normalized = image?.trim();
  if (!normalized) return null;
  return BUILD_IMAGE_PRESETS.find((item) => item.image === normalized) ?? null;
}

export function describeBuildImagePreset(preset: BuildImagePreset): string {
  return `${preset.label} · ${preset.image}`;
}
