export function rentAfterRoomSelection({
  currentRent,
  explicitlySet,
  roomRent,
}: {
  currentRent: string;
  explicitlySet: boolean;
  roomRent?: string;
}) {
  return explicitlySet ? currentRent : (roomRent ?? currentRent);
}
