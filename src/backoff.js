export function backoff(base_backoff_seconds, receive_count, backoff_multipliers, max_backoff_seconds) {
  const end_index = Math.min(receive_count, backoff_multipliers.length);
  const backoff_seconds = backoff_multipliers.slice(0, end_index)
      .reduce((acc, multiplier) => {
        return acc * multiplier;
      }, base_backoff_seconds);
  return Math.min(backoff_seconds, max_backoff_seconds);
}
