/**
 * Formats Pi engine errors into user-readable messages.
 *
 * Centralises the MLX tree_reduce bug detection so both the parent engine
 * and the delegate tool produce consistent error messages.
 */

/**
 * Format a Pi SDK error into a user-readable message.
 * Provides a clear hint for the known LM Studio MLX backend bug.
 */
export function formatPiError(err: Error): string {
  if (err.message.includes("tree_reduce")) {
    return (
      `LM Studio MLX backend error: '${err.message}'. ` +
      "This is a known bug in MLX models with conversation history. " +
      "Switch to a GGUF model (llama.cpp backend) in LM Studio to fix this."
    );
  }
  return err.message;
}
