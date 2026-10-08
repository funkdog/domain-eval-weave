export class DomainCompilerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly locator?: string,
  ) {
    super(locator === undefined ? message : `${message} (${locator})`);
    this.name = "DomainCompilerError";
  }
}
