-- Face attendance is an opt-in module, switched on per store (default off).
ALTER TABLE "Store" ADD COLUMN "faceAttendanceEnabled" BOOLEAN NOT NULL DEFAULT false;
