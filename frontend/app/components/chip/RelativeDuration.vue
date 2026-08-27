<template>
  <div class="d-flex flex-column align-center">
    <!-- `max-width: 100%` is what makes this work on a phone. The bar is 200px
         wide and `EmploymentHistory` draws it below the row's text there, i.e.
         inside `.v-list-item__content`, which Vuetify gives `overflow: hidden`
         and which measures about 162px at 390px and 92px at 320px. Centred and
         uncapped, the track was cut on both sides - and the green segment of a
         post somebody still holds sits at the right-hand end, so exactly the
         relations that matter drew nothing at all. The desktop copy in the
         row's append slot has room for the full 200px and is unaffected. -->
    <div
      class="relative-duration-wrapper bg-surface-variant rounded-pill flex-shrink-0"
      style="
        height: 6px;
        width: 200px;
        max-width: 100%;
        position: relative;
        overflow: hidden;
      "
    >
      <div
        class="bg-success rounded-pill"
        :style="{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `calc(min(${leftPercent}%, 100% - 6px))`,
          width: `${widthPercent}%`,
          minWidth: '6px',
        }"
      />
    </div>
    <span class="text-caption">{{ description }}</span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";

const props = defineProps<{
  start: string | undefined;
  end: string | undefined;
  minStart: string | undefined;
  maxEnd: string | undefined;
}>();

const description = computed(() => {
  // Both ends are optional - an edge entered through the editor may carry no
  // date at all - so neither may be interpolated unguarded. "obecnie" is only
  // right for the end: a missing start is unknown, not today.
  if (!props.start && !props.end) {
    return "";
  }
  if (props.start && props.end && props.start == props.end) {
    return props.start;
  }
  return `${props.start ?? "?"} - ${props.end || "obecnie"}`;
});

const parseDate = (d: string | undefined, fallback: number) => {
  if (!d) return fallback;
  const date = new Date(d);
  if (isNaN(date.getTime())) return fallback;
  return date.getTime();
};

const leftPercent = computed(() => {
  const now = Date.now();
  // Assume one year default duration if min/max are missing entirely
  const defaultMin = now - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now);
  const start = parseDate(props.start, min); // if no start, it starts from min

  if (min >= max) return 0;

  const offset = start - min;
  return Math.max(0, Math.min(100, (offset / (max - min)) * 100));
});

const widthPercent = computed(() => {
  const now = Date.now();
  const defaultMin = now - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now);

  const start = parseDate(props.start, min);
  const end = parseDate(props.end, now); // if no end, it goes to now

  if (min >= max) return 100;

  const width = end - start;
  return Math.max(0, Math.min(100, (width / (max - min)) * 100));
});
</script>
