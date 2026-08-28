export class ReservationLedger {
  static async open(_file: string, _capacity: number): Promise<ReservationLedger> {
    return new ReservationLedger();
  }
  async reserve(_request: { requestId: string; key: string; units: number }): Promise<never> {
    throw new Error("Not implemented");
  }
  async commit(_requestId: string): Promise<never> {
    throw new Error("Not implemented");
  }
  async release(_requestId: string): Promise<never> {
    throw new Error("Not implemented");
  }
  async snapshot(): Promise<never> {
    throw new Error("Not implemented");
  }
}
