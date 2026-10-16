export class CDPError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CDPError';
  }
}
export class CDPNavigationError extends CDPError {
  constructor(msg: string) {
    super(msg);
    this.name = 'CDPNavigationError';
  }
}
/** The DevTools connection is gone; the message says who closed it and what was refused. */
export class CDPTargetClosedError extends CDPError {
  constructor(msg: string) {
    super(msg);
    this.name = 'CDPTargetClosedError';
  }
}
