export function backoff(base_backoff_seconds: number, receive_count: number, backoff_multipliers: number[], max_backoff_seconds: number): number {
  const end_index = Math.min(receive_count, backoff_multipliers.length);
  const backoff_seconds = backoff_multipliers.slice(0, end_index).reduce((acc, multiplier) => acc * multiplier, base_backoff_seconds);
  return Math.min(backoff_seconds, max_backoff_seconds);
}
