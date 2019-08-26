export class PollerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PollerError';
  }
}
