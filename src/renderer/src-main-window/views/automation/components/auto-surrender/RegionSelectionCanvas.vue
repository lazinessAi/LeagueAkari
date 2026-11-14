<template>
  <div
    ref="canvas"
    class="region-canvas"
    :class="{ 'region-canvas--interactive': interactive }"
    :style="{ aspectRatio, '--region-accent': themeVars.primaryColor }"
    :tabindex="interactive ? 0 : undefined"
    role="group"
    :aria-label="t('automation.misc.autoSurrender.region.canvasLabel')"
    @pointerdown="startDrag"
    @pointermove="updateDrag"
    @pointerup="finishDrag"
    @pointercancel="cancelDrag"
    @lostpointercapture="cancelDrag"
    @keydown="handleKeydown"
  >
    <div class="region-schematic" aria-hidden="true">
      <div class="region-grid" />
      <div class="region-chat"><span /><span /><span /><span /></div>
      <div class="region-hud"><span /><span /><span /><span /></div>
      <div class="region-minimap" />
    </div>
    <span class="region-caption">
      {{ t('automation.misc.autoSurrender.region.schematic') }}
    </span>
    <div
      class="region-selection"
      data-drag="move"
      :style="{
        left: `${region.x}%`,
        top: `${region.y}%`,
        width: `${region.width}%`,
        height: `${region.height}%`
      }"
    >
      <span class="region-selection-label">{{
        t('automation.misc.autoSurrender.region.label')
      }}</span>
      <template v-if="interactive">
        <span
          v-for="corner in corners"
          :key="corner"
          class="region-handle"
          :class="`region-handle--${corner}`"
          :data-drag="corner"
          aria-hidden="true"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AutoSurrenderRegion } from '@shared/shards/auto-misc/auto-surrender'
import { useTranslation } from 'i18next-vue'
import { useThemeVars } from 'naive-ui'
import { useTemplateRef } from 'vue'

import { moveSelection, selectionFromPoints, type RegionPoint } from './region-selection'

const {
  region,
  aspectRatio = 16 / 9,
  interactive = true
} = defineProps<{
  region: AutoSurrenderRegion
  aspectRatio?: number
  interactive?: boolean
}>()
const emit = defineEmits<{ 'update:region': [region: AutoSurrenderRegion] }>()
const { t } = useTranslation()
const themeVars = useThemeVars()
const canvas = useTemplateRef('canvas')
const corners = ['nw', 'ne', 'sw', 'se'] as const
type DragMode = (typeof corners)[number] | 'draw' | 'move'
let drag: {
  pointerId: number
  mode: DragMode
  start: RegionPoint
  original: AutoSurrenderRegion
  anchor: RegionPoint
} | null = null

function point(event: PointerEvent): RegionPoint {
  const element = canvas.value!
  const rect = element.getBoundingClientRect()
  const scaleX = rect.width / element.offsetWidth
  const scaleY = rect.height / element.offsetHeight
  return {
    x: (((event.clientX - rect.left) / scaleX - element.clientLeft) / element.clientWidth) * 100,
    y: (((event.clientY - rect.top) / scaleY - element.clientTop) / element.clientHeight) * 100
  }
}

function startDrag(event: PointerEvent) {
  if (!interactive || event.button !== 0 || !event.isPrimary || drag) return
  event.preventDefault()
  const mode = ((event.target as HTMLElement).closest<HTMLElement>('[data-drag]')?.dataset.drag ??
    'draw') as DragMode
  const start = point(event)
  drag = {
    pointerId: event.pointerId,
    mode,
    start,
    original: { ...region },
    anchor: {
      x: mode.includes('w') ? region.x + region.width : region.x,
      y: mode.includes('n') ? region.y + region.height : region.y
    }
  }
  canvas.value!.focus({ preventScroll: true })
  canvas.value!.setPointerCapture(event.pointerId)
}

function updateDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const end = point(event)
  const delta = { x: end.x - drag.start.x, y: end.y - drag.start.y }
  // A click on the preview should not replace the selection with a tiny rectangle.
  if (drag.mode === 'draw' && Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return
  emit(
    'update:region',
    drag.mode === 'move'
      ? moveSelection(drag.original, delta)
      : selectionFromPoints(drag.mode === 'draw' ? drag.start : drag.anchor, end)
  )
}

function finishDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  updateDrag(event)
  drag = null
  canvas.value!.releasePointerCapture(event.pointerId)
}

function cancelDrag() {
  if (!drag) return
  const { original, pointerId } = drag
  drag = null
  emit('update:region', original)
  if (canvas.value?.hasPointerCapture(pointerId)) canvas.value.releasePointerCapture(pointerId)
}

function handleKeydown(event: KeyboardEvent) {
  if (!interactive) return
  if (event.key === 'Escape' && drag) {
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
    return
  }
  const delta = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  }[event.key]
  if (!delta) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 1
  emit('update:region', moveSelection(region, { x: delta.x * step, y: delta.y * step }))
}
</script>

<style scoped>
.region-canvas {
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  width: 100%;
  overflow: hidden;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.16);
  border-radius: 8px;
  background: var(--la-card-muted-surface);
  user-select: none;
}

.region-canvas--interactive {
  cursor: crosshair;
  touch-action: none;
}

.region-canvas:focus-visible {
  outline: 2px solid var(--region-accent);
  outline-offset: 3px;
}

.region-schematic {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.region-schematic {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 55% 45%,
    rgb(var(--la-card-tint-rgb) / 0.08),
    transparent 70%
  );
}

.region-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      to right,
      transparent calc(50% - 0.5px),
      rgb(var(--la-card-border-rgb) / 0.12) 50%,
      transparent calc(50% + 0.5px)
    ),
    linear-gradient(
      to bottom,
      transparent calc(50% - 0.5px),
      rgb(var(--la-card-border-rgb) / 0.12) 50%,
      transparent calc(50% + 0.5px)
    );
}

.region-chat {
  position: absolute;
  bottom: 12%;
  left: 4%;
  display: flex;
  width: 28%;
  flex-direction: column;
  gap: 5px;
}

.region-chat span {
  height: 3px;
  border-radius: 2px;
  background: rgb(var(--la-card-tint-rgb) / 0.24);
}

.region-chat span:nth-child(even) {
  width: 75%;
}

.region-hud {
  position: absolute;
  bottom: 4%;
  left: 38%;
  display: flex;
  width: 24%;
  height: 10%;
  gap: 4px;
}

.region-hud span,
.region-minimap {
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.16);
  border-radius: 3px;
  background: rgb(var(--la-card-tint-rgb) / 0.08);
}

.region-hud span {
  flex: 1;
}

.region-minimap {
  position: absolute;
  right: 3%;
  bottom: 4%;
  width: 13%;
  aspect-ratio: 1;
}

.region-caption {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--la-card-surface-90);
  color: var(--la-color-text-primary);
  font-size: 11px;
  line-height: 16px;
  pointer-events: none;
}

.region-selection {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--region-accent);
  background: color-mix(in srgb, var(--region-accent) 14%, transparent);
  box-shadow: 0 0 0 2000px rgb(0 0 0 / 0.24);
}

.region-canvas--interactive .region-selection {
  cursor: move;
}

.region-selection-label {
  position: absolute;
  top: 6px;
  left: 6px;
  max-width: calc(100% - 12px);
  overflow: hidden;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--la-card-surface-95);
  color: var(--la-color-text-primary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}

.region-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--region-accent);
  border-radius: 2px;
  background: var(--la-card-surface-95);
}

.region-handle::after {
  position: absolute;
  inset: -5px;
  content: '';
}

.region-handle--nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}
.region-handle--ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}
.region-handle--sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}
.region-handle--se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}
</style>
