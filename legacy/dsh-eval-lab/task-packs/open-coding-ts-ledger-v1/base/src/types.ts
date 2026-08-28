export type ReservationStatus = "pending" | "committed" | "released";
export interface Reservation {
  requestId: string;
  key: string;
  units: number;
  status: ReservationStatus;
}
export interface LedgerSnapshot {
  version: 1;
  capacity: number;
  used: number;
  reservations: Reservation[];
}
