-- The partial unique active-room index and restrictive foreign keys remain in place.
CREATE FUNCTION enforce_active_lease_room() RETURNS trigger AS $$
DECLARE operational_status "RoomStatus";
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    SELECT status INTO operational_status FROM "Room" WHERE id = NEW."roomId" FOR UPDATE;
    IF operational_status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'Active leases require an operationally available room' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER active_lease_room_guard BEFORE INSERT OR UPDATE ON "Lease"
FOR EACH ROW EXECUTE FUNCTION enforce_active_lease_room();

CREATE FUNCTION enforce_occupied_room_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'AVAILABLE' AND EXISTS (
    SELECT 1 FROM "Lease" WHERE "roomId" = NEW.id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'End the active lease before reserving or maintaining the room' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER occupied_room_status_guard BEFORE UPDATE OF status ON "Room"
FOR EACH ROW EXECUTE FUNCTION enforce_occupied_room_status();
