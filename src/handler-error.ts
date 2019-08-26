export class HandlerError extends Error {
  public payload: object | undefined;
  public cause: Error | undefined;

  constructor(msg: string, cause?: Error, sqsPayload?: object) {
    super(msg);
    this.name = 'HandlerError';
    this.payload = sqsPayload;
    this.cause = cause;
  }
}
