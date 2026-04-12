import { ref, watch, onUnmounted, type Ref } from "vue";

/**
 * Typewriter composable — smoothly reveals text using requestAnimationFrame.
 *
 * Instead of showing all tokens the instant they arrive (which looks batchy
 * due to Vue reactivity coalescing), this reveals characters at a steady
 * visual pace, creating the familiar "typing" effect used by VS Code Copilot,
 * ChatGPT, and other LLM UIs.
 *
 * @param source     Reactive getter for the full (accumulated) content string.
 * @param streaming  Reactive getter for whether the block is still receiving tokens.
 * @returns          A ref containing the currently-revealed portion of the text.
 */
export function useTypewriter(
  source: () => string,
  streaming: () => boolean,
): Ref<string> {
  const displayed = ref(source());
  let cursor = displayed.value.length;
  let rafId = 0;

  // Base chars per frame at 60fps → ~240 chars/sec.
  // Adaptive: speeds up when the buffer grows to avoid falling behind.
  const BASE_RATE = 4;

  function tick() {
    const full = source();
    const pending = full.length - cursor;

    if (pending <= 0) {
      // Fully caught up — park until new content arrives
      rafId = 0;
      if (!streaming()) {
        displayed.value = full;
      }
      return;
    }

    // Adaptive rate: base rate when buffer is small, scales up to prevent lag.
    const rate = Math.max(BASE_RATE, Math.ceil(pending / 6));
    cursor = Math.min(cursor + rate, full.length);
    displayed.value = full.slice(0, cursor);

    rafId = requestAnimationFrame(tick);
  }

  // Watch both source and streaming flag — restart animation when new text arrives
  // or snap when streaming finishes.
  watch(
    [source, streaming],
    () => {
      const full = source();

      if (!streaming()) {
        // Done streaming — snap to final content immediately
        cancelAnimationFrame(rafId);
        rafId = 0;
        cursor = full.length;
        displayed.value = full;
        return;
      }

      // New content arrived while streaming — kick the animation if idle
      if (cursor < full.length && !rafId) {
        rafId = requestAnimationFrame(tick);
      }
    },
    { flush: "post" },
  );

  onUnmounted(() => {
    cancelAnimationFrame(rafId);
  });

  return displayed;
}
