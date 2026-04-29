import { ref, watch, onUnmounted, type Ref } from "vue";

const WORDS_PER_TICK = 2;
const WORDS_PER_TICK_CATCHUP = 6;
const CATCHUP_THRESHOLD = 30;
const TICK_MS = 40;

/**
 * Animates `target` word-by-word into a `displayed` ref.
 *
 * - Only animates when `isLive` is true at call time (live streaming blocks).
 *   History blocks (already done at mount) return target directly — no animation.
 * - Flushes remaining words instantly when `isDone` flips to true.
 * - Cleans up the interval on component unmount.
 */
export function useTypewriter(
  target: Ref<string>,
  isDone: Ref<boolean>,
  isLive: boolean,
): { displayed: Ref<string> } {
  if (!isLive) {
    return { displayed: target };
  }

  const displayed = ref(target.value);
  // pos is a word-array index. Initialise past end so pre-existing content is
  // shown immediately (no animation for content already present at mount).
  let pos = target.value ? target.value.split(" ").length : 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function tick() {
    const words = target.value.split(" ");
    const remaining = words.length - pos;
    if (remaining <= 0) return;

    const step = remaining > CATCHUP_THRESHOLD ? WORDS_PER_TICK_CATCHUP : WORDS_PER_TICK;
    pos = Math.min(pos + step, words.length);
    displayed.value = words.slice(0, pos).join(" ");
  }

  function flush() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    displayed.value = target.value;
    pos = target.value.split(" ").length;
  }

  intervalId = setInterval(tick, TICK_MS);

  watch(isDone, (done) => {
    if (done) flush();
  });

  // Keep pos in sync when target changes.
  // - If pos >= wordCount: we are caught up to the word boundary — update
  //   displayed immediately (handles space-less token concatenation).
  // - If pos > wordCount: content shrank (shouldn't happen), clamp pos.
  // - If pos < wordCount: new words arrived, the ticker will animate them.
  watch(target, (val) => {
    const wordCount = val.split(" ").length;
    if (pos >= wordCount) {
      displayed.value = val;
      pos = wordCount;
    }
  });

  onUnmounted(() => {
    if (intervalId !== null) clearInterval(intervalId);
  });

  return { displayed };
}
